import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from './api';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const details = Array.isArray(e?.details) ? (e!.details as { code: string; message: string }[]) : [];
  return (
    <div className="alert" role="alert">
      <p>{e?.message ?? (error instanceof Error && error.message ? error.message : 'Ha ocurrido un error inesperado')}</p>
      {e?.fields?.length ? (
        <ul>
          {e.fields.map((f) => (
            <li key={f.path}>{f.path || 'dato'}: {f.message}</li>
          ))}
        </ul>
      ) : null}
      {details.length ? (
        <ul>
          {details.map((d) => (
            <li key={d.code}>{d.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Carga de datos con estado de carga/error y recarga manual. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Ejecuta acciones con estado ocupado/error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function Loading() {
  return <p className="muted" aria-busy="true" role="status">Cargando…</p>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span className="bar"><span style={{ width: `${percent}%` }} /></span>
      <strong>{percent}%</strong>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <span className="empty-icon" aria-hidden="true">{icon}</span>}
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Sellos de pasaporte: uno por sección del portfolio. */
export function SectionStamps({ sections }: { sections: { key: string; label: string; done: number; total: number }[] }) {
  return (
    <ul className="stamps" aria-label="Progreso por sección">
      {sections.map((s) => {
        const state = s.done >= s.total ? 'done' : s.done > 0 ? 'part' : '';
        return (
          <li key={s.key} className={`stamp ${state}`} aria-label={`${s.label}: ${s.done} de ${s.total}`}>
            <span><b>{state === 'done' ? '✓' : `${s.done}/${s.total}`}</b>{s.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function formatDate(d: string | null | undefined) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function statusTone(status: string): 'neutral' | 'ok' | 'warn' | 'info' {
  if (['published', 'accepted', 'approved'].includes(status)) return 'ok';
  if (['changes_requested', 'returned', 'revoked'].includes(status)) return 'warn';
  if (['publication_requested', 'submitted'].includes(status)) return 'info';
  return 'neutral';
}
