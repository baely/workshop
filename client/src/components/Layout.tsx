import { useEffect, useId, useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import type { Mode, Overview } from '../../../server/src/api-types.ts';
import { api, useApi, useLiveState } from '../api.ts';
import { tokens } from '../format.ts';
import { Icon, type IconName } from './Icon.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { IconButton, Meter, Segmented } from './ui.tsx';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/tickets', label: 'Tickets', icon: 'board' },
  { to: '/runs', label: 'Runs', icon: 'runs' },
  { to: '/usage', label: 'Usage', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export const MODES: { value: Mode; label: string }[] = [
  { value: 'paused', label: 'Paused' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'always', label: 'Always on' },
];

export function ModeSwitch({ mode, withinHours }: { mode: Mode; withinHours: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Mode | null>(null);
  // Stay locked until the refreshed overview reports the requested mode.
  useEffect(() => { if (pending === mode) setPending(null); }, [mode, pending]);
  const set = (value: Mode) => {
    if (pending !== null || value === mode) return;
    setPending(value);
    api('/settings', { method: 'PUT', body: { mode: value } }).then(() => setError(null), (e: Error) => { setError(e.message); setPending(null); });
  };
  const hint = mode === 'paused' ? 'No new agents start' : mode === 'scheduled' && !withinHours ? 'Outside operating hours' : null;
  return (
    <div className="row">
      <Segmented label="Operation mode" value={pending ?? mode} options={MODES} onChange={set} pending={pending !== null} />
      {hint && <span className="muted small">{hint}</span>}
      {error && <span className="error-text small">{error}</span>}
    </div>
  );
}

/** True once updates have been paused for a few seconds, so a brief blip doesn't flash a note. */
function useStalled() {
  const live = useLiveState();
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (live === 'live') {
      setStalled(false);
      return;
    }
    const id = setTimeout(() => setStalled(true), 5000);
    return () => clearTimeout(id);
  }, [live]);
  return stalled;
}

function Brand({ className }: { className: string }) {
  const wallsId = `logo-walls-${useId().replace(/\W/g, '')}`;
  return (
    <div className={className}>
      Workshop
      {/* Traced from workshop-logo.png; colours follow the theme tokens. */}
      <svg viewBox="30 50 740 660" width="26" height="23" aria-hidden="true">
        <clipPath id={wallsId}>
          <path d="M85 310 225 262V685L85 640ZM225 262 458 120 700 268V665L225 685Z" />
        </clipPath>
        <path d="M85 310 225 262V685L85 640ZM225 262 458 120 700 268V665L225 685Z" fill="var(--muted)" />
        <g stroke="var(--text)" strokeOpacity="0.3" clipPath={`url(#${wallsId})`}>
          <path d="M163 0V800M300 0V800M375 0V800M450 0V800M520 0V800M582 0V800M640 0V800" strokeWidth="10" />
          <path d="M100 0V800M692 0V800" strokeWidth="26" />
        </g>
        <path d="M35 270 210 160 460 55 762 245 748 282 458 100 45 302Z" fill="var(--text)" />
        <path d="M45 302 458 100 748 282M225 262V685M318 278H588V668" fill="none" stroke="var(--bg)" strokeWidth="22" strokeLinejoin="round" />
        <rect x="329" y="289" width="248" height="380" fill="var(--text)" />
        <path d="M488 355 578 305V698L488 655Z" fill="var(--text)" stroke="var(--bg)" strokeWidth="14" strokeLinejoin="round" />
        <circle cx="516" cy="510" r="11" fill="var(--bg)" />
        <path d="M365 318H475L458 343H350Z" fill="var(--attention)" />
      </svg>
    </div>
  );
}

export function Layout({ version }: { version: string }) {
  const stalled = useStalled();
  const { data } = useApi<Overview>('/overview', ['settings', 'allowance', 'alerts', 'runs', 'connections']);
  const signOut = () => api('/auth/logout', { body: {} }).finally(() => window.location.assign('/'));
  const openAlerts = data?.alerts.length ?? 0;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand className="brand" />
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemeToggle />
          <IconButton icon="signout" label="Sign out" onClick={signOut} />
          <span className="muted small version" title={`Version ${version}`}>
            {version}
          </span>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Brand className="topbar-brand" />
          {data && <ModeSwitch mode={data.mode} withinHours={data.withinHours} />}
          <div className="topbar-meters">
            {data?.allowance.map((a) => (
              <div key={a.connectionId} className="row">
                {data.allowance.length > 1 && <span className="small muted">{a.connectionName}</span>}
                {a.unknown ? (
                  <span className="small muted" title="Claude doesn't report this account's usage, so Workshop shows the tokens its agents used instead and can't hold them at your limits.">
                    5h {tokens(a.tokens.fiveHour)} · week {tokens(a.tokens.sevenDay)}
                  </span>
                ) : a.sampledAt ? (
                  <>
                    <Meter label="5h" window={a.fiveHour} threshold={a.limits.fiveHour} />
                    <Meter label="Week" window={a.sevenDay} threshold={a.limits.weekly} />
                  </>
                ) : (
                  <span className="small muted">Usage not checked yet</span>
                )}
              </div>
            ))}
          </div>
          {stalled && <span className="small muted">Reconnecting…</span>}
          <NavLink to="/alerts" className={`icon-button bell${openAlerts ? ' has' : ''}`} aria-label={openAlerts ? `Alerts, ${openAlerts} open` : 'Alerts'} title="Alerts">
            <Icon name="bell" size={18} />
            {openAlerts > 0 && <span className="badge">{openAlerts}</span>}
          </NavLink>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
