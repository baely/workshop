import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { RunView, TasksView } from '../../../server/src/api-types.ts';
import { api, useApi, useNow } from '../api.ts';
import { ErrorNote, Panel, Status } from '../components/ui.tsx';
import { clock, duration, money, runStatus, tokens } from '../format.ts';

const REPO_KEY = 'workshop-task-repo';

export function Tasks() {
  const { data, error } = useApi<TasksView>('/tasks', ['runs', 'repos']);
  const now = useNow();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState(() => localStorage.getItem(REPO_KEY) ?? '');
  const [prompt, setPrompt] = useState('');
  const [browser, setBrowser] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!data) return <ErrorNote error={error} />;

  // The remembered repository, if it's still there; otherwise the first one.
  const repoId = data.repos.some((r) => String(r.id) === chosen) ? chosen : String(data.repos[0]?.id ?? '');
  const start = (e: FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setProblem(null);
    localStorage.setItem(REPO_KEY, repoId);
    api<RunView>('/tasks', { body: { repoId: Number(repoId), prompt, browser } })
      .then((run) => navigate(`/runs/${run.id}`), (err: Error) => setProblem(err.message))
      .finally(() => setStarting(false));
  };

  return (
    <div className="stack">
      <h1>Tasks</h1>
      <ErrorNote error={error} />
      <Panel title="Start a task">
        {data.repos.length ? (
          <form className="panel-body stack" onSubmit={start}>
            <label className="field">
              <span>Repository</span>
              <select value={repoId} onChange={(e) => setChosen(e.target.value)}>
                {data.repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>What should the agent do?</span>
              <textarea rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={20_000} required />
            </label>
            <label className="row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'baseline' }}>
              <input type="checkbox" checked={browser} onChange={(e) => setBrowser(e.target.checked)} />
              <span>Give it a browser (Playwright with Chromium)</span>
            </label>
            <ErrorNote error={problem} />
            <div className="row">
              <button type="submit" className="primary" disabled={starting || !prompt.trim()}>
                {starting ? 'Starting…' : 'Start task'}
              </button>
            </div>
            <p className="small muted">
              Starts now on a free agent host with the Task agent's model and limits (<Link to="/agents">Agents</Link> page). The agent works on a new branch and pushes it if it commits
              anything; no pull request is opened. Workshop keeps the prompt with the run, where read-only API tokens can see it, so don't paste long-lived secrets.
            </p>
          </form>
        ) : (
          <p className="empty">
            Workshop can't see any repositories yet. Add a code host on the <Link to="/connections">Connections</Link> page.
          </p>
        )}
      </Panel>
      <Panel title="Tasks">
        {data.tasks.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Task</th>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Took</th>
                  <th>Usage</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/runs/${r.id}`}>{clock(r.startedAt)}</Link>
                    </td>
                    <td>
                      {r.task?.title}
                      <div className="small muted">{r.repo}</div>
                      {r.task?.branchUrl && (
                        <a className="small" href={r.task.branchUrl} target="_blank" rel="noreferrer">
                          branch
                        </a>
                      )}
                    </td>
                    <td className="small">{r.environment ?? '–'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Status tone={runStatus(r).tone}>{runStatus(r).label}</Status>
                    </td>
                    <td className="small">{duration(r.startedAt, r.endedAt ?? now)}</td>
                    <td className="small muted">
                      {tokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0) || null)}
                      {r.billing === 'api' && r.costUsd !== null && <div>{money(r.costUsd)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">No tasks yet. Describe one above to start an agent.</p>
        )}
      </Panel>
    </div>
  );
}
