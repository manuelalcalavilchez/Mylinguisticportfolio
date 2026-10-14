import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="alert" role="alert">
      <p>{e?.message ?? 'Ha ocurrido un error inesperado'}</p>
      {e?.fields?.length ? (
        <ul>
          {e.fields.map((f) => (
            <li key={f.path}>
              {f.path}: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function LoginPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  if (user) return <Navigate to="/" replace />;

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { email, password } });
      setUser(r.user);
      nav('/');
    });
  };

  return (
    <main className="card narrow">
      <h1>My Linguistic Portfolio</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="muted">
        ¿Eres profesor y tienes código de registro? <Link to="/registro-profesor">Crear cuenta</Link>
        <br />
        ¿Olvidaste la contraseña? Pide a tu administrador un enlace de recuperación.
      </p>
    </main>
  );
}

export function RegisterTeacherPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', signupCode: '' });
  const { busy, error, run } = useSubmit();
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api<{ user: User }>('/auth/register-teacher', { method: 'POST', body: form });
      setUser(r.user);
      nav('/');
    });
  };

  return (
    <main className="card narrow">
      <h1>Registro de profesor</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Nombre visible</label>
        <input id="name" required maxLength={80} value={form.displayName} onChange={set('displayName')} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={form.email} onChange={set('email')} />
        <label htmlFor="password">Contraseña (mínimo 10 caracteres)</label>
        <input id="password" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} />
        <label htmlFor="code">Código de registro del piloto</label>
        <input id="code" required value={form.signupCode} onChange={set('signupCode')} />
        <ErrorBox error={error} />
        <button type="submit" disabled={busy}>Crear cuenta</button>
      </form>
      <p className="muted"><Link to="/login">Volver a iniciar sesión</Link></p>
    </main>
  );
}

export function ResetPasswordPage() {
  // El token viaja en el fragmento (#token=...) para que no llegue a logs de servidor ni proxies.
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useSubmit();

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      await api('/auth/password-reset', { method: 'POST', body: { token, password } });
      history.replaceState(null, '', window.location.pathname);
      setDone(true);
    });
  };

  return (
    <main className="card narrow">
      <h1>Nueva contraseña</h1>
      {done ? (
        <p>Contraseña actualizada. <Link to="/login">Inicia sesión</Link></p>
      ) : !token ? (
        <p className="alert">Enlace incompleto. Pide uno nuevo a tu administrador.</p>
      ) : (
        <form onSubmit={onSubmit}>
          <label htmlFor="password">Nueva contraseña (mínimo 10 caracteres)</label>
          <input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorBox error={error} />
          <button type="submit" disabled={busy}>Guardar</button>
        </form>
      )}
    </main>
  );
}
