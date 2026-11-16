# Group spend by project (#65)

## Context

Settings → Lifetime usage (from #30) totals Workshop's agent spend by billing, model and month, from the `spend` ledger (`server/src/spend.ts`). The owner also wants it grouped by project, wants the code ready for more spend analytics later, and wants a way to backfill data, even one that isn't on the API.

The ledger can't group by project today. A `spend` row stores only `run_id`, `ts`, `model`, `billing` and the numbers. The run row that links to the ticket and repository is deleted after `retentionDays`, or when its ticket, repo or connection is deleted.

## Approach

- **"Project" means the repository**, stored as its `full_name` (`owner/name`). Workshop has no other project concept: settings, images and selection all work per repository. We store the name rather than `repo_id`, because repo rows can be deleted and re-added and the ledger has no foreign keys by design.
- **Record the facts when the spend happens.** Each `spend` row gets three new nullable columns: `repo`, `agent` and `ticket` (the issue number). Only `repo` is shown now. `agent` and `ticket` cost nothing to record and can't be recovered once the run is deleted, so recording them now makes later "by agent" or "by ticket" views a read-side change only. This is the extensibility the owner asked for.
- **A dimension registry on the read side.** `lifetimeSpend` currently uses separate maps for model and month. Replace them with one generic `groupBy(rows, key)` helper and a small `DIMENSIONS` table (`model`, `month`, `project`). The helper keeps counting distinct runs per bucket, so a resumed run counts once. A future dimension is then one registry entry plus one field in `LifetimeSpend`.
- **Expose it as `byProject` on the existing `GET /api/usage/lifetime`**, the same shape as `byModel`. A generic `?groupBy=` endpoint would add validation and a second response shape that nothing needs yet. The registry makes it easy to add one later.
- **Rows Workshop can't attribute** (their run was deleted before this ships) get `project: null`. The UI shows them as "Unknown". They still count in every other grouping and in the totals, so totals stay consistent across tables.
- **Backfill in two layers:**
  1. The migration fills the new columns from `runs → tickets → repos` for rows whose run still exists. This runs automatically on upgrade, the same way #30 seeded the ledger.
  2. `backfillSpend(source)` in `spend.ts` does the same fill and also adds ledger rows for runs that have usage but no `spend` row. A CLI wraps it, `server/src/backfill-spend.ts`, which can point at **an old copy of `workshop.db`** (`--from <file>`, attached read-only in practice). That is the one real source of history for deleted runs: a backup made before cleanup removed them. The command is idempotent: it only fills `NULL` columns and only inserts rows for run ids missing from the ledger. Run it with `docker exec workshop node src/backfill-spend.ts [--from /data/old.db]`. It stays off the API on purpose: it reads arbitrary files on the server.

## Changes

### `server/src/db.ts`
Append one migration (don't edit #30's):
```sql
ALTER TABLE spend ADD COLUMN repo TEXT;     -- repos.full_name when recorded; NULL if unknown
ALTER TABLE spend ADD COLUMN agent TEXT;
ALTER TABLE spend ADD COLUMN ticket INTEGER; -- issue number in that repo
UPDATE spend SET repo = x.full_name, agent = x.agent, ticket = x.number
  FROM (SELECT runs.id, repos.full_name, runs.agent, tickets.number
        FROM runs JOIN tickets ON tickets.id = runs.ticket_id JOIN repos ON repos.id = tickets.repo_id) AS x
  WHERE x.id = spend.run_id;
```
Precede it with a one-line comment, like the other entries have.

### `server/src/spend.ts`
- `recordSpend(r, res)`: look up `SELECT repos.full_name, tickets.number FROM tickets JOIN repos ON repos.id = tickets.repo_id WHERE tickets.id = ?` with `r.ticket_id`, then insert `repo`, `agent` (`r.agent`) and `ticket` along with the existing columns. Use `null` if the lookup finds nothing.
- Export a `SpendRow` type for the ledger row, including the three new fields.
- Replace the `models`/`months`/`seen` code with:
  - `groupBy(rows, key: (row) => string | null): Map<string | null, SpendTotals>`, which counts distinct `run_id` per bucket;
  - `DIMENSIONS`: `model: row => row.model`, `month: row => fmt.format(row.ts).slice(0, 7)` (built per call, since it depends on the time zone), `project: row => row.repo`.
  - Keep `total`, `subscription` and `api` as they are.
- `byProject`: the same as `byModel`, `{ project, ...totals }` sorted by cost descending.
- `backfillSpend(schema = 'main'): { filled: number; added: number }`:
  - `filled`: the migration's `UPDATE … FROM`, reading `${schema}.runs/tickets/repos`, limited to `spend.repo IS NULL`. It fills all three columns together.
  - `added`: `INSERT INTO spend (...) SELECT …` from `${schema}.runs` (left-joined to tickets and repos), using the #30 rule (`COALESCE(ended_at, started_at)`, usage not all null) for runs with no existing `spend` row (`NOT IN (SELECT run_id FROM main.spend)`).
  - `schema` is only ever `'main'` or `'src'`; it's interpolated, so assert it's one of those two.
  - Wrap it in `BEGIN`/`COMMIT`.

### `server/src/backfill-spend.ts` (new)
A CLI with no HTTP server and no scheduler:
- `initDb(path.join(config.dataDir, 'workshop.db'))`;
- parse `--from <file>` from `process.argv` by hand. If given, check the file exists (else exit 1 with a readable message), `ATTACH DATABASE ? AS src`, `backfillSpend('src')`, then `DETACH`;
- then always run `backfillSpend('main')`;
- print e.g. `Filled the project for 12 ledger rows; added 3 rows from runs missing from the ledger.`, close the DB and exit.

Importing `config.ts` needs the usual env vars, which the container already has. The UI picks up the new figures on its next refetch; the CLI doesn't need to publish.

### `server/src/api-types.ts`
- `LifetimeSpend.byProject: (SpendTotals & { project: string | null })[]`, with a doc comment: "Repository `owner/name`; null for spend whose run was deleted before Workshop recorded it, sorted by cost."

### `server/src/http/openapi.ts`
- Add `byProject: array({ allOf: [ref('SpendTotals'), object({ project: nullable(str) })] })` to `LifetimeSpend`.
- Update the `/usage/lifetime` summary to "… by billing, model, project and month."

### `client/src/pages/Settings.tsx`
- In `LifetimeUsage`, add `<SpendTable title="By project" label="project" rows={data.byProject.map((p) => ({ key: p.project ?? '', name: p.project ?? 'Unknown', t: p }))} />` between By model and By month.
- Add to the help paragraph: `Unknown is spend from runs deleted before Workshop recorded their repository.` Show this only when some `byProject` row has `project === null`.

### Docs
- `docs/api.md`: change the lifetime example's comment to `# Lifetime token use and token-equivalent cost, by billing, model, project and month`.
- `README.md`, "Day to day": one bullet, **Backfill spend:** `docker exec workshop node src/backfill-spend.ts` fills the project for older spend; add `--from <copy of an old workshop.db>` (placed in the data volume) to recover runs that cleanup has since deleted.
- `server/AGENTS.md` map: add `src/backfill-spend.ts`, "CLI: fill in spend ledger dimensions and missing rows, optionally from an old database copy". Add one sentence under `src/spend.ts` saying that new dimensions are recorded in `recordSpend`, filled in `backfillSpend`, and grouped through `DIMENSIONS`.

## Data and interfaces

- DB: `spend` gains `repo TEXT`, `agent TEXT` and `ticket INTEGER`, all nullable, filled by the migration where the run still exists.
- API: `GET /api/usage/lifetime` gains `byProject`. The change is additive.
- CLI: `node src/backfill-spend.ts [--from <path>]`, run from `/app/server` in the image.

## Tests

Run `npm run typecheck` and `npm test`.

**`server/test/api.test.ts`** (`lifetime usage`)
- Extend `ins` with `repo` (and optionally `agent` and `ticket`). Two repos plus one `null`: check that `byProject` is ordered by cost, that the distinct `runs` count is right for a resumed run, that the `null` bucket is present with `project: null`, and that the `byProject` sums equal `total`.
- The empty ledger case returns `byProject: []`.
- The schema-fields `it.each` already covers `LifetimeSpend`. It passes once `byProject` is in both the response and the schema.

**`server/test/pipeline.test.ts`**
- Extend the existing "successful run leaves one spend row" test: the row has the test repo's `full_name`, the run's agent and the ticket number.

**`server/test/spend.test.ts`** (new; `initDb(':memory:')` in `beforeAll`, as `api.test.ts` does)
- `backfillSpend('main')`:
  - fills `repo`, `agent` and `ticket` on a row whose run exists and leaves a row with no run `NULL`;
  - inserts a ledger row for a run that has usage but no `spend` row;
  - a second call returns `{ filled: 0, added: 0 }`.
- From an attached copy: write a second DB file under `process.env.DATA_DIR` with `new DatabaseSync(file)`, then `exec` every `MIGRATIONS` entry except the last one (the schema before this change). In it, put a run that is absent from the main DB. `ATTACH … AS src` plus `backfillSpend('src')` fills the matching orphan row and adds the missing run's spend.
- `backfillSpend('x; DROP')` throws.

The CLI wrapper itself is thin argument parsing. Check it once by hand against a copy of a real `workshop.db`.

## Risks and open questions

- **Decided here, owner can override:** "project" is the GitHub repository. If the owner meant a grouping across repos (for example by org, or a user-defined project), the `DIMENSIONS` registry can derive org from `repo` with no schema change. A user-defined grouping would need its own design.
- **Unknown bucket:** spend from runs deleted before upgrading stays "Unknown" unless the owner has an older DB copy to backfill from. That's inherent: the ledger never stored the link.
- **Repository renames:** spend stays under the name it had when recorded, so a renamed repo shows as two projects. That's acceptable for now. A later fix could map by `repo_id` history.
- **`UPDATE … FROM`** needs SQLite 3.33 or later. Node 24's bundled SQLite is far newer.
- **Attaching an old DB in WAL mode** may create `-wal`/`-shm` files next to it. The README tells the owner to use a copy.
