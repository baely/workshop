import { Link } from 'react-router';
import type { AlertView } from '../../../../server/src/api-types.ts';
import { api, useApi } from '../../api.ts';
import { Icon } from '../components/Icon.tsx';
import { Empty, ErrorNote, IconButton, PageHead } from '../components/ui.tsx';
import { clock } from '../../format.ts';

export function Alerts() {
  const { data, error, reload } = useApi<AlertView[]>('/alerts', ['alerts']);
  const open = (data ?? []).filter((a) => !a.ackAt);
  const done = (data ?? []).filter((a) => a.ackAt);
  const ack = (path: string) => api(path, { body: {} }).then(reload);

  const list = (alerts: AlertView[], acknowledgeable: boolean) => (
    <ul className="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={acknowledgeable ? `alert ${a.level}` : 'alert'}>
          <Icon name={a.level === 'info' ? 'info' : 'alert'} />
          <span className="grow">{a.message}</span>
          <span className="small muted">{clock(a.createdAt)}</span>
          {a.runId && (
            <Link className="small" to={`/runs/${a.runId}`}>
              View run
            </Link>
          )}
          {acknowledgeable && <IconButton icon="check" label="Acknowledge" onClick={() => void ack(`/alerts/${a.id}/ack`)} />}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stack">
      <PageHead title="Alerts">{open.length > 1 && <button onClick={() => void ack('/alerts/ack-all')}>Acknowledge all</button>}</PageHead>
      <ErrorNote error={error} />
      {open.length ? list(open, true) : data && <Empty>No open alerts.</Empty>}
      {done.length > 0 && (
        <>
          <h2 className="section">Earlier</h2>
          {list(done, false)}
        </>
      )}
    </div>
  );
}
