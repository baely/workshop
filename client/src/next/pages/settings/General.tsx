import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Limits as SubLimits, Settings, StatusSummary, TicketOrder, Usage } from '../../../../../server/src/api-types.ts';
import { api, useApi } from '../../../api.ts';
import { ModeSwitch } from '../../components/Layout.tsx';
import { ErrorNote, Empty, Field, Panel } from '../../components/ui.tsx';
import { setNewInterface } from '../../../interface.ts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORDERS: { value: TicketOrder; label: string }[] = [
  { value: 'updated-asc', label: 'Least recently updated first' },
  { value: 'updated-desc', label: 'Most recently updated first' },
  { value: 'created-asc', label: 'Oldest first' },
  { value: 'created-desc', label: 'Newest first' },
];
const ZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

function NumberField({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: ReactNode; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} required />
    </Field>
  );
}

/** A draft of the settings, with what's needed to edit and save part of them. */
function useSettings() {
  const { data, error } = useApi<Settings>('/settings', ['settings']);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);
  const set = (patch: Partial<Settings>) => {
    if (draft) setDraft({ ...draft, ...patch });
    setSaved(false);
  };
  const save = (work: () => Promise<unknown>) => async (e: FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      await work();
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message);
    }
  };
  return { draft, error, set, save, saved, saveError, touch: () => setSaved(false) };
}

function SaveBar({ saved, error }: { saved: boolean; error: string | null }) {
  return (
    <>
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary">Save</button>
        {saved && <span className="small muted">Saved.</span>}
      </div>
    </>
  );
}

export function General() {
  const { draft, error, set, save, saved, saveError, touch } = useSettings();
  const { data: overview } = useApi<StatusSummary>('/status', ['settings']);
  const [authors, setAuthors] = useState<string | null>(null);
  if (!draft) return <ErrorNote error={error} />;
  const toggleDay = (d: number) => set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort() });
  const submit = save(() => {
    const { mode: _mode, ...rest } = draft; // the mode switch saves at once
    return api('/settings', { method: 'PUT', body: { ...rest, authors: (authors ?? draft.authors.join(', ')).split(/[\s,]+/).filter(Boolean) } });
  });
  return (
    <form className="stack" onSubmit={submit}>
      <Panel title="Schedule">
        <div className="panel-body stack">
          <Field label="Mode" hint="Paused starts no new agents. Scheduled starts them only inside the hours below. Agents already running always finish.">
            {overview && <ModeSwitch mode={overview.mode} withinHours={overview.withinHours} />}
          </Field>
          <div className="field">
            <span className="field-label">Days</span>
            <div className="chips" role="group" aria-label="Days">
              {DAYS.map((name, d) => (
                <button key={name} type="button" aria-pressed={draft.days.includes(d)} onClick={() => toggleDay(d)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="fields">
            <Field label="Start">
              <input type="time" value={draft.start} onChange={(e) => set({ start: e.target.value })} required />
            </Field>
            <Field label="End" hint="An end before the start runs overnight. The same start and end means all day.">
              <input type="time" value={draft.end} onChange={(e) => set({ end: e.target.value })} required />
            </Field>
            <Field label="Time zone">
              <input list="zones" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} required />
              <datalist id="zones">
                {ZONES.map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>
      </Panel>
      <Panel title="Tickets">
        <div className="panel-body fields">
          <Field label="Ticket authors" hint="Workshop only works on tickets opened by these GitHub users, and leaves other people's comments out of what agents read.">
            <input
              value={authors ?? draft.authors.join(', ')}
              onChange={(e) => {
                setAuthors(e.target.value);
                touch();
              }}
              placeholder="your-github-username"
            />
          </Field>
          <Field label="Order" hint="Pushed and prioritised tickets, higher-priority repositories and work already in progress still go first. This decides the order among the rest.">
            <select value={draft.ticketOrder} onChange={(e) => set({ ticketOrder: e.target.value as TicketOrder })}>
              {ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <NumberField label="Check for changes every (minutes)" value={draft.pollMinutes} min={1} max={60} onChange={(n) => set({ pollMinutes: n })} />
          <NumberField label="Alert when agents open more tickets per hour than" value={draft.raiseAlertPerHour} min={1} max={1000} onChange={(n) => set({ raiseAlertPerHour: n })} />
          <NumberField label="Keep run history for (days)" hint="Finished runs are removed after this, and screenshots when the ticket finishes." value={draft.retentionDays} min={1} max={365} onChange={(n) => set({ retentionDays: n })} />
        </div>
      </Panel>
      <SaveBar saved={saved} error={saveError} />
      <Panel
        title="Interface"
        action={
          <button type="button" onClick={() => setNewInterface(false)}>
            Use the original interface
          </button>
        }
      >
        <p className="panel-body small muted">You're trying the new interface. The choice is kept in this browser only.</p>
      </Panel>
    </form>
  );
}

export function Limits() {
  const { draft, error, set, save, saved, saveError, touch } = useSettings();
  const usage = useApi<Usage>('/usage', ['allowance', 'connections']);
  // Limits you've edited, by connection; the rest show what's saved.
  const [limits, setLimits] = useState<Record<number, SubLimits>>({});
  if (!draft) return <ErrorNote error={error} />;
  const setLimit = (connectionId: number, current: SubLimits, patch: Partial<SubLimits>) => {
    setLimits({ ...limits, [connectionId]: { ...current, ...patch } });
    touch();
  };
  const submit = save(async () => {
    await api('/settings', { method: 'PUT', body: { apiRunCapUsd: draft.apiRunCapUsd, apiDailyCapUsd: draft.apiDailyCapUsd } });
    for (const a of usage.data?.allowance ?? []) {
      const edit = limits[a.connectionId];
      if (edit && (edit.fiveHour !== a.limits.fiveHour || edit.weekly !== a.limits.weekly)) await api(`/usage/limits/${a.connectionId}`, { method: 'PUT', body: edit });
    }
    setLimits({});
  });
  const explain = "No new agents start on this subscription above this, and its running agents pause after their current step until usage drops back under it.";
  return (
    <form className="stack" onSubmit={submit}>
      <Panel title="Claude subscriptions">
        <ErrorNote error={usage.error} />
        {usage.data && usage.data.allowance.length === 0 && <Empty>No Claude subscription connected yet.</Empty>}
        {usage.data && usage.data.allowance.length > 0 && (
          <div className="table-wrap">
            <table className="rows form-table">
              <thead>
                <tr>
                  <th>Subscription</th>
                  <th>5-hour limit (%)</th>
                  <th>Weekly limit (%)</th>
                </tr>
              </thead>
              <tbody>
                {usage.data.allowance.map((a) => {
                  const current = limits[a.connectionId] ?? a.limits;
                  return (
                    <tr key={a.connectionId}>
                      <td>{a.connectionName}</td>
                      <td>
                        <input type="number" aria-label={`${a.connectionName} 5-hour limit`} title={`${explain} Claude's own warning at 90% also holds them, so higher values have no effect.`} min={0} max={100} value={current.fiveHour} onChange={(e) => setLimit(a.connectionId, current, { fiveHour: Number(e.target.value) })} required />
                      </td>
                      <td>
                        <input type="number" aria-label={`${a.connectionName} weekly limit`} title={explain} min={0} max={100} value={current.weekly} onChange={(e) => setLimit(a.connectionId, current, { weekly: Number(e.target.value) })} required />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="API billing">
        <div className="panel-body fields">
          <NumberField label="Limit per run (USD)" value={draft.apiRunCapUsd} min={0} max={1000} step={0.5} onChange={(n) => set({ apiRunCapUsd: n })} />
          <NumberField label="Limit per day (USD)" hint="Agents on API billing stop starting once today's runs reach this." value={draft.apiDailyCapUsd} min={0} max={10000} step={1} onChange={(n) => set({ apiDailyCapUsd: n })} />
        </div>
      </Panel>
      <SaveBar saved={saved} error={saveError} />
    </form>
  );
}
