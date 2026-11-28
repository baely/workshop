import './theme.css';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import type { AuthState } from '../../../server/src/api-types.ts';
import { api } from '../api.ts';
import { Layout } from './components/Layout.tsx';
import { applyStoredTheme } from './components/ThemeToggle.tsx';
import { Alerts } from './pages/Alerts.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Dependencies } from '../pages/Dependencies.tsx';
import { Login } from '../pages/Login.tsx';
import { Media } from './pages/Media.tsx';
import { Ticket } from './pages/Ticket.tsx';
import { RunView } from './pages/RunView.tsx';
import { Runs } from './pages/Runs.tsx';
import { Agents } from './pages/settings/Agents.tsx';
import { Connections } from './pages/settings/Connections.tsx';
import { General, Limits } from './pages/settings/General.tsx';
import { SettingsLayout } from './pages/settings/index.tsx';
import { Repositories } from './pages/settings/Repositories.tsx';
import { Tokens } from './pages/settings/Tokens.tsx';
import { Tickets } from './pages/Tickets.tsx';
import { Usage } from '../pages/Usage.tsx';

applyStoredTheme();

/** Old addresses (and GitHub's return from setting up the App) land on the settings tab that replaced them. */
function Moved({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={to + search} replace />;
}

/** The new interface: Home, Tickets, Runs, Usage, and every setting under Settings. */
export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    api<AuthState>('/auth/state').then(setAuth, () => setAuth({ authenticated: false, enrolled: true, version: '' }));
    const signedOut = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('workshop:signed-out', signedOut);
    return () => window.removeEventListener('workshop:signed-out', signedOut);
  }, []);

  if (!auth) return null;
  if (!auth.authenticated) return <Login enrolled={auth.enrolled} onSignedIn={() => setAuth({ ...auth, authenticated: true, enrolled: true })} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout version={auth.version} />}>
          <Route index element={<Dashboard />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="tickets/:id" element={<Ticket />} />
          <Route path="tickets/:id/media" element={<Media />} />
          <Route path="dependencies" element={<Dependencies />} />
          <Route path="runs" element={<Runs />} />
          <Route path="runs/:id" element={<RunView />} />
          <Route path="usage" element={<Usage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<General />} />
            <Route path="repositories" element={<Repositories />} />
            <Route path="agents" element={<Agents />} />
            <Route path="connections" element={<Connections />} />
            <Route path="limits" element={<Limits />} />
            <Route path="tokens" element={<Tokens />} />
          </Route>
          <Route path="connections" element={<Moved to="/settings/connections" />} />
          <Route path="agents" element={<Moved to="/settings/agents" />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
