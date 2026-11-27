import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import type { UsageWindow } from '../../../server/src/api-types.ts';
import { clock, type Tone } from '../format.ts';
import { Icon, type IconName } from './Icon.tsx';

/** A dot that always sits next to words. */
export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

/** A small label: a size, a flag, a count. `tone` colours it for states that need a second look. */
export function Tag({ tone, icon, title, children }: { tone?: 'accent' | 'attention' | 'error' | 'ok'; icon?: IconName; title?: string; children: ReactNode }) {
  return (
    <span className={tone ? `tag ${tone}` : 'tag'} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Meter({ label, window, threshold }: { label: string; window: UsageWindow | null; threshold: number }) {
  const pct = window && (!window.resetsAt || window.resetsAt > Date.now()) ? window.pct : 0;
  const resets = window?.resetsAt ? `, resets ${clock(window.resetsAt)}` : '';
  return (
    <div className="meter" title={`${label} allowance: ${Math.round(pct)}% used${resets}. No new agents start above ${threshold}%.`}>
      <span className="muted">{label}</span>
      <div className="meter-track" role="meter" aria-label={`${label} allowance used`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`meter-fill${pct > threshold ? ' over' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
        <div className="meter-mark" style={{ left: `${threshold}%` }} />
      </div>
      <span className="num">{Math.round(pct)}%</span>
    </div>
  );
}

/** A bar for how much of a limit is used, e.g. turns of max turns, or slots in use. */
export function Progress({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100;
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="meter-track" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={`meter-fill${value >= max ? ' over' : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="muted">{text}</span>
    </div>
  );
}

export function Modal({ title, onClose, className, children }: { title: string; onClose: () => void; className?: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={className ? `modal ${className}` : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread">
          <h2>{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Panel({ title, count, action, children }: { title: ReactNode; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? (
    <p className="notice error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** The title row of a page, with its actions on the right. */
export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        {sub && <div className="muted">{sub}</div>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function IconButton({ icon, label, onClick, disabled, danger }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`icon-button${danger ? ' danger' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

/** Closes a popover on Escape or a click outside `ref`. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** An explanation kept out of the way: a small button that shows it when asked. */
export function Hint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  return (
    <span className="hint" ref={ref}>
      <button type="button" className="hint-button" aria-label="Explain" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        <Icon name="info" size={14} />
      </button>
      {open && <span className="popover hint-text" role="note">{children}</span>}
    </span>
  );
}

export interface MenuItem {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  /** A link instead of an action: opens in a new tab unless `download` is set. */
  href?: string;
  download?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

/** A "more" button that opens a short list of actions. */
export function Menu({ label, items, align = 'right' }: { label: string; items: (MenuItem | false | null | undefined)[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, useCallback(() => setOpen(false), []));
  const shown = items.filter((i): i is MenuItem => Boolean(i));
  if (!shown.length) return null;
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className={`popover menu-list ${align}`} role="menu">
          {shown.map((i) =>
            i.href ? (
              <a key={i.label} role="menuitem" href={i.href} title={i.title} {...(i.download ? { download: true } : { target: '_blank', rel: 'noreferrer' })} onClick={() => setOpen(false)}>
                {i.icon && <Icon name={i.icon} />}
                {i.label}
              </a>
            ) : (
              <button
                key={i.label}
                type="button"
                role="menuitem"
                className={i.danger ? 'danger' : undefined}
                disabled={i.disabled}
                title={i.title}
                onClick={() => {
                  setOpen(false);
                  i.onClick?.();
                }}
              >
                {i.icon && <Icon name={i.icon} />}
                {i.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** An on/off control for a setting that takes effect at once. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

/** One headline number. */
export function Stat({ label, value, sub, tone, to }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; to?: string }) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return to ? (
    <NavLink className="stat" to={to}>
      {body}
    </NavLink>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function Tabs({ items, label }: { items: { to: string; label: ReactNode; end?: boolean }[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A group of buttons where one is chosen. */
export function Segmented<T extends string>({ value, options, onChange, label, pending }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; pending?: boolean }) {
  return (
    <div className={`segmented${pending ? ' pending' : ''}`} role="group" aria-label={label} aria-busy={pending || undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={pending} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A label with its control, and an optional explanation behind a hint button. */
export function Field({ label, hint, help, children }: { label: string; hint?: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <Hint>{hint}</Hint>}
      </span>
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}

/** Runs one request at a time and keeps its error, for buttons that act at once. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    return work()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, []);
  return { busy, error, run };
}
