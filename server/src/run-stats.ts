import { one, run } from './db.ts';

// Figures about a run that Workshop works out as it goes: how many turns the agent took and how much it changed.
// They live in their own table, created in initDb rather than by a numbered migration, so this stays apart from
// the schema's version history.

export interface RunStats {
  turns: number | null;
  files: number | null;
  additions: number | null;
  deletions: number | null;
}

/** Adds one session's turns to the run: a paused run is several sessions. */
export function addTurns(runId: string, turns: number) {
  if (!turns) return;
  run('INSERT INTO run_stats (run_id, turns) VALUES (?, ?) ON CONFLICT (run_id) DO UPDATE SET turns = COALESCE(turns, 0) + excluded.turns', runId, turns);
}

/** What the run's own commits changed. */
export function setDiff(runId: string, diff: { files: number; additions: number; deletions: number }) {
  run(
    'INSERT INTO run_stats (run_id, files, additions, deletions) VALUES (?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET files = excluded.files, additions = excluded.additions, deletions = excluded.deletions',
    runId,
    diff.files,
    diff.additions,
    diff.deletions,
  );
}

export const runStats = (runId: string) => one<RunStats>('SELECT turns, files, additions, deletions FROM run_stats WHERE run_id = ?', runId);
