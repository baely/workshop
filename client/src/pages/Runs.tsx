import { useState } from 'react';
import { Link } from 'react-router';
import type { RunView } from '../../../server/src/api-types.ts';
import { useApi, useNow } from '../api.ts';
import { Empty, ErrorNote, PageHead, Segmented, Status } from '../components/ui.tsx';
import { AGENT_LABEL, clock, duration, money, runStatus, tokens } from '../format.ts';

const FILTERS: { value: string; match: (r: RunView) => boolean }[] = [
  { value: 'All', match: () => true },
  { value: 'Active', match: (r) => ['starting', 'running', 'publishing', 'paused'].includes(r.status) },
  { value: 'Failed', match: (r) => r.status === 'failed' || r.status === 'lost' },
  { value: 'Done', match: (r) => r.status === 'succeeded' },
];

export function Runs() {
  const { data, error } = useApi<RunView[]>('/runs', ['runs']);
  const now = useNow();
  const [filter, setFilter] = useState('All');
  const [agent, setAgent] = useState('');
  const match = FILTERS.find((f) => f.value === filter)!.match;
  const shown = (data ?? []).filter((r) => match(r) && (!agent || r.agent === agent));
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
      {data && (
        <div className="panel table-wrap">
          {shown.length ? (
            <table className="rows">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Ticket</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th className="num">Took</th>
                  <th className="num">Usage</th>
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
                    <td className="small" title={r.environment ? `On ${r.environment}` : undefined}>
                      {clock(r.startedAt)}
                    </td>
                    <td className="small num">{duration(r.startedAt, r.endedAt ?? now)}</td>
                    <td className="small muted num">
                      {tokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0) || null) ?? '–'}
                      {r.billing === 'api' && r.costUsd !== null && <div>{money(r.costUsd)}</div>}
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
