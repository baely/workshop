import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Push, Size, Stage, TicketStatePatch, TicketView } from '../../../server/src/api-types.ts';
import { api, useApi } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorNote, Menu, Modal, PageHead, Segmented, Status, Tag, useAction, type MenuItem } from '../components/ui.tsx';
import { STAGE_TEXT } from '../format.ts';

export const COLUMNS: { title: string; match: (t: TicketView) => boolean }[] = [
  { title: 'To classify', match: (t) => t.stage === null || t.stage === 'reclassify' },
  { title: 'Design', match: (t) => t.stage === 'design' },
  { title: 'Design review', match: (t) => t.stage === 'design-review' },
  { title: 'Implementation', match: (t) => t.stage === 'implement' },
  { title: 'Code review', match: (t) => t.stage === 'code-review' },
  { title: 'Your review', match: (t) => t.stage === 'pr-review' },
  // Reconcile is rare and the Merge agent works it, so it shares the Merge column.
  { title: 'Merge', match: (t) => t.stage === 'merge' || t.stage === 'reconcile' },
];

const FILTERS: { label: string; match: (t: TicketView) => boolean }[] = [
  { label: 'All', match: (t) => !t.skipped },
  { label: 'Needs you', match: (t) => !t.skipped && (t.needsInfo || (t.stage === 'pr-review' && t.prStatus !== 'changes_requested')) },
  { label: 'Running', match: (t) => !t.skipped && Boolean(t.activeRunId) },
  { label: 'Failed', match: (t) => !t.skipped && t.failed },
  { label: 'Skipped', match: (t) => t.skipped },
];

export function TicketStatus({ t }: { t: TicketView }) {
  if (t.activeRunId) {
    return (
      <Link to={`/runs/${t.activeRunId}`}>
        <Status tone="running">Agent working</Status>
      </Link>
    );
  }
  if (t.failed) return <Status tone="error">Stopped after failures</Status>;
  if (t.needsInfo) return <Status tone="attention">Waiting for your answer</Status>;
  if (t.skipped) return <Status tone="idle">Skipped</Status>;
  return null;
}

/**
 * What you can do to a ticket, as menu items: nominate it, move it up the queue, push it through
 * its stages, lift your usage limits for it, or change its labels by hand.
 */
export function useTicketActions(t: TicketView): { items: (MenuItem | false)[]; busy: boolean; error: string | null; editor: ReactNode } {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const put = (path: string, body: object) => () => void run(() => api(`/tickets/${t.id}/${path}`, { method: 'PUT', body }));
  const push = (scope: Push) => () => void run(() => api(`/tickets/${t.id}/push`, { body: { scope } }));
  const open = t.state === 'open';
  const inScope = t.nominated !== false;
  const canPush = inScope && !t.push && Boolean(t.next) && t.stage !== 'pr-review';
  const items: (MenuItem | false)[] = [
    t.nominated === false && open && { label: 'Nominate', icon: 'plus', onClick: put('nominated', { nominated: true }) },
    canPush && !t.activeRunId && { label: 'Run next stage', icon: 'play', onClick: push('stage') },
    canPush && { label: 'Run until it needs you', icon: 'play', onClick: push('lifecycle') },
    inScope && Boolean(t.push) && { label: 'Cancel push', icon: 'x', onClick: () => void run(() => api(`/tickets/${t.id}/push`, { method: 'DELETE' })) },
    inScope && open && !t.prioritised && { label: 'Prioritise', icon: 'star', onClick: put('prioritised', { prioritised: true }) },
    inScope && t.prioritised && { label: 'Remove priority', icon: 'star', onClick: put('prioritised', { prioritised: false }) },
    inScope && open && !t.bypassLimits && {
      label: 'Ignore usage limits',
      icon: 'up',
      onClick: put('bypass-limits', { bypassLimits: true }),
      title: 'Agents on this ticket keep going past your 5-hour and weekly limits. Limits Claude reports still stop them.',
    },
    inScope && t.bypassLimits && { label: 'Respect usage limits', icon: 'down', onClick: put('bypass-limits', { bypassLimits: false }) },
    !t.activeRunId && { label: 'Change status', icon: 'settings', onClick: () => setEditing(true) },
    t.nominated === true && { label: 'Withdraw nomination', icon: 'x', onClick: put('nominated', { nominated: false }) },
    { label: 'Open on GitHub', icon: 'external', href: t.url },
  ];
  return { items: items.map((i) => (i && busy ? { ...i, disabled: true } : i)), busy, error, editor: editing ? <StatusEditor t={t} onClose={() => setEditing(false)} /> : null };
}

/** The flags on a ticket, as small labels. */
export function TicketTags({ t }: { t: TicketView }) {
  return (
    <>
      {t.size && <Tag>{t.size.toUpperCase()}</Tag>}
      {t.prioritised && <Tag tone="accent" icon="star">Priority</Tag>}
      {t.push && <Tag tone="accent" title={t.push === 'stage' ? 'Pushed: next stage only' : 'Pushed: until it needs you'}>Pushed</Tag>}
      {t.bypassLimits && <Tag title="Ignores your usage limits">No limits</Tag>}
      {t.nominated === false && <Tag title="Not nominated: Workshop leaves it alone">Not nominated</Tag>}
    </>
  );
}

const STAGE_OPTIONS: { value: Stage | ''; text: string }[] = [
  { value: '', text: 'To classify' },
  ...(Object.entries(STAGE_TEXT) as [Stage, string][]).map(([value, text]) => ({ value, text })),
];
const SIZE_OPTIONS: Size[] = ['xs', 's', 'm', 'l', 'xl'];

function StatusEditor({ t, onClose }: { t: TicketView; onClose: () => void }) {
  const [stage, setStage] = useState<Stage | ''>(t.stage ?? '');
  const [size, setSize] = useState<Size | ''>(t.size ?? '');
  const [needsInfo, setNeedsInfo] = useState(t.needsInfo);
  const [skip, setSkip] = useState(t.skipped);
  const [failed, setFailed] = useState(t.failed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch: TicketStatePatch = {};
  if (stage !== (t.stage ?? '')) patch.stage = stage || null;
  if (size !== (t.size ?? '')) patch.size = size || null;
  if (needsInfo !== t.needsInfo) patch.needsInfo = needsInfo;
  if (skip !== t.skipped) patch.skip = skip;
  if (failed !== t.failed) patch.failed = failed;
  const changed = Object.keys(patch).length > 0;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    api(`/tickets/${t.id}/state`, { method: 'PUT', body: patch })
      .then(onClose)
      .catch((err: Error) => {
        setError(err.message);
        setBusy(false);
      });
  };
  return (
    <Modal title={`Change status of #${t.number}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Stage</span>
          <select value={stage} onChange={(e) => setStage(e.target.value as Stage | '')}>
            {STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.text}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Size</span>
          <select value={size} onChange={(e) => setSize(e.target.value as Size | '')}>
            <option value="">Not sized</option>
            {SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={needsInfo} onChange={(e) => setNeedsInfo(e.target.checked)} />
          <span>Waiting for your answer (needs-info)</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          <span>Skipped</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} />
          <span>Stopped after failures</span>
        </label>
        <p className="small muted">Workshop changes the issue's workshop labels. The next stage starts when Workshop's mode allows it.</p>
        <ErrorNote error={error} />
        <div className="row">
          <button className="primary" disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save labels on GitHub'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Card({ t, showRepo }: { t: TicketView; showRepo: boolean }) {
  const { items, error, editor } = useTicketActions(t);
  const pr = t.prStatus === 'conflict' ? 'conflicts' : t.prStatus === 'blocked' ? 'checks' : null;
  return (
    <article className={t.prioritised ? 'card prioritised' : 'card'}>
      <div className="card-top">
        <Link className="ref" to={`/tickets/${t.id}`}>
          {showRepo ? `${t.repo.split('/').pop()}#${t.number}` : `#${t.number}`}
        </Link>
        <Menu label={`Actions for #${t.number}`} items={items} />
      </div>
      <Link className="card-title" to={`/tickets/${t.id}`}>
        {t.title}
      </Link>
      <div className="row tight">
        <TicketTags t={t} />
      </div>
      <TicketStatus t={t} />
      {(t.prUrl || t.mediaCount > 0) && (
        <div className="row small">
          {t.prUrl && (
            <a className="with-icon" href={t.prUrl} target="_blank" rel="noreferrer" title="Pull request">
              <Icon name="pr" size={14} />#{t.prNumber}
              {pr && <span className="muted">({pr})</span>}
            </a>
          )}
          {t.mediaCount > 0 && (
            <Link className="with-icon" to={`/tickets/${t.id}/media`} title="Screenshots">
              <Icon name="image" size={14} />
              {t.mediaCount}
            </Link>
          )}
        </div>
      )}
      {t.next && !t.activeRunId && <span className="small muted">Next: {t.next}</span>}
      <ErrorNote error={error} />
      {editor}
    </article>
  );
}

export function Tickets() {
  const { data, error } = useApi<TicketView[]>('/tickets', ['tickets', 'runs']);
  const [repo, setRepo] = useState('');
  const [filter, setFilter] = useState(FILTERS[0].label);
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const repos = [...new Set((data ?? []).map((t) => t.repo))].sort();
  const match = FILTERS.find((f) => f.label === filter)!.match;
  const q = query.trim().toLowerCase();
  const inRepo = (data ?? []).filter((t) => !repo || t.repo === repo);
  const shown = inRepo.filter((t) => match(t) && (!q || t.title.toLowerCase().includes(q) || `#${t.number}`.includes(q)));

  const sync = () => {
    setSyncing(true);
    api('/sync', { body: {} }).finally(() => setTimeout(() => setSyncing(false), 1500));
  };

  return (
    <div className="stack">
      <PageHead title="Tickets">
        <button onClick={sync} disabled={syncing}>
          <Icon name="refresh" />
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </PageHead>
      <div className="toolbar">
        <Segmented label="Show" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.label, label: <>{f.label} <span className="count">{inRepo.filter(f.match).length}</span></> }))} />
        <div className="search">
          <Icon name="search" />
          <input type="search" placeholder="Search tickets" aria-label="Search tickets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {repos.length > 1 && (
          <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Repository">
            <option value="">All repositories</option>
            {repos.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        )}
      </div>
      <ErrorNote error={error} />
      {data && !data.length && (
        <p className="notice">
          No open tickets from your ticket authors in enabled repositories yet. Check <Link to="/settings/repositories">Repositories</Link> and <Link to="/settings">Settings</Link>, or open an
          issue on GitHub.
        </p>
      )}
      <div className="board">
        {COLUMNS.map((col) => {
          const tickets = shown.filter(col.match).sort((a, b) => Number(b.prioritised) - Number(a.prioritised));
          return (
            <section key={col.title} className={tickets.length ? 'column' : 'column none'} aria-label={col.title}>
              <h3>
                {col.title} <span className="count">{tickets.length}</span>
              </h3>
              {tickets.map((t) => (
                <Card key={t.id} t={t} showRepo={!repo && repos.length > 1} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
