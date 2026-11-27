import { useState, type FormEvent } from 'react';
import type { ApiTokenView, NewApiToken } from '../../../../server/src/api-types.ts';
import { TOKEN_LIFETIMES } from '../../access.ts';
import { api, useApi, useNow } from '../../api.ts';
import { Empty, ErrorNote, Panel } from '../../components/ui.tsx';
import { ago, clock } from '../../format.ts';

/** A weekday is enough for the next few days; further out needs the date. */
const expiry = (ms: number, now: number) => (ms - now < 6 * 86400_000 ? clock(ms) : new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }));

export function Tokens() {
  const { data, error } = useApi<ApiTokenView[]>('/tokens', ['tokens']);
  const [name, setName] = useState('');
  const [lifetime, setLifetime] = useState('1 day');
  const [readOnly, setReadOnly] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    try {
      const made = await api<NewApiToken>('/tokens', {
        method: 'POST',
        body: { name, scope: readOnly ? 'read' : 'write', expiresInMinutes: TOKEN_LIFETIMES.find((l) => l.label === lifetime)?.minutes ?? null },
      });
      setCreated(made.token);
      setName('');
    } catch (err) {
      setProblem((err as Error).message);
    }
  };
  const revoke = async (t: ApiTokenView) => {
    if (!confirm(`Revoke "${t.name}"? Anything using it stops working.`)) return;
    setProblem(null);
    try {
      await api(`/tokens/${t.id}`, { method: 'DELETE' });
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  return (
    <Panel
      title="API tokens"
      count={data?.length}
      action={
        <a className="small" href="/api/openapi.json" target="_blank" rel="noreferrer" title="Scripts and agents can use Workshop's API with a token. See docs/api.md.">
          API schema
        </a>
      }
    >
      <form className="panel-body row" onSubmit={create}>
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. home automation" aria-label="Token name" maxLength={60} required />
        <select value={lifetime} onChange={(e) => setLifetime(e.target.value)} aria-label="Token lifetime">
          {TOKEN_LIFETIMES.map((l) => (
            <option key={l.label} value={l.label}>
              {l.label === 'Never' ? 'Never expires' : `Expires in ${l.label}`}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
          Read only
        </label>
        <button className="primary">Create token</button>
      </form>
      <div className="panel-body stack flush-top">
        <ErrorNote error={error ?? problem} />
        {created && (
          <div className="notice ok stack">
            <div className="row">
              <input readOnly className="mono grow" value={created} aria-label="New API token" onFocus={(e) => e.target.select()} />
              <button type="button" onClick={() => void navigator.clipboard?.writeText(created)}>
                Copy
              </button>
            </div>
            <span className="small muted">Copy this token now. Workshop won't show it again.</span>
          </div>
        )}
        {data && !data.length && <Empty>No tokens yet.</Empty>}
        {data && data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Access</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.scope === 'read' ? 'Read only' : 'Full'}</td>
                    <td>{ago(t.createdAt)}</td>
                    <td>{t.lastUsedAt ? ago(t.lastUsedAt) : 'Never'}</td>
                    <td className={t.expiresAt !== null && t.expiresAt <= now ? 'muted' : undefined}>{t.expiresAt === null ? 'Never' : t.expiresAt <= now ? 'Expired' : expiry(t.expiresAt, now)}</td>
                    <td>
                      <button type="button" className="danger" onClick={() => void revoke(t)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

