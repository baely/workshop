import { useEffect, useRef, useState } from 'react';
import type { RepoView } from '../../../../../server/src/api-types.ts';
import { api, useApi } from '../../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { Empty, ErrorNote, Field, Panel, Status, Switch, Tag } from '../../components/ui.tsx';
import { repoChanges, type RepoDraft } from '../../../repo-settings.ts';

function RepoRow({ repo, onChange }: { repo: RepoView; onChange: (id: number, body: object) => Promise<unknown> }) {
  const [enabling, setEnabling] = useState<boolean | null>(null);
  const toggle = (enabled: boolean) => {
    setEnabling(enabled);
    onChange(repo.id, { enabled }).finally(() => setEnabling(null));
  };
  const saved = (): RepoDraft => ({ selection: repo.selection, priority: String(repo.priority), image: repo.image ?? '', mergeWithoutReview: repo.mergeWithoutReview, pushToDefault: repo.pushToDefault, raiseTickets: repo.raiseTickets });
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const changes = repoChanges(repo, draft);
  const dirty = Object.keys(changes).length > 0;
  const save = () => {
    setSaving(true);
    onChange(repo.id, changes).finally(() => setSaving(false));
  };
  const [imageTicket, setImageTicket] = useState<{ busy?: boolean; opened?: { number: number; url: string }; error?: string }>({});
  const openImageTicket = () => {
    setImageTicket({ busy: true });
    api<{ number: number; url: string }>(`/repos/${repo.id}/image-ticket`, { body: {} }).then(
      (opened) => setImageTicket({ opened }),
      (e: Error) => setImageTicket({ error: e.message }),
    );
  };
  const [open, setOpen] = useState(false);
  const on = enabling ?? repo.enabled;
  return (
    <li className={`item column${enabling === null ? '' : ' pending'}`} aria-busy={enabling !== null}>
      <div className="spread">
        <div className="row">
          <Switch checked={on} disabled={enabling !== null} onChange={toggle} label={`${on ? 'Turn off' : 'Turn on'} ${repo.fullName}`} />
          <strong>{repo.fullName}</strong>
          {repo.private && <Tag>Private</Tag>}
          {repo.enabled && <Tag>{repo.selection === 'all' ? 'All tickets' : 'Nominated only'}</Tag>}
          {repo.enabled && repo.priority !== 0 && <Tag tone="accent">Priority {repo.priority}</Tag>}
          {repo.enabled && repo.mergeWithoutReview && !repo.pushToDefault && <Tag>Merges without review</Tag>}
          {repo.enabled && repo.pushToDefault && <Tag>Pushes to {repo.defaultBranch}</Tag>}
          {repo.enabled && repo.raiseTickets && <Tag>Raises tickets</Tag>}
          {enabling !== null && <span className="spinner" role="status" aria-label={enabling ? 'Turning on' : 'Turning off'} />}
        </div>
        {repo.enabled && enabling === null && (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="settings" />
            {open ? 'Close' : 'Configure'}
          </button>
        )}
      </div>
      {repo.enabled && repo.mergeWithoutReview && repo.mergeWarning && <Status tone="attention">{repo.mergeWarning}</Status>}
      {repo.enabled && enabling === null && open && (
        <form
          className="stack repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save();
          }}
        >
          <div className="fields">
            <Field label="Tickets to work on" hint="Nominated only: Workshop works on tickets that carry the workshop/nominated label. Add it on GitHub or with Nominate on the ticket.">
              <select value={draft.selection} onChange={(e) => setDraft({ ...draft, selection: e.target.value })}>
                <option value="all">All open tickets</option>
                <option value="nominated">Only nominated tickets</option>
              </select>
            </Field>
            <Field label="Priority" hint="Repositories with a higher priority go first: a lower one waits until every open ticket in the higher ones has been classified.">
              <input type="number" step={1} min={-100} max={100} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} />
            </Field>
            <Field
              label="Agent image"
              hint="For a repository that needs more tools than the standard image. Set up agent image opens a ticket asking an agent to add .workshop/Dockerfile; once you merge it, Workshop builds that image and later runs use it."
            >
              <input className="mono" placeholder="Standard agent image" value={draft.image} onChange={(e) => setDraft({ ...draft, image: e.target.value })} />
            </Field>
          </div>
          <div className="checks">
            <label className="check" title="Merges each pull request as soon as GitHub allows it, without waiting for your approval. Make CI a required status check first.">
              <input type="checkbox" checked={draft.mergeWithoutReview} onChange={(e) => setDraft({ ...draft, mergeWithoutReview: e.target.checked })} />
              Merge without review
            </label>
            <label className="check" title="Reviewed work goes on the default branch as one commit. No pull request is opened and nothing waits for you.">
              <input type="checkbox" checked={draft.pushToDefault} onChange={(e) => setDraft({ ...draft, pushToDefault: e.target.checked })} />
              Push to {repo.defaultBranch}, no pull request
            </label>
            <label className="check" title="When an agent comes across a problem outside its ticket, or work its ticket needs first, Workshop opens a ticket for it.">
              <input type="checkbox" checked={draft.raiseTickets} onChange={(e) => setDraft({ ...draft, raiseTickets: e.target.checked })} />
              Agents open tickets for what they notice
            </label>
          </div>
          <div className="row">
            <button className="primary" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {dirty && !saving && (
              <button type="button" onClick={() => setDraft(saved())}>
                Discard
              </button>
            )}
            <span className="grow" />
            {imageTicket.opened ? (
              <a className="small" href={imageTicket.opened.url} target="_blank" rel="noreferrer">
                Opened #{imageTicket.opened.number}
              </a>
            ) : (
              <button type="button" onClick={openImageTicket} disabled={imageTicket.busy}>
                {imageTicket.busy ? 'Opening ticket…' : 'Set up agent image'}
              </button>
            )}
            {imageTicket.error && <span className="small error-text">{imageTicket.error}</span>}
          </div>
        </form>
      )}
    </li>
  );
}

export function Repositories() {
  const { data, error, reload } = useApi<RepoView[]>('/repos', ['repos']);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const fetchedOnce = useRef(false);

  const refresh = () => {
    setBusy(true);
    setActionError(null);
    api('/repos/refresh', { body: {} })
      .then(reload, (e: Error) => setActionError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    if (data && !data.length && !fetchedOnce.current) {
      fetchedOnce.current = true;
      refresh();
    }
  });
  const update = (id: number, body: object) => api(`/repos/${id}`, { method: 'PUT', body }).then(reload, (e: Error) => setActionError(e.message));
  const shown = (data ?? []).filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()));

  const on = shown.filter((r) => r.enabled);
  const off = shown.filter((r) => !r.enabled);
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search grow">
          <Icon name="search" />
          <input type="search" placeholder="Search repositories" aria-label="Search repositories" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button onClick={refresh} disabled={busy}>
          <Icon name="refresh" />
          {busy ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>
      <ErrorNote error={actionError ?? error} />
      {data && !data.length && <Empty>No repositories yet. Connect GitHub under Connections, then refresh the list.</Empty>}
      {data && data.length > 0 && !shown.length && <Empty>No repositories match.</Empty>}
      {on.length > 0 && (
        <Panel title="Working on" count={on.length}>
          <ul className="list">
            {on.map((r) => (
              <RepoRow key={r.id} repo={r} onChange={update} />
            ))}
          </ul>
        </Panel>
      )}
      {off.length > 0 && (
        <Panel title="Available" count={off.length}>
          <ul className="list">
            {off.map((r) => (
              <RepoRow key={r.id} repo={r} onChange={update} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
