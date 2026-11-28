import { useState } from 'react';
import { Link } from 'react-router';
import type { AlertView, ConnectionView, HostView, Overview, QueueItem, RepoView, RunView, Settings, TicketView } from '../../../../server/src/api-types.ts';
import { api, useApi, useNow } from '../../api.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorNote, IconButton, PageHead, Panel, Stat, Status, Tag, useAction } from '../components/ui.tsx';
import { AGENT_LABEL, clock, duration, runStatus } from '../../format.ts';

/** Why a run that isn't working is waiting, in a few words. */
export function runNote(run: RunView): string | null {
  if (run.status === 'paused' && run.pauseReason === 'threshold') return `Resumes under your limit${run.resetsAt ? `, by ${clock(run.resetsAt)}` : ''}`;
  if (run.status === 'paused' && (run.pauseReason ?? 'limit') === 'limit' && run.resetsAt) return `Resumes after ${clock(run.resetsAt)}`;
  if (run.status === 'paused' && run.pauseReason === 'manual') return 'Waits for you to resume it';
  if (run.status === 'paused' && run.pauseReason === 'connection') return 'Moving to another Claude subscription';
  if (run.pauseRequested) return 'Pauses after the current step';
  if (run.publishRetryAt) return `Publishes again after ${clock(run.publishRetryAt)}`;
  return null;
}

function RunRow({ run, now }: { run: RunView; now: number }) {
  const status = runStatus(run);
  const note = runNote(run);
  return (
    <li className="item">
      <div className="item-main">
        <div className="item-title">
          <Status tone={status.tone}>
            <Link to={`/runs/${run.id}`}>{AGENT_LABEL[run.agent]}</Link>
          </Status>
          <Link className="ref" to={`/tickets/${run.ticketId}`}>
            {run.ticket}
          </Link>
          <span className="truncate">{run.ticketTitle}</span>
        </div>
        {run.status === 'running' && run.activity ? <div className="mono muted truncate">{run.activity}</div> : (note || run.status !== 'running') && <div className="small muted">{note ?? status.label}</div>}
      </div>
      <div className="item-side small muted">
        <span title={`Started ${clock(run.startedAt)} on ${run.environment ?? 'a removed host'}`}>{duration(run.startedAt, now)}</span>
        <span className="truncate" title={run.model}>
          {run.model.replace(/^claude-/, '')}
        </span>
      </div>
    </li>
  );
}

const ATTENTION: Record<NonNullable<TicketView['attention']>, { label: string; act: string; tone: 'attention' | 'error' }> = {
  question: { label: 'Question', act: 'Answer on GitHub', tone: 'attention' },
  failed: { label: 'Stopped', act: 'Read why', tone: 'error' },
  review: { label: 'Review', act: 'Review pull request', tone: 'attention' },
};

function NeedsYou({ ticket, dismissed }: { ticket: TicketView; dismissed?: boolean }) {
  const { busy, error, run } = useAction();
  const kind = ATTENTION[ticket.attention ?? 'review'];
  const href = ticket.attention === 'review' ? (ticket.prUrl ?? ticket.url) : ticket.url;
  const name = `${ticket.repo}#${ticket.number}`;
  const hint =
    ticket.attention === 'question'
      ? 'Answer on the ticket, then remove the workshop/needs-info label.'
      : ticket.attention === 'failed'
        ? 'Read the comment, then remove workshop/failed to retry.'
        : undefined;
  return (
    <li className="item">
      <div className="item-main">
        <div className="item-title">
          <Tag tone={kind.tone}>{kind.label}</Tag>
          <Link className="ref" to={`/tickets/${ticket.id}`}>
            {name}
          </Link>
        </div>
        <div className="truncate">{ticket.title}</div>
        {error && <span className="small error-text">{error}</span>}
      </div>
      <div className="item-side">
        <a className="button small" href={href} target="_blank" rel="noreferrer" title={hint}>
          {kind.act}
          <Icon name="external" size={13} />
        </a>
        <IconButton
          icon={dismissed ? 'up' : 'x'}
          label={dismissed ? `Bring back ${name}` : `Dismiss ${name} until it needs you for something new`}
          disabled={busy}
          onClick={() => void run(() => api(`/tickets/${ticket.id}/dismissed`, { method: 'PUT', body: { dismissed: !dismissed } }))}
        />
      </div>
    </li>
  );
}

function QueueRow({ q }: { q: QueueItem }) {
  return (
    <li className="item">
      <div className="item-main">
        <div className="item-title">
          <Link className="ref" to={`/tickets/${q.ticketId}`}>
            {q.ticket}
          </Link>
          <span className="truncate">{q.title}</span>
        </div>
        {q.blockedBy && <div className="small muted">Waiting: {q.blockedBy}</div>}
        {q.after.length > 0 && <div className="small muted">After {q.after.join(', ')} (higher priority)</div>}
        {q.unblocks > 0 && (
          <div className="small muted">
            Unblocks {q.unblocks} open {q.unblocks === 1 ? 'ticket' : 'tickets'}
          </div>
        )}
      </div>
      <div className="item-side">
        {q.push && <Tag tone="accent">Pushed</Tag>}
        {q.prioritised && !q.push && <Tag tone="accent" icon="star">Priority</Tag>}
        {!q.push && !q.prioritised && q.prioritisedFor.length > 0 && <Tag tone="accent">Priority for {q.prioritisedFor.join(', ')}</Tag>}
        {q.bypassLimits && <Tag title="Ignores your usage limits">No limits</Tag>}
        <Tag>{q.next}</Tag>
      </div>
    </li>
  );
}

function Host({ h }: { h: HostView }) {
  const pools = h.pools ?? [{ size: 'standard' as const, slots: h.slots, busy: h.busy }];
  return (
    <li className="item column">
      <div className="spread">
        <strong>{h.name}</strong>
        {h.status === 'ok' ? (
          <span className="small muted num">
            {h.busy}/{h.slots}
          </span>
        ) : (
          <Status tone={h.status === 'error' ? 'error' : 'idle'}>{h.status === 'error' ? 'Unreachable' : 'Not checked yet'}</Status>
        )}
      </div>
      {h.status === 'ok' &&
        pools.map((p) => (
          <div key={p.size} className="cap" title={`${p.busy} of ${p.slots} ${p.size} agents running`}>
            {h.pools && <span className="small muted">{p.size}</span>}
            <div className="cap-track" style={{ gridTemplateColumns: `repeat(${p.slots}, 1fr)` }}>
              {Array.from({ length: p.slots }, (_, i) => (
                <span key={i} className={i < p.busy ? 'on' : undefined} />
              ))}
            </div>
            {h.pools && (
              <span className="small muted num">
                {p.busy}/{p.slots}
              </span>
            )}
          </div>
        ))}
      {!h.available && <span className="small muted">Switched off for new agents</span>}
    </li>
  );
}

function AlertRow({ a }: { a: AlertView }) {
  const { busy, run } = useAction();
  return (
    <li className={`alert ${a.level}`}>
      <Icon name={a.level === 'info' ? 'info' : 'alert'} />
      <span className="grow">{a.message}</span>
      <span className="small muted">{clock(a.createdAt)}</span>
      {a.runId && (
        <Link className="small" to={`/runs/${a.runId}`}>
          View run
        </Link>
      )}
      <IconButton icon="check" label="Acknowledge" disabled={busy} onClick={() => void run(() => api(`/alerts/${a.id}/ack`, { body: {} }))} />
    </li>
  );
}

function setupSteps(connections: ConnectionView[], repos: RepoView[], settings: Settings | undefined, overview: Overview) {
  const has = (kind: ConnectionView['kind']) => connections.some((c) => c.kind === kind);
  const steps: { text: string; to: string }[] = [];
  if (!has('vcs')) steps.push({ text: 'Connect GitHub', to: '/settings/connections' });
  if (!has('environment')) steps.push({ text: 'Add an agent host (a machine with Docker)', to: '/settings/connections' });
  if (!has('model')) steps.push({ text: 'Add Claude', to: '/settings/connections' });
  if (has('vcs') && !repos.some((r) => r.enabled)) steps.push({ text: 'Choose the repositories Workshop works on', to: '/settings/repositories' });
  if (settings && !settings.authors.length) steps.push({ text: 'Add your GitHub username to ticket authors', to: '/settings' });
  if (!steps.length && overview.mode === 'paused') steps.push({ text: 'Workshop is paused. Switch it to Scheduled or Always on in the top bar when you’re ready.', to: '/settings' });
  return steps;
}

export function Dashboard() {
  const { data, error } = useApi<Overview>('/overview', ['runs', 'tickets', 'alerts', 'connections', 'settings', 'allowance', 'agents', 'repos']);
  const { data: connections } = useApi<ConnectionView[]>('/connections', ['connections']);
  const { data: repos } = useApi<RepoView[]>('/repos', ['repos']);
  const { data: settings } = useApi<Settings>('/settings', ['settings']);
  const now = useNow();
  const [showDismissed, setShowDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  if (!data) return <ErrorNote error={error} />;

  const steps = connections && repos ? setupSteps(connections, repos, settings, data) : [];
  const ready = data.queue.filter((q) => !q.blockedBy).length;
  const working = data.running.filter((r) => r.status !== 'paused').length;
  const paused = data.running.length - working;
  const slots = data.hosts.reduce((n, h) => n + (h.status === 'ok' ? h.slots : 0), 0);
  const busy = data.hosts.reduce((n, h) => n + h.busy, 0);
  const refresh = () => {
    setRefreshing(true);
    api('/refresh', { body: {} }).finally(() => setTimeout(() => setRefreshing(false), 1500));
  };
  return (
    <div className="stack">
      <PageHead title="Home">
        <button onClick={refresh} disabled={refreshing} title="Sync tickets, check Claude usage and start or resume what's ready, without waiting for the next check">
          <Icon name="refresh" />
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </PageHead>
      {steps.length > 0 && (
        <Panel title="Finish setting up">
          <ul className="list">
            {steps.map((s) => (
              <li key={s.text} className="item">
                <Link to={s.to}>{s.text}</Link>
                <Icon name="chevron" />
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {data.alerts.length > 0 && (
        <ul className="alerts">
          {data.alerts.slice(0, 3).map((a) => (
            <AlertRow key={a.id} a={a} />
          ))}
          {data.alerts.length > 3 && (
            <li className="small">
              <Link to="/alerts">{data.alerts.length - 3} more alerts</Link>
            </li>
          )}
        </ul>
      )}
      <div className="stats">
        <Stat label="Working" value={working} sub={paused ? `${paused} paused` : undefined} tone={working ? 'running' : undefined} to="/runs" />
        <Stat label="Needs you" value={data.needsYou.length} tone={data.needsYou.length ? 'attention' : undefined} />
        <Stat label="Up next" value={data.queue.length} sub={data.queue.length ? `${ready} ready` : undefined} to="/tickets" />
        <Stat label="Agent slots" value={slots ? `${busy}/${slots}` : '–'} sub={slots ? `${Math.max(0, slots - busy)} free` : 'No host online'} />
      </div>
      <div className="split">
        <div className="stack">
          <Panel title="Working now" count={data.running.length} action={<Link to="/runs">All runs</Link>}>
            {data.running.length ? (
              <ul className="list">
                {data.running.map((r) => (
                  <RunRow key={r.id} run={r} now={now} />
                ))}
              </ul>
            ) : (
              <Empty>Nothing running.</Empty>
            )}
          </Panel>
          {data.publishWaiting.length > 0 && (
            <Panel title="Waiting to publish" count={data.publishWaiting.length}>
              <ul className="list">
                {data.publishWaiting.map((r) => (
                  <RunRow key={r.id} run={r} now={now} />
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Up next" count={data.queue.length} action={<Link to="/tickets">All tickets</Link>}>
            {data.queue.length ? (
              <ul className="list">
                {data.queue.slice(0, 8).map((q) => (
                  <QueueRow key={q.ticketId} q={q} />
                ))}
              </ul>
            ) : (
              <Empty>No tickets are ready for an agent.</Empty>
            )}
          </Panel>
        </div>
        <div className="stack">
          <Panel
            title="Needs you"
            count={data.needsYou.length}
            action={
              data.dismissed.length > 0 && (
                <button className="link small" onClick={() => setShowDismissed(!showDismissed)}>
                  {showDismissed ? 'Hide dismissed' : `${data.dismissed.length} dismissed`}
                </button>
              )
            }
          >
            {data.needsYou.length || (showDismissed && data.dismissed.length) ? (
              <ul className="list">
                {data.needsYou.map((t) => (
                  <NeedsYou key={t.id} ticket={t} />
                ))}
                {showDismissed && data.dismissed.map((t) => <NeedsYou key={t.id} ticket={t} dismissed />)}
              </ul>
            ) : (
              <Empty>Nothing is waiting on you.</Empty>
            )}
          </Panel>
          <Panel title="Agent hosts" action={<Link to="/settings/connections">Manage</Link>}>
            {data.hosts.length ? (
              <ul className="list">
                {data.hosts.map((h) => (
                  <Host key={h.id} h={h} />
                ))}
              </ul>
            ) : (
              <Empty>
                No agent hosts yet. <Link to="/settings/connections">Add one</Link>.
              </Empty>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
