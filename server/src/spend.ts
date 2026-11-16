import type { LifetimeSpend, SpendTotals } from './api-types.ts';
import { all, one, run } from './db.ts';
import type { RunRow } from './runs.ts';

/** Adds one `claude` invocation's result to the ledger and to the run's own totals (a resumed run sums its invocations). */
export function recordSpend(r: RunRow, res: { inputTokens?: number; outputTokens?: number; costUsd?: number }) {
  const input = res.inputTokens ?? 0;
  const output = res.outputTokens ?? 0;
  const cost = res.costUsd ?? 0;
  const where = one<{ full_name: string; number: number }>('SELECT repos.full_name, tickets.number FROM tickets JOIN repos ON repos.id = tickets.repo_id WHERE tickets.id = ?', r.ticket_id);
  run(
    'INSERT INTO spend (run_id, ts, model, billing, input_tokens, output_tokens, cost_usd, repo, agent, ticket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    r.id,
    Date.now(),
    r.model,
    r.billing,
    input,
    output,
    cost,
    where?.full_name ?? null,
    r.agent,
    where?.number ?? null,
  );
  run(
    'UPDATE runs SET input_tokens = COALESCE(input_tokens, 0) + ?, output_tokens = COALESCE(output_tokens, 0) + ?, cost_usd = COALESCE(cost_usd, 0) + ? WHERE id = ?',
    input,
    output,
    cost,
    r.id,
  );
}

/** One ledger row. `repo`, `agent` and `ticket` are null when the run was deleted before they were recorded. */
export interface SpendRow {
  run_id: string;
  ts: number;
  model: string;
  billing: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  repo: string | null;
  agent: string | null;
  ticket: number | null;
}

const zero = (): SpendTotals => ({ runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });

/** Totals per bucket of `key`, counting each run id once per bucket so a resumed run counts once. */
function groupBy(rows: SpendRow[], key: (row: SpendRow) => string | null): Map<string | null, SpendTotals> {
  const groups = new Map<string | null, { t: SpendTotals; ids: Set<string> }>();
  for (const row of rows) {
    const k = key(row);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { t: zero(), ids: new Set() }));
    if (!g.ids.has(row.run_id)) {
      g.ids.add(row.run_id);
      g.t.runs++;
    }
    g.t.inputTokens += row.input_tokens;
    g.t.outputTokens += row.output_tokens;
    g.t.costUsd += row.cost_usd;
  }
  return new Map([...groups].map(([k, g]) => [k, g.t]));
}

/** What the lifetime view can group by. Built per call because the month depends on the time zone. */
const dimensions = (timeZone: string) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
  return {
    model: (row: SpendRow) => row.model,
    month: (row: SpendRow) => fmt.format(row.ts).slice(0, 7),
    project: (row: SpendRow) => row.repo,
  };
};

export function lifetimeSpend(timeZone: string): LifetimeSpend {
  const rows = all<SpendRow>('SELECT * FROM spend ORDER BY ts, id');
  const DIMENSIONS = dimensions(timeZone);
  const totals = (subset: SpendRow[]) => groupBy(subset, () => '').get('') ?? zero();
  const byCost = (a: SpendTotals, b: SpendTotals) => b.costUsd - a.costUsd;
  return {
    since: rows[0]?.ts ?? null,
    total: totals(rows),
    subscription: totals(rows.filter((r) => r.billing !== 'api')),
    api: totals(rows.filter((r) => r.billing === 'api')),
    byModel: [...groupBy(rows, DIMENSIONS.model)].map(([model, t]) => ({ model: model!, ...t })).sort(byCost),
    byProject: [...groupBy(rows, DIMENSIONS.project)].map(([project, t]) => ({ project, ...t })).sort(byCost),
    byMonth: [...groupBy(rows, DIMENSIONS.month)].map(([month, t]) => ({ month: month!, ...t })).sort((a, b) => b.month.localeCompare(a.month)),
  };
}

/**
 * Fills repo, agent and ticket on ledger rows that lack them, and adds rows for runs with usage but no ledger row.
 * `schema` is where the runs, tickets and repos come from: 'main', or 'src' for an attached older copy of the database.
 */
export function backfillSpend(schema: 'main' | 'src' = 'main'): { filled: number; added: number } {
  if (schema !== 'main' && schema !== 'src') throw new Error(`Unknown schema: ${schema}`);
  run('BEGIN');
  try {
    const filled = Number(
      run(
        `UPDATE main.spend SET repo = x.full_name, agent = x.agent, ticket = x.number
         FROM (SELECT runs.id, repos.full_name, runs.agent, tickets.number
               FROM ${schema}.runs JOIN ${schema}.tickets ON tickets.id = runs.ticket_id JOIN ${schema}.repos ON repos.id = tickets.repo_id) AS x
         WHERE x.id = spend.run_id AND spend.repo IS NULL`,
      ).changes,
    );
    const added = Number(
      run(
        `INSERT INTO main.spend (run_id, ts, model, billing, input_tokens, output_tokens, cost_usd, repo, agent, ticket)
         SELECT runs.id, COALESCE(runs.ended_at, runs.started_at), runs.model, runs.billing,
                COALESCE(runs.input_tokens, 0), COALESCE(runs.output_tokens, 0), COALESCE(runs.cost_usd, 0),
                repos.full_name, runs.agent, tickets.number
         FROM ${schema}.runs
         LEFT JOIN ${schema}.tickets ON tickets.id = runs.ticket_id
         LEFT JOIN ${schema}.repos ON repos.id = tickets.repo_id
         WHERE (runs.input_tokens IS NOT NULL OR runs.output_tokens IS NOT NULL OR runs.cost_usd IS NOT NULL)
           AND runs.id NOT IN (SELECT run_id FROM main.spend)`,
      ).changes,
    );
    run('COMMIT');
    return { filled, added };
  } catch (err) {
    run('ROLLBACK');
    throw err;
  }
}
