import { Outlet } from 'react-router';
import { PageHead, Tabs } from '../../components/ui.tsx';

const TABS = [
  { to: '/settings', label: 'General', end: true },
  { to: '/settings/repositories', label: 'Repositories' },
  { to: '/settings/agents', label: 'Agents' },
  { to: '/settings/connections', label: 'Connections' },
  { to: '/settings/limits', label: 'Limits' },
  { to: '/settings/tokens', label: 'API tokens' },
];

/** Everything you configure, in one place: one tab per subject. */
export function SettingsLayout() {
  return (
    <div className="stack">
      <PageHead title="Settings" />
      <Tabs label="Settings" items={TABS} />
      <Outlet />
    </div>
  );
}
