import { useState } from 'react';
import { Link } from 'react-router';
import type { TicketTotals } from '../../../../server/src/api-types.ts';
import { useApi } from '../../api.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorNote, PageHead, Segmented, Stat, Status, Tabs, Tag } from '../components/ui.tsx';
import { clock, money, STAGE_TEXT, tokens, when } from '../../format.ts';
import { Diff } from './Runs.tsx';

export const TICKET_TABS = [
  { to: '/tickets', label: 'Board', end: true },
  { to: '/tickets/all', label: 'Completed and totals' },
];

const FILTERS: { value: string; match: (t: TicketTotals) => boolean }[] = [
  { value: 'Completed', match: (t) => t.state === 'closed' },
  { value: 'In progress', match: (t) => t.state === 'open' },
  { value: 'All', match: () => true },
];

const hours = (ms: number) => (ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1)} h`);

function State({ t }: { t: TicketTotals }) {
  if (t.working) return <Status tone="running">Agent working</Status>;
  if (t.state === 'closed') return <Status tone={t.skipped ? 'idle' : 'ok'}>{t.skipped ? 'Closed, skipped' : 'Done'}</Status>;
  if (t.failed) return <Status tone="error">Stopped</Status>;
  if (t.skipped) return <Status tone="idle">Skipped</Status>;
  return <Status tone="idle">{t.stage ? STAGE_TEXT[t.stage] : 'To classify'}</Status>;
}

/** Every ticket agents have worked on, finished ones included, with what its runs added up to. */
export function TicketTotalsPage() {
  const { data, error } = useApi<TicketTotals[]>('/ticket-totals', ['tickets', 'runs']);
  const [filter, setFilter] = useState('Completed');
  const [query, setQuery] = useState('');
  const match = FILTERS.find((f) => f.value === filter)!.match;
  const q = query.trim().toLowerCase();
  const shown = (data ?? []).filter((t) => match(t) && (!q || t.title.toLowerCase().includes(q) || t.ticket.toLowerCase().includes(q)));
  const sum = (pick: (t: TicketTotals) => number) => shown.reduce((n, t) => n + pick(t), 0);
  const per = (n: number) => (shown.length ? n / shown.length : 0);
  const cost = sum((t) => t.costUsd ?? 0);
  const time = sum((t) => t.agentMs);
  const changed = { files: sum((t) => t.diff?.files ?? 0), additions: sum((t) => t.diff?.additions ?? 0), deletions: sum((t) => t.diff?.deletions ?? 0) };
  return (
    <div className="stack">
      <PageHead title="Tickets" />
      <Tabs label="Tickets" items={TICKET_TABS} />
      <div className="toolbar">
        <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: <>{f.value} <span className="count">{(data ?? []).filter(f.match).length}</span></> }))} />
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="Search tickets" aria-label="Search tickets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <ErrorNote error={error} />
      {data && shown.length > 0 && (
        <div className="stats">
          <Stat label="Tickets" value={shown.length} />
          <Stat label="Runs" value={sum((t) => t.runs)} sub={`${per(sum((t) => t.runs)).toFixed(1)} a ticket`} />
          <Stat label="Agent time" value={hours(time)} sub={`${hours(per(time))} a ticket`} />
          <Stat label="Turns" value={sum((t) => t.turns ?? 0).toLocaleString()} sub={`${Math.round(per(sum((t) => t.turns ?? 0)))} a ticket`} />
          <Stat label="Cost" value={money(cost)} sub={`${money(per(cost))} a ticket, at API prices`} />
          <Stat label="Lines changed" value={<Diff diff={changed} />} sub="final diffs, added together" />
        </div>
      )}
      {data && (
        <div className="panel table-wrap">
          {shown.length ? (
            <table className="rows">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>State</th>
                  <th>Finished</th>
                  <th className="num" title="Runs on this ticket, and how many failed">
                    Runs
                  </th>
                  <th className="num" title="Time agents spent on it, added over its runs">
                    Agent time
                  </th>
                  <th className="num">Turns</th>
                  <th className="num">Tokens</th>
                  <th className="num" title="What the tokens would cost at API prices">
                    Cost
                  </th>
                  <th className="num" title="The ticket's branch against the default branch after its last push: lines added, lines removed, files">
                    Final diff
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.ticketId}>
                    <td className="wide">
                      <div className="row tight">
                        <Link className="ref" to={`/tickets/${t.ticketId}`}>
                          {t.ticket}
                        </Link>
                        {t.size && <Tag>{t.size.toUpperCase()}</Tag>}
                        {t.prUrl && (
                          <a className="with-icon small" href={t.prUrl} target="_blank" rel="noreferrer" title="Pull request">
                            <Icon name="pr" size={13} />#{t.prNumber}
                          </a>
                        )}
                      </div>
                      <div className="small muted truncate">{t.title}</div>
                    </td>
                    <td>
                      <State t={t} />
                    </td>
                    <td className="small" title={`First run started ${clock(t.firstStartedAt)}`}>
                      {t.lastEndedAt ? when(t.lastEndedAt) : '–'}
                    </td>
                    <td className="small num">
                      {t.runs}
                      {t.failedRuns > 0 && <span className="error-text"> · {t.failedRuns} failed</span>}
                    </td>
                    <td className="small num">{hours(t.agentMs)}</td>
                    <td className="small num">{t.turns ?? '–'}</td>
                    <td className="small muted num">{tokens(t.tokens || null)?.replace(' tokens', '') ?? '–'}</td>
                    <td className="small num">{t.costUsd ? money(t.costUsd) : '–'}</td>
                    <td className="small num">
                      <Diff diff={t.diff} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{data.length ? 'No tickets match.' : 'No agent has worked on a ticket yet.'}</Empty>
          )}
        </div>
      )}
    </div>
  );
}
