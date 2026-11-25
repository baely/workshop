# Out-of-cycle agent runs ("tasks") (#102)

## Context

Every run belongs to a ticket and a stage of the label workflow. When the owner is away from their desk and runs into something (an error in Workshop itself, say), they can't just point an agent at it, the way they would in their own Claude Code session.

Outcome: a **Tasks** page where the owner picks a repository, types a prompt and starts an agent at once. A task is a standalone run with no ticket, labels, comments, pull request or failure counting. It uses the same hosts, slots, allowance and run view as ticket runs. It appears under Running now and under its agent host on the Dashboard, and in the Runs list. The Tasks page lists every task.

## Approach

A task is a row in `runs` with `ticket_id` NULL and the owner's `prompt`, driven by the existing runner. The other options were a new table plus a second runner, or a fake ticket. Reusing `runs` keeps re-attach, pause and resume, allowance switching, host slots, logs, the transcript view, spend and cleanup working without copying them.

- **A new agent class `task`** ("Task") in `AGENT_INFO`. The Agents page then sets its model, billing, effort, turn and time limits and its prompt, with no new settings UI. Its result uses the work schema without `media`.
- **A repository is required.** The task works in a fresh clone on a new branch, `workshop/task-<first 8 chars of run id>`, created from the default branch. There's no "empty folder" mode: the entrypoint's `run` needs `/work/repo`, and every use case in the ticket is about a repository.
- **Publishing pushes the branch only if the agent committed something.** No pull request and no GitHub API calls. The run page links to the branch. This means work done from a phone isn't lost, and nothing reaches `main` without the owner. Git credentials stay out of the `run` container, the same as for tickets.
- **Tasks start now or not at all.** There's no queue. `POST /api/tasks` applies the same gates as **Start now** on a ticket (`launchNow`): the operation mode and hours are skipped, but the model, billing, subscription allowance, API cap and a free host slot are still required. When a gate fails, the request returns 409 with the reason, and nothing is stored. Queuing would need a new status in the scheduler. The owner asked for this to be started on request.
- **Tasks are treated like hand-pushed tickets.** A task paused for a usage limit resumes outside hours, like a pushed ticket's run.
- **Images:** tasks have no media store (`media.ticket_id` is NOT NULL), so `copyBackMedia` is skipped and the protocol doesn't mention `/work/media`.
- A task is a single prompt. Follow-up messages in the same session are out of scope (see the open questions).

## Changes

### Server

- `src/db.ts`: one new migration that rebuilds `runs` so `ticket_id` can be NULL. SQLite can't drop NOT NULL in place.
  - `CREATE TABLE runs_new` is the current `runs` definition: every column from the first migration plus the columns added since (`image`, `pause_reason`, `pause_requested_at`, `switched_from`, `max_turns`, `timeout_min`, `step_started_at`, `publish_state`, `publish_retries`, `publish_retry_at`, `publish_failing_since`). It changes `ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE` (now nullable) and adds:
    - `repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE`;
    - `prompt TEXT`;
    - `browser INTEGER NOT NULL DEFAULT 0`;
    - `CHECK ((ticket_id IS NULL) = (prompt IS NOT NULL))`.
  - `INSERT INTO runs_new (<explicit column list>) SELECT <same>, (SELECT repo_id FROM tickets WHERE tickets.id = runs.ticket_id) FROM runs`, then `DROP TABLE runs; ALTER TABLE runs_new RENAME TO runs;`. Recreate `runs_one_active_per_ticket` exactly as it is. A NULL `ticket_id` never conflicts in a unique index, so there's no limit on tasks. No table has a foreign key to `runs` (`media` and `spend` don't), so the drop is safe with `foreign_keys = ON`.
  - In the same migration, seed the agent class like the code reviewer's: `INSERT OR IGNORE INTO agent_classes (name, model, model_connection_id, effort, billing, max_turns, timeout_min) SELECT 'task', model, model_connection_id, effort, billing, 200, 120 FROM agent_classes WHERE name = 'implement';`.
- `src/api-types.ts`:
  - Add `'task'` to `AgentName`.
  - `RunView`: `ticketId`, `ticket`, `ticketTitle` and `ticketUrl` become `| null`. Add:
    - `repo: string` (full name);
    - `environmentId: number | null`;
    - `task: TaskInfo | null`.
  - New types:
    - `TaskInfo { prompt: string; title: string; branch: string; branchUrl: string | null }`. `branchUrl` is set only once a push went through with commits ahead of the base.
    - `TaskRepo { id: number; fullName: string }`.
    - `TasksView { repos: TaskRepo[]; tasks: RunView[] }`.
- `src/runs.ts`:
  - `RunRow`: `ticket_id: number | null`, `repo_id`, `prompt`, `browser`.
  - `VIEW_SQL`: `LEFT JOIN tickets t ON t.id = runs.ticket_id`, `JOIN repos r ON r.id = runs.repo_id`, also select `r.url AS repo_url`.
  - `toView` fills the new fields. `task.title` comes from `taskTitle(prompt)`: the first non-empty line, cut to 80 characters with "…". `branchUrl` is `${repo_url}/tree/${branch}` when `publish_state`'s `pushed.ahead > 0`.
  - Export `taskBranch(runId)` (`workshop/task-${runId.slice(0, 8)}`) and `taskTitle` as pure helpers.
- `src/workflow/prompts.ts`:
  - `AGENT_INFO.task` = `{ label: 'Task', description: 'Runs a prompt you start from the Tasks page, outside the ticket workflow.', maxTurns: 200, timeoutMin: 120 }`.
  - `DEFAULT_PROMPTS.task`: "You are working on a task the owner gave you from Workshop, as they would in their own Claude Code session. Do what the prompt asks. Follow the repository's AGENTS.md or CLAUDE.md. If you change code, run the relevant tests and commit with clear messages."
  - New `taskProtocolText({ branch, base })`. It's the fixed protocol with the ticket wording replaced:
    - the repository is at `/work/repo` on the new branch `<branch>`, made from `origin/<base>`;
    - there are no git credentials, so the agent commits locally and Workshop pushes `<branch>` if it has new commits, with no pull request;
    - nobody can answer questions, so it returns `needs_info` with specific questions if it's blocked;
    - the summary is shown to the owner on the run's page.
- `src/workflow/schemas.ts`: `TASK_SCHEMA` is `WORK_SCHEMA` without `media`. Register it in `SCHEMAS`. `parseResult('task', …)` validates it like a work result.
- `src/workflow/labels.ts`: `AGENT_TEXT.task = 'Task'`. In `imageFor`, `agent === 'task' && ui` picks the browser image (the run's `browser` flag is passed as `ui`).
- `src/agents.ts`: `SUGGESTED_MODELS.task = 'claude-opus-5-5'`. `agentViews` shows `taskProtocolText({ branch: 'workshop/task-<id>', base: '<default branch>' })` for `task`.
- `src/scheduler/runner.ts`:
  - `Ctx.ticket: TicketRow | null`, plus `ctx.what`: `owner/repo#12` for a ticket, or `A task in owner/repo`. The alerts that read `ctx.labels['workshop.ticket']` use `ctx.what` instead.
  - `context()`:
    - looks up the repo from `r.repo_id`;
    - throws "The ticket no longer exists" only for ticket runs;
    - computes the image as `imageFor(r.agent, ticket ? parseLabels(labelsOf(ticket)) : parseLabels([]), images, ticket ? Boolean(ticket.ui) : Boolean(r.browser))`;
    - container labels for tasks: `workshop.task = <repo full name>` instead of `workshop.ticket`.
  - A helper `branchFor(ctx)` (the ticket's branch, or `taskBranch(r.id)`), used in `prepareSpec` and `publishSpec`.
  - `runSpec`: when `ctx.ticket` is null (first segment only), skip the ticket, comment, review and media fetching:
    - `system.md` = `promptFor(agent)` + `taskProtocolText(...)` + the environment text;
    - `prompt.md` = `r.prompt` verbatim.
  - Guard every `markRunning` call (`drive`, and the two pause paths in `runAgent`) with `if (ctx.ticket)`. Skip `copyBackMedia` for tasks.
  - `drive`: in the publishing branch, call `publishTask(ctx)` instead of `publishRun(ctx)` for tasks. Temporary errors still go through `deferPublish`, because `gitAccess` can hit a GitHub 5xx.
  - New `publishTask(ctx)`:
    1. runs the `publish` container with `publishSpec` plus `SKIP_EMPTY=1` and reads the JSON report as `publishRun` does;
    2. a non-zero exit throws `Pushing <branch> failed (exit N). See the run log.`;
    3. stores `publish_state = JSON.stringify({ pushed })`, sets `succeeded`, and removes the volume.
  - `deferPublish`'s give-up alert uses `ctx.what`-style wording when there's no ticket.
  - `fail` and `stopRun` already return early without a ticket, so a failed task never touches labels or failure counts.
  - `launch(p)`: `ticketId: number | null`, plus `repoId: number`, `prompt?: string` and `browser?: boolean`, all inserted. It publishes `'tickets'` only for ticket runs. `startCandidate` passes `repoId: c.repo.id`.
- `src/scheduler/loop.ts`:
  - Move the per-agent part of `buildQueue` (model configured, billing offered, API cap or `pickSubscription`, host) into `agentGate(agent, pool, spentToday, s, hostId, hosts)`. It returns `{ blockedBy, modelConnectionId, model, billing }`. `buildQueue` keeps ticket-only reasons (dependencies, mode, priority) in front of it, so its behaviour doesn't change.
  - New `launchTask({ repoId, prompt, browser })`:
    1. checks the repository exists: 404 `Repository not found.`;
    2. runs `agentGate('task', …)` and refuses a blocked one with 409 `Can't start a task yet: <reason>.`;
    3. otherwise calls `launch({ ticketId: null, agent: 'task', mode: 'normal', attempt: 1, … })` and returns the id.
  - `resumePaused`: a task (`r.ticket_id === null`) isn't held by `modeReason`, the same as a pushed ticket. When its subscription is paused and nothing can take it over, the abort message for a task reads: "`<name>` was paused and no other Claude subscription offers `<model>`, so Workshop stopped this task. Start it again from the Tasks page."
- `src/spend.ts` `recordSpend`: take `repo` from `runs.repo_id` (`SELECT full_name FROM repos WHERE id = ?`), and `ticket` from the ticket when there is one, otherwise null. `backfillSpend` stays as it is: old database copies have no `repo_id`, and task rows are recorded completely when they're written.
- `src/http/api.ts`:
  - `GET /tasks` returns a `TasksView`: every row in `repos` ordered enabled first, then by name; and `runViews('runs.ticket_id IS NULL')`.
  - `POST /tasks` with `{ repoId, prompt, browser? }`:
    - validates `repoId` with `int`;
    - checks `prompt` is a string whose trimmed length is 1–20,000: "Describe the task in under 20,000 characters.";
    - checks `browser` is a boolean or absent;
    - stores the trimmed prompt, returns `202` with `runView(id)`, and kicks the scheduler.
- `src/http/openapi.ts`:
  - add `task` to `AgentName`;
  - `RunView`: the ticket fields become nullable, and `repo`, `environmentId` and `task` are added;
  - add the `TaskInfo`, `TaskRepo` and `TasksView` schemas and both `/tasks` paths (errors 400, 403, 404, 409).
- `docs/api.md`: an example under Examples ("Start a task: an agent with your own prompt on a repository, outside the ticket workflow"), and a short **Tasks** section covering the gates, the branch, the push only when there are commits, and the lack of a queue. Note that `RunView`'s ticket fields are null for tasks.
- `docs/design/architecture.md`: a short **Tasks** paragraph under "Decisions and why". Add `workshop.task` to the container labels.
- `server/AGENTS.md`: the run lifecycle gets one bullet: tasks have `ticket_id` NULL, a `repo_id` and a `prompt`, the `task` agent class and `publishTask`, and never touch labels. The Database note mentions that `runs` was rebuilt, so later migrations must start from the new definition.

### Agent image

- `agent/entrypoint.sh` `publish`: after the "commit uncommitted changes" block, add:
  ```sh
  if [ -n "${SKIP_EMPTY:-}" ] && [ "$(git rev-list --count "origin/$BASE_BRANCH..HEAD")" = 0 ]; then
    printf '{"ahead":0}\n'; exit 0
  fi
  ```

### Client

- `src/format.ts`: `AGENT_LABEL.task = 'Task'`. Add `runSubject(run)`, which returns `{ text, to }`: `owner/repo#12` linking to the ticket, or `Task in owner/repo` linking to `/tasks`. Use it wherever a run names its ticket.
- `src/pages/Tasks.tsx` (new, route `tasks`, nav item **Tasks** after Tickets in `Layout.tsx`, route in `main.tsx`). It uses `useApi<TasksView>('/tasks', ['runs', 'repos'])`.
  - Panel **Start a task**:
    - a **Repository** select. Remember the last choice in `localStorage`;
    - a textarea, **What should the agent do?**, with about 8 rows that resize vertically;
    - a checkbox, **Give it a browser (Playwright with Chromium)**;
    - a button, **Start task**;
    - this hint: "Starts now on a free agent host with the Task agent's model and limits (Agents page). The agent works on a new branch and pushes it if it commits anything; no pull request is opened."
    - On success, navigate to `/runs/:id`. Show the server's message with `ErrorNote`.
    - With no repositories, show the empty state: "Workshop can't see any repositories yet. Add a code host on the Connections page."
  - Panel **Tasks**: a table in `.table-wrap` like `Runs.tsx`:
    - columns Started (links to the run), Task (title, then repo in small muted text, then a **branch** link when `branchUrl` is set), Host, Status, Took and Usage;
    - empty state: "No tasks yet. Describe one above to start an agent."
- `src/pages/Dashboard.tsx`:
  - `RunLine` uses `runSubject`. For a task, the second line is `task.title`.
  - **Agent hosts**: each host lists the agents it's running. These are `data.running` entries with `environmentId === h.id` and status starting, running or publishing (paused runs free their slot), shown as small lines `<agent label>: <subject or task title>` that link to `/runs/:id`.
- `src/pages/Runs.tsx`: the Ticket column becomes **Ticket or task**, using `runSubject` and the title.
- `src/pages/RunView.tsx`, for a task:
  - the heading is "Task in `<repo>`";
  - a **Prompt** panel shows the prompt as plain text with `white-space: pre-wrap`. Don't render it as Markdown;
  - instead of **Ticket lifecycle** and **View screenshots**, show **View branch** when `branchUrl` is set;
  - the stop confirmation says: "Stop this task? Its work is discarded unless it was already pushed."
- `src/access.ts` `claudeBrief`: for a task, describe the run as "Task in `<repo>`" and leave out the ticket `curl` line. Update `client/test/access.test.ts`.
- `src/theme.css`: reuse the existing form and panel styles. At most, add one `.prompt` rule (pre-wrap on a `--raised` background, in IBM Plex Sans).

## Data and interfaces

- **DB:** `runs.ticket_id` becomes nullable. The new columns are `runs.repo_id` (always set, backfilled), `runs.prompt` and `runs.browser`. The `agent_classes` row `task` is seeded.
- **API (apiRouter, so write-scoped tokens can use it):**
  - `GET /api/tasks` returns `TasksView`.
  - `POST /api/tasks` takes `{ "repoId": 3, "prompt": "…", "browser": false }` and returns `202` with a `RunView`. It returns 400 for an invalid body, 404 for an unknown repo, and 409 when a gate is closed. Every error is `{ error }` with the reason, for example "Can't start a task yet: Every agent host is busy or offline."
  - `RunView` changes as listed above: the nullable ticket fields are a change visible to API consumers, documented in `docs/api.md`.
- **Events:** nothing new. `launch` and `setRun` already publish `runs`.
- **Agent image:** the `publish` step gets the optional `SKIP_EMPTY` env var.

## Tests

- `server/test/db.test.ts` (new): apply `MIGRATIONS` up to the previous version to an in-memory `DatabaseSync`. Insert a repo, a ticket, a run with `publish_state` set and an active run, then apply the rest. Check that:
  - every column value survives and `repo_id` is backfilled;
  - the unique index still refuses a second active run on that ticket and allows two active runs with NULL tickets;
  - the CHECK rejects a row with neither a ticket nor a prompt;
  - the `task` agent class copied Implementation's model.
- `server/test/workflow.test.ts`:
  - `imageFor('task', …)` picks the browser image only with `ui`, and the repo image always wins;
  - `taskTitle`: first non-empty line, cut to 80 characters;
  - `parseResult('task', …)` accepts a work result;
  - `taskProtocolText` names the branch and says no pull request is opened.
- `server/test/pipeline.test.ts`, with the fake Docker and GitHub:
  - A task runs prepare (`BRANCH=workshop/task-…`, base = default branch), then run, where `prompt.md` is the prompt verbatim, `system.md` holds the task protocol, and the env has no git credentials. Then it publishes with `SKIP_EMPTY=1` and succeeds. There are no label edits, comments, pull requests or ticket reads, and `branchUrl` is set when the report says `ahead > 0` and null for `{"ahead":0}`.
  - A failed task leaves no alert of kind `ticket-failed`, and makes no label edits.
  - `launchTask` refuses with the gate's reason when no host is free, when no model is set for Task, and when the subscription is over its limits. It ignores `mode: 'paused'`. It takes a slot that `hostLoads` counts, so a ticket candidate then reports "Every agent host is busy or offline".
  - A task paused for a usage limit resumes in `resumePaused` while the mode is `paused`.
  - `recordSpend` for a task records the repo, agent `task` and ticket null.
  - The existing queue tests pass unchanged, which covers the `agentGate` refactor.
- `server/test/api.test.ts`:
  - `POST /api/tasks` validation (missing or blank prompt, over 20,000 characters, unknown repo is 404, non-boolean browser);
  - a read-only token gets 403;
  - `GET /api/tasks` shape;
  - the existing OpenAPI route-coverage test includes the new paths. Add `/tasks` to its response field-matching `it.each` as `TasksView`.
- `client/test/access.test.ts`: the brief for a task run.
- Run `npm run typecheck` and `npm test`. Then `npm run build && npm start` (or the two dev servers) with Playwright. With a fake or real host connected, open `/tasks` at 390px and 1280px wide in both themes. Start a task, see it on the Dashboard under Running now and under its host, and open its run view. Save the screenshots to `/work/media/`.

## Risks and open questions

- **Rebuilding `runs`** is the riskiest step. It has to list every current column, and the migration test above guards it. It runs in the migration's transaction, so a failure rolls back cleanly.
- **Power of write tokens:** a write-scoped API token can now run any prompt on an agent host. Before, it could only push tickets that allowlisted authors wrote. That matches the API invariant (functionality a script could use goes on `apiRouter`), and the agent still has no git credentials. If the owner would rather keep tasks to signed-in sessions, mark the two routes `sessionOnly` and leave them out of `docs/api.md`.
- **No queue:** with every slot busy, the owner gets the reason and has to retry or pause another run. A queued task would be a later ticket.
- **Follow-ups** (sending another message to a finished task in the same session) are out of scope. They would need the volume kept after success and a `RESUME` prompt the owner writes. This could be a later ticket, if single prompts turn out to be too limiting.
- **No media for tasks:** screenshots a task takes are lost. A per-run media store would be a separate change.
- **Debugging Workshop itself:** the agent gets the Workshop repository, but not the live instance. The owner can paste a token from **Give Claude access** (#96) into the prompt. Don't add anything automatic.
