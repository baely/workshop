import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { ConnectionKind, ConnectionView, FieldDef, Installation, ProviderInfo, TestResult } from '../../../../../server/src/api-types.ts';
import { api, useApi } from '../../../api.ts';
import { Icon } from '../../components/Icon.tsx';
import { Empty, ErrorNote, Field, Hint, Menu, Modal, Panel, Status, Tag } from '../../components/ui.tsx';

const SECTIONS: { kind: ConnectionKind; title: string; blurb: string }[] = [
  { kind: 'vcs', title: 'GitHub', blurb: 'Where your code lives. Workshop acts through its own GitHub App, or as you with a personal access token.' },
  { kind: 'tickets', title: 'Ticket sources', blurb: 'Where Workshop finds work to do.' },
  { kind: 'environment', title: 'Agent hosts', blurb: 'Machines with Docker where agent containers run.' },
  { kind: 'model', title: 'Claude', blurb: 'Through your subscription, an API key, or both. Subscription agents use the first subscription in this list that isn\'t paused or over your limits, moving down the list when it is.' },
];

const BANNERS: Record<string, { tone: string; text: string }> = {
  created: { tone: 'ok', text: 'GitHub App created. Next, install it on your account or organisations.' },
  installed: { tone: 'ok', text: 'Installation approved. Refresh the repository list to see its repositories.' },
  'review-installations': { tone: '', text: "GitHub reported an installation Workshop didn't start. Approve it below if it was you." },
};

const visible = (f: FieldDef, values: Record<string, unknown>) => !f.showIf || f.showIf.equals.includes(String(values[f.showIf.key] ?? ''));

function FieldInput(props: { field: FieldDef; value: unknown; saved?: string; connections: ConnectionView[]; onChange: (v: unknown) => void }) {
  const { field, value, saved, connections, onChange } = props;
  const common = {
    required: field.required && !saved,
    placeholder: saved ? `Saved (${saved}). Leave blank to keep it.` : field.placeholder,
    value: value === undefined || value === null ? '' : String(value),
  };
  let input: ReactNode;
  switch (field.type) {
    case 'select':
      input = (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'connection':
      input = (
        <select {...common} onChange={(e) => onChange(Number(e.target.value))}>
          <option value="">Choose…</option>
          {connections
            .filter((c) => c.provider === field.connectionProvider)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      );
      break;
    case 'textarea':
      input = <textarea {...common} className="mono" rows={5} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'number':
      input = <input {...common} type="number" min={0} step="any" onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      input = <input {...common} type={field.type === 'password' ? 'password' : 'text'} autoComplete="off" onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Field label={field.label} hint={field.help}>
      {input}
    </Field>
  );
}

function ConnectionModal(props: { provider: ProviderInfo; connection?: ConnectionView; connections: ConnectionView[]; onClose: () => void }) {
  const { provider, connections, onClose } = props;
  const [connection, setConnection] = useState(props.connection);
  const [name, setName] = useState(connection?.name ?? provider.name);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of provider.fields) initial[f.key] = connection ? connection.config[f.key] : f.defaultValue;
    if (!connection && provider.fields.some((f) => f.type === 'connection')) {
      const f = provider.fields.find((x) => x.type === 'connection')!;
      initial[f.key] = connections.find((c) => c.provider === f.connectionProvider)?.id;
    }
    return initial;
  });
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ connection: ConnectionView; test: TestResult }>(connection ? `/connections/${connection.id}` : '/connections', {
        method: connection ? 'PUT' : 'POST',
        body: { provider: provider.id, name, values },
      });
      setConnection(res.connection); // a second save edits what the first created
      setResult(res.test);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={connection ? `Edit ${connection.name}` : `Add ${provider.name}`} onClose={onClose}>
      <p className="small muted">{provider.description}</p>
      <form className="stack" onSubmit={save}>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <div className="fields">
        {provider.fields
          .filter((f) => visible(f, values))
          .map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={f.secret ? values[f.key] ?? '' : values[f.key]}
              saved={connection?.secrets[f.key]}
              connections={connections}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
            />
          ))}
        </div>
        <ErrorNote error={error} />
        {result && <p className={`notice ${result.ok ? 'ok' : 'error'}`}>{result.ok ? result.message : `Saved, but the check failed: ${result.message}`}</p>}
        <div className="row">
          <button className="primary" disabled={busy}>
            {busy ? 'Checking…' : result ? 'Save and check again' : 'Save and check'}
          </button>
          {result?.ok && (
            <button type="button" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function Installations({ connection }: { connection: ConnectionView }) {
  const { data, error, reload } = useApi<Installation[]>(`/github/${connection.id}/installations`, ['connections']);
  const [actionError, setActionError] = useState<string | null>(null);
  const toggle = (id: number, on: boolean) => {
    const approved = (data ?? []).filter((i) => (i.id === id ? on : i.approved)).map((i) => i.id);
    api(`/github/${connection.id}/installations`, { method: 'PUT', body: { approved } }).then(reload, (e: Error) => setActionError(e.message));
  };
  const install = () => api<{ url: string }>(`/github/${connection.id}/install`).then(({ url }) => window.location.assign(url), (e: Error) => setActionError(e.message));
  return (
    <div className="stack tight small">
      <span className="muted">Installations</span>
      {data && !data.length && <span className="muted">Not installed anywhere yet.</span>}
      {data?.map((i) => (
        <label key={i.id} className="check">
          <input type="checkbox" checked={i.approved} onChange={(e) => toggle(i.id, e.target.checked)} />
          <span>
            {i.account} <span className="muted">({i.repositorySelection === 'all' ? 'all repositories' : 'selected repositories'})</span>
          </span>
        </label>
      ))}
      <ErrorNote error={error ?? actionError} />
      <div>
        <button onClick={install}>
          <Icon name="plus" />
          Install on an account
        </button>
      </div>
    </div>
  );
}

function ConnectionItem(props: { c: ConnectionView; provider: ProviderInfo; onEdit: () => void; extra?: ReactNode; rank?: number; onMove?: (by: -1 | 1) => Promise<unknown>; last?: boolean }) {
  const { c, provider, onEdit, extra, rank, onMove, last } = props;
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const check = () => {
    setBusy(true);
    api<TestResult>(`/connections/${c.id}/test`, { body: {} })
      .then(setTest, (e: Error) => setTest({ ok: false, message: e.message }))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    if (confirm(`Remove ${c.name}? Workshop forgets its settings and credentials.`)) {
      api(`/connections/${c.id}`, { method: 'DELETE' }).catch((e: Error) => setTest({ ok: false, message: e.message }));
    }
  };
  const [toggling, setToggling] = useState(false);
  const isHost = c.kind === 'environment';
  const available = c.config.available !== false;
  const toggle = () => {
    setToggling(true);
    api(`/hosts/${c.id}`, { method: 'PUT', body: { available: !available } })
      .catch((e: Error) => setTest({ ok: false, message: e.message }))
      .finally(() => setToggling(false));
  };
  // Pausing manages subscriptions, so only connections with a subscription token (or already paused) offer it.
  const canPause = c.kind === 'model' && ('oauthToken' in c.secrets || c.paused);
  const pause = () => {
    setToggling(true);
    api(`/connections/${c.id}/paused`, { method: 'PUT', body: { paused: !c.paused } })
      .catch((e: Error) => setTest({ ok: false, message: e.message }))
      .finally(() => setToggling(false));
  };
  const specs = typeof c.config.specs === 'string' ? c.config.specs : null;
  const labelOf = (key: string) => provider.fields.find((f) => f.key === key)?.label ?? key;
  const saved = Object.entries(c.secrets).map(([key, hint]) => `${labelOf(key)} ${hint}`);
  const credentials = saved.length ? `Saved: ${saved.join(', ')}` : null;
  const fail = (e: Error) => setTest({ ok: false, message: e.message });
  return (
    <li className="item column">
      <div className="spread">
        <div className="row">
          <strong>
            {rank !== undefined && <span className="muted">{rank + 1}. </span>}
            {c.name}
          </strong>
          <Status tone={c.status === 'ok' ? 'ok' : c.status === 'error' ? 'error' : 'idle'}>{c.status === 'ok' ? 'Working' : c.status === 'error' ? 'Not working' : 'Not checked yet'}</Status>
          {isHost && !available && <Tag title="No new agents start here. Running agents carry on.">Switched off</Tag>}
          {c.kind === 'model' && c.paused && (
            <Tag title="Subscription agents use your other subscriptions, and running ones move over after their current step. API-billed agents still use its API key.">Paused</Tag>
          )}
        </div>
        <div className="row">
          <button onClick={check} disabled={busy}>
            {busy ? 'Checking…' : 'Check'}
          </button>
          <button onClick={onEdit}>Edit</button>
          <Menu
            label={`More for ${c.name}`}
            items={[
              isHost && { label: available ? 'Switch off' : 'Switch on', icon: available ? 'pause' : 'play', onClick: toggle, disabled: toggling },
              canPause && { label: c.paused ? 'Resume' : 'Pause', icon: c.paused ? 'play' : 'pause', onClick: pause, disabled: toggling },
              onMove && rank !== 0 && { label: 'Move up', icon: 'up', onClick: () => void onMove(-1).catch(fail) },
              onMove && !last && { label: 'Move down', icon: 'down', onClick: () => void onMove(1).catch(fail) },
              { label: 'Remove', icon: 'x', danger: true, onClick: remove },
            ]}
          />
        </div>
      </div>
      {(specs || credentials) && <span className="small muted">{[specs, credentials].filter(Boolean).join(' · ')}</span>}
      {isHost && <HostSlots config={c.config} />}
      {c.status === 'error' && c.error && <span className="small error-text">{c.error}</span>}
      {test && <span className={`small ${test.ok ? '' : 'error-text'}`}>{test.message}</span>}
      {extra}
    </li>
  );
}

/** A host's slots and limits by agent size, as small labels. */
function HostSlots({ config }: { config: Record<string, unknown> }) {
  const n = (key: string) => Number(config[key]) || 0;
  const size = (name: string, prefix: string) => {
    const slots = n(prefix ? `${prefix}Slots` : 'slots');
    if (!slots) return null;
    const cpus = n(prefix ? `${prefix}Cpus` : 'cpus') || n('cpus');
    const memory = n(prefix ? `${prefix}MemoryGb` : 'memoryGb') || n('memoryGb');
    return (
      <Tag key={name} title={`${slots} ${name} agents at once, each with ${cpus || 'unlimited'} CPUs and ${memory || 'unlimited'} GB`}>
        {slots} × {name}
        {memory ? ` · ${memory} GB` : ''}
      </Tag>
    );
  };
  return <div className="row tight">{[size('small', 'small'), size('standard', ''), size('large', 'large')]}</div>;
}

function GitHubSetup({ onExisting }: { onExisting: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // GitHub's App-manifest flow needs a form POST from the browser.
  const start = async () => {
    try {
      const { action, manifest } = await api<{ action: string; manifest: string }>('/github/manifest');
      const form = document.createElement('form');
      form.method = 'post';
      form.action = action;
      const input = Object.assign(document.createElement('input'), { type: 'hidden', name: 'manifest', value: manifest });
      form.append(input);
      document.body.append(form);
      form.submit();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="panel-body stack">
      <ol className="steps">
        <li>Create the App: GitHub shows a pre-filled page. Click Create GitHub App.</li>
        <li>Install it on your account and any organisations, choosing which repositories it can see.</li>
        <li>Turn on the repositories Workshop should work on, under Repositories.</li>
      </ol>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" onClick={start}>
          Create the GitHub App
        </button>
        <button className="link" onClick={onExisting}>
          Use an existing App or a personal access token
        </button>
      </div>
    </div>
  );
}

export function Connections() {
  const { data: providers } = useApi<ProviderInfo[]>('/providers');
  const { data: connections, error } = useApi<ConnectionView[]>('/connections', ['connections']);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<{ provider: ProviderInfo; connection?: ConnectionView } | null>(null);
  if (!providers || !connections) return <ErrorNote error={error} />;

  const banner = params.get('error') ? { tone: 'error', text: params.get('error')! } : BANNERS[params.get('github') ?? ''];
  const providerFor = (id: string) => providers.find((p) => p.id === id)!;
  const move = (items: ConnectionView[], i: number, by: -1 | 1) => {
    const ids = items.map((c) => c.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    return api('/connections/order', { method: 'PUT', body: { ids } });
  };

  return (
    <div className="stack">
      {banner && (
        <p className={`notice ${banner.tone}`}>
          {banner.text}{' '}
          <button className="link" onClick={() => setParams({})}>
            Dismiss
          </button>
        </p>
      )}
      {SECTIONS.map((section) => {
        const items = connections.filter((c) => c.kind === section.kind);
        const addable = providers.filter((p) => p.kind === section.kind && !p.setup);
        return (
          <Panel
            key={section.kind}
            title={
              <>
                {section.title}
                <Hint>{section.blurb}</Hint>
              </>
            }
            action={
              addable.length > 0 && (section.kind !== 'vcs' || items.length > 0) ? (
                <button onClick={() => setEditing({ provider: addable[0] })}>
                  <Icon name="plus" />
                  Add
                </button>
              ) : undefined
            }
          >
            {section.kind === 'vcs' && !items.length ? (
              <GitHubSetup onExisting={() => setEditing({ provider: providerFor('github') })} />
            ) : items.length ? (
              <ul className="list">
                {items.map((c, i) => (
                  <ConnectionItem
                    key={c.id}
                    c={c}
                    {...(section.kind === 'model' && items.length > 1 ? { rank: i, last: i === items.length - 1, onMove: (by: -1 | 1) => move(items, i, by) } : {})}
                    provider={providerFor(c.provider)}
                    onEdit={() => setEditing({ provider: providerFor(c.provider), connection: c })}
                    extra={c.provider === 'github' && c.config.auth !== 'token' ? <Installations connection={c} /> : undefined}
                  />
                ))}
              </ul>
            ) : (
              <Empty>None yet.</Empty>
            )}
          </Panel>
        );
      })}
      {editing && <ConnectionModal provider={editing.provider} connection={editing.connection} connections={connections} onClose={() => setEditing(null)} />}
    </div>
  );
}
