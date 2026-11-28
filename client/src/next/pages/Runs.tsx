import { useState } from 'react';
import { Link } from 'react-router';
import type { RunView } from '../../../../server/src/api-types.ts';
import { useApi, useNow } from '../../api.ts';
import { Empty, ErrorNote, PageHead, Segmented, Stat, Status } from '../components/ui.tsx';
import { AGENT_LABEL, clock, duration, money, runStatus, tokens } from '../../format.ts';

const ACTIVE = ['starting', 'running', 'publishing', 'paused'];
const FILTERS: { value: string; match: (r: RunView) => boolean }[] = [
  { value: 'Completed', match: (r) => r.status === 'succeeded' },
  { value: 'Active', match: (r) => ACTIVE.includes(r.status) },
  { value: 'Failed', match: (r) => r.status === 'failed' || r.status === 'lost' || r.status === 'cancelled' },
  { value: 'All', match: () => true },
];

/** Lines added and removed, and how many files, e.g. "+120 −14 · 3 files". */
export function Diff({ diff }: { diff: RunView['diff'] }) {
  if (!diff) return <span className="muted">–</span>;
  return (
    <span className="changes" title={`${diff.files} ${diff.files === 1 ? 'file' : 'files'} changed`}>
      <span className="plus">+{diff.additions}</span> <span className="minus">−{diff.deletions}</span>
      <span className="muted"> · {diff.files}</span>
    </span>
  );
}

const hours = (ms: number) => (ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1)} h`);

export function Runs() {
  const { data, error } = useApi<RunView[]>('/runs', ['runs', 'activity']);
  const now = useNow();
  const [filter, setFilter] = useState('Completed');
  const [agent, setAgent] = useState('');
  const match = FILTERS.find((f) => f.value === filter)!.match;
  const shown = (data ?? []).filter((r) => match(r) && (!agent || r.agent === agent));
  const sum = (pick: (r: RunView) => number) => shown.reduce((n, r) => n + pick(r), 0);
  const took = sum((r) => (r.endedAt ?? now) - r.startedAt);
  const cost = sum((r) => r.costUsd ?? 0);
  // A run's changes are its ticket's whole branch against the default branch, so a ticket counts once: its latest run.
  const finals = [...new Map([...shown].reverse().filter((r) => r.diff).map((r) => [r.ticketId, r.diff!])).values()];
  const changed = { files: finals.reduce((n, d) => n + d.files, 0), additions: finals.reduce((n, d) => n + d.additions, 0), deletions: finals.reduce((n, d) => n + d.deletions, 0) };
  return (
    <div className="stack">
      <PageHead title="Runs" />
      <div className="toolbar">
        <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: <>{f.value} <span className="count">{(data ?? []).filter(f.match).length}</span></> }))} />
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">
          <option value="">All agents</option>
          {Object.entries(AGENT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <ErrorNote error={error} />
      {data && shown.length > 0 && (
        <div className="stats">
          <Stat label="Runs" value={shown.length} sub={data.length === 200 ? 'of the latest 200' : undefined} />
          <Stat label="Agent time" value={hours(took)} sub={`${hours(took / shown.length)} a run`} />
          <Stat label="Turns" value={sum((r) => r.turns ?? 0).toLocaleString()} sub={`${Math.round(sum((r) => r.turns ?? 0) / shown.length)} a run`} />
          <Stat label="Cost" value={money(cost)} sub={`${money(cost / shown.length)} a run, at API prices`} />
          <Stat label="Lines changed" value={<Diff diff={changed} />} sub={`across ${finals.length} ${finals.length === 1 ? 'ticket' : 'tickets'}`} />
        </div>
      )}
      {data && (
        <div className="panel table-wrap">
          {shown.length ? (
            <table className="rows">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Finished</th>
                  <th className="num">Took</th>
                  <th className="num">Turns</th>
                  <th className="num">Tokens</th>
                  <th className="num" title="What the tokens would cost at API prices">
                    Cost
                  </th>
                  <th className="num" title="The ticket's branch against the default branch after this run: lines added, lines removed, files">
                    Changes
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/runs/${r.id}`}>{AGENT_LABEL[r.agent]}</Link>
                      <div className="small muted">
                        {r.model.replace(/^claude-/, '')}
                        {r.attempt > 1 && ` · attempt ${r.attempt}`}
                      </div>
                    </td>
                    <td className="wide">
                      <Link className="ref" to={`/tickets/${r.ticketId}`}>
                        {r.ticket}
                      </Link>
                      <div className="small muted truncate">{r.ticketTitle}</div>
                    </td>
                    <td>
                      <Status tone={runStatus(r).tone}>{runStatus(r).label}</Status>
                    </td>
                    <td className="small" title={`Started ${clock(r.startedAt)}${r.environment ? ` on ${r.environment}` : ''}`}>
                      {r.endedAt ? clock(r.endedAt) : '–'}
                    </td>
                    <td className="small num">{duration(r.startedAt, r.endedAt ?? now)}</td>
                    <td className="small num" title={r.maxTurns ? `Limit ${r.maxTurns}` : undefined}>
                      {r.turns ?? '–'}
                    </td>
                    <td className="small muted num">{tokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0) || null)?.replace(' tokens', '') ?? '–'}</td>
                    <td className="small num">{r.costUsd ? money(r.costUsd) : '–'}</td>
                    <td className="small num">
                      <Diff diff={r.diff} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{data.length ? 'No runs match.' : 'No agent has run yet.'}</Empty>
          )}
        </div>
      )}
    </div>
  );
}
