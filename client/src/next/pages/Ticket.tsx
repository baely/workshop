import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { MediaItem, RunView, TicketLifecycle, TicketRefView, TicketView } from '../../../../server/src/api-types.ts';
import { useApi, useNow } from '../../api.ts';
import { Gallery, plainClick } from '../../components/Gallery.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorNote, Menu, Panel, Status, Tabs, Tag } from '../components/ui.tsx';
import { AGENT_LABEL, clock, duration, runStatus, STAGE_TEXT } from '../../format.ts';
import { TicketStatus, TicketTags, useTicketActions } from './Tickets.tsx';

const stageText = (r: RunView) => AGENT_LABEL[r.agent] + (r.mode === 'delta' ? ', requested changes' : '') + (r.attempt > 1 ? `, attempt ${r.attempt}` : '');

function Thumbs({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <div className="media-grid thumbs">
      {items.map((m) => (
        <figure key={m.name}>
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (plainClick(e)) {
                e.preventDefault();
                setOpen(m.name);
              }
            }}
          >
            <img src={m.url} alt={m.caption ?? m.name} loading="lazy" />
          </a>
          <figcaption className="small muted clamp">{m.caption ?? m.name}</figcaption>
        </figure>
      ))}
      {open && <Gallery items={items} name={open} onSelect={setOpen} onClose={close} />}
    </div>
  );
}

/** Ticket refs, each linked to its page when Workshop tracks it. */
function Refs({ refs }: { refs: TicketRefView[] }) {
  return refs.map((r, i) => (
    <span key={r.ref}>
      {i > 0 && ', '}
      {r.ticketId === null ? r.ref : <Link to={`/tickets/${r.ticketId}`}>{r.ref}</Link>}
    </span>
  ));
}

/** A ticket's title, state and actions, with the tabs for its timeline and screenshots. */
export function TicketHead({ t, mediaCount }: { t: TicketView; mediaCount: number }) {
  const { items, error, editor } = useTicketActions(t);
  const primary = items.find((i) => i && i.icon === 'play') || null;
  return (
    <>
      <div className="page-head">
        <div className="page-title">
          <div className="row small muted">
            <Link to="/tickets">Tickets</Link>
            <Icon name="chevron" size={12} />
            <span>
              {t.repo}#{t.number}
            </span>
          </div>
          <h1>{t.title}</h1>
          <div className="row tight">
            <Tag tone="accent">{t.stage ? STAGE_TEXT[t.stage] : 'To classify'}</Tag>
            <TicketTags t={t} />
            {t.state === 'closed' && <Tag>Closed</Tag>}
            <TicketStatus t={t} />
            {t.next && !t.activeRunId && <span className="small muted">Next: {t.next}</span>}
          </div>
          {t.dependsOn.length > 0 && (
            <div className="small muted">
              Depends on <Refs refs={t.dependsOn} />
            </div>
          )}
          {!t.prioritised && t.prioritisedFor.length > 0 && (
            <div className="small muted">
              Prioritised because <Refs refs={t.prioritisedFor} /> {t.prioritisedFor.length > 1 ? 'depend' : 'depends'} on it
            </div>
          )}
        </div>
        <div className="row">
          {t.prUrl && (
            <a className="button" href={t.prUrl} target="_blank" rel="noreferrer">
              <Icon name="pr" />
              Pull request #{t.prNumber}
            </a>
          )}
          {primary && primary.onClick && (
            <button className="primary" onClick={primary.onClick} disabled={primary.disabled}>
              <Icon name="play" />
              {primary.label}
            </button>
          )}
          <Menu label="More actions" items={items.filter((i) => i !== primary)} />
        </div>
      </div>
      <ErrorNote error={error} />
      {editor}
      <Tabs
        label="Ticket"
        items={[
          { to: `/tickets/${t.id}`, label: 'Timeline', end: true },
          { to: `/tickets/${t.id}/media`, label: <>Screenshots <span className="count">{mediaCount}</span></> },
        ]}
      />
    </>
  );
}

export function Ticket() {
  const { id } = useParams();
  const { data, error } = useApi<TicketLifecycle>(`/tickets/${id}`, ['tickets', 'runs', 'media']);
  const now = useNow();
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const { ticket: t, runs, media } = data;
  const runIds = new Set(runs.map((r) => r.id));
  const loose = media.filter((m) => !m.runId || !runIds.has(m.runId));
  return (
    <div className="stack">
      <TicketHead t={t} mediaCount={media.length} />
      {runs.length || loose.length ? (
        <ol className="timeline">
          {loose.length > 0 && (
            <li>
              <div className="timeline-head">
                <strong>From the issue and earlier runs</strong>
              </div>
              <Thumbs items={loose} />
            </li>
          )}
          {runs.map((r) => {
            const status = runStatus(r);
            const shots = media.filter((m) => m.runId === r.id);
            return (
              <li key={r.id} className={status.tone}>
                <div className="timeline-head">
                  <Link to={`/runs/${r.id}`}>
                    <strong>{stageText(r)}</strong>
                  </Link>
                  <Status tone={status.tone}>{status.label}</Status>
                  <span className="small muted" title={`${r.model} on ${r.environment ?? 'a removed host'}`}>
                    {clock(r.startedAt)} · {duration(r.startedAt, r.endedAt ?? now)} · {r.model.replace(/^claude-/, '')}
                  </span>
                </div>
                {r.activity && <span className="mono muted truncate">{r.activity}</span>}
                {r.summary && <Markdown text={r.summary} />}
                {r.error && <span className="error-text wrap">{r.error}</span>}
                {shots.length > 0 && <Thumbs items={shots} />}
              </li>
            );
          })}
        </ol>
      ) : (
        <Panel title="Timeline">
          <Empty>No agent has worked on this ticket yet.</Empty>
        </Panel>
      )}
    </div>
  );
}
