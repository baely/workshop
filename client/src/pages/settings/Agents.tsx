import { useEffect, useState, type FormEvent } from 'react';
import type { AgentClassView, Billing, ModelOption } from '../../../../server/src/api-types.ts';
import { api, useApi } from '../../api.ts';
import { ErrorNote, Field, Hint, Panel, Segmented } from '../../components/ui.tsx';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BILLING: { value: Billing; label: string }[] = [
  { value: 'subscription', label: 'Subscription' },
  { value: 'api', label: 'API key' },
];

function AgentForm({ agent, models }: { agent: AgentClassView; models: ModelOption[] }) {
  const [draft, setDraft] = useState(agent);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(agent), [agent]);

  const key = (m: { connectionId: number | null; id: string | null }) => `${m.connectionId}:${m.id}`;
  const selected = models.find((m) => key(m) === key({ connectionId: draft.modelConnectionId, id: draft.model }));
  const connections = [...new Map(models.map((m) => [m.connectionId, m.connectionName])).entries()];
  const set = (patch: Partial<AgentClassView>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { model, modelConnectionId, effort, billing, prompt, maxTurns, timeoutMin } = draft;
      await api(`/agents/${agent.name}`, { method: 'PUT', body: { model, modelConnectionId, effort, billing, prompt, maxTurns, timeoutMin } });
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Panel title={agent.label} action={<span className="small muted">{agent.description}</span>}>
      <form className="panel-body stack" onSubmit={save}>
        <div className="fields">
          <Field label="Model" help={!models.length ? 'Add Claude under Connections first.' : undefined}>
            <select
              value={selected ? key(selected) : ''}
              onChange={(e) => {
                const m = models.find((x) => key(x) === e.target.value);
                set({ model: m?.id ?? null, modelConnectionId: m?.connectionId ?? null });
              }}
            >
              <option value="">Choose a model</option>
              {connections.map(([id, name]) => (
                <optgroup key={id} label={name}>
                  {models
                    .filter((m) => m.connectionId === id)
                    .map((m) => (
                      <option key={key(m)} value={key(m)}>
                        {m.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Effort">
            <select value={draft.effort ?? ''} onChange={(e) => set({ effort: e.target.value || null })}>
              <option value="">Model default</option>
              {EFFORTS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span className="field-label">
              Billing
              <Hint>Subscription uses the first Claude subscription in your order (Connections) that isn't over your limits.</Hint>
            </span>
            <Segmented label={`${agent.label} billing`} value={draft.billing} options={BILLING} onChange={(billing) => set({ billing })} />
            {selected && !selected.billing.includes(draft.billing) && (
              <span className="help error-text">
                {selected.connectionName} has no {draft.billing === 'api' ? 'API key' : 'subscription token'}.
              </span>
            )}
          </div>
          <Field label="Max turns">
            <input type="number" min={1} max={2000} value={draft.maxTurns} onChange={(e) => set({ maxTurns: Number(e.target.value) })} />
          </Field>
          <Field label="Time limit (minutes)">
            <input type="number" min={5} max={1440} value={draft.timeoutMin} onChange={(e) => set({ timeoutMin: Number(e.target.value) })} />
          </Field>
        </div>
        <details className="disclosure" open={draft.prompt !== agent.defaultPrompt}>
          <summary>
            Instructions <span className="muted small">{draft.prompt === agent.defaultPrompt ? 'Default' : 'Customised'}</span>
          </summary>
          <div className="stack">
            <textarea rows={14} aria-label="Instructions" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
            {draft.prompt !== agent.defaultPrompt && (
              <div>
                <button type="button" onClick={() => set({ prompt: agent.defaultPrompt })}>
                  Reset to default
                </button>
              </div>
            )}
          </div>
        </details>
        <details className="disclosure">
          <summary>What Workshop adds after these instructions</summary>
          <pre className="mono small wrap">{agent.protocol}</pre>
        </details>
        <ErrorNote error={error} />
        <div className="row">
          <button className="primary">Save</button>
          {saved && <span className="small muted">Saved.</span>}
        </div>
      </form>
    </Panel>
  );
}

export function Agents() {
  const { data: agents, error } = useApi<AgentClassView[]>('/agents', ['agents']);
  const { data: models } = useApi<ModelOption[]>('/models', ['connections']);
  const [name, setName] = useState<string | null>(null);
  const current = agents?.find((a) => a.name === name) ?? agents?.[0];
  const modelLabel = (a: AgentClassView) => models?.find((m) => m.id === a.model && m.connectionId === a.modelConnectionId)?.label ?? a.model ?? 'No model';
  return (
    <div className="master">
      <ErrorNote error={error} />
      <nav className="master-list" aria-label="Agents">
        {agents?.map((a) => (
          <button key={a.name} type="button" aria-current={a === current || undefined} onClick={() => setName(a.name)}>
            <strong>{a.label}</strong>
            <span className="small muted">
              {modelLabel(a)}
              {a.effort ? ` · ${a.effort}` : ''}
            </span>
          </button>
        ))}
      </nav>
      {current && <AgentForm key={current.name} agent={current} models={models ?? []} />}
    </div>
  );
}
