import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, useAction } from '../lib/ui';

export function LoginPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  if (user) return <Navigate to="/" replace />;

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: { login, password } });
      setUser(r.user);
      nav('/');
    });
  };

  return (
    <main className="card narrow">
      <h1>Iniciar sesión</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="login">Email o nombre de usuario</label>
        <input id="login" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox error={error} />
        <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <p className="muted">
        ¿Eres alumno y tienes un código de tu profesor? <Link to="/unirse">Crear mi cuenta</Link>
        <br />
        ¿Eres profesor y tienes código de registro? <Link to="/registro-profesor">Registro de profesor</Link>
        <br />
        ¿Olvidaste la contraseña? Pide a tu profesor (o al administrador) un enlace de recuperación.
      </p>
    </main>
  );
}

export function RegisterStudentPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ inviteCode: '', displayName: '', username: '', password: '', password2: '' });
  const { busy, error, run, setError } = useAction();
  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    if (form.password !== form.password2) {
      setError(new Error('Las contraseñas no coinciden'));
      return;
    }
    void run(async () => {
      const { inviteCode, displayName, username, password } = form;
      const body = { inviteCode, displayName, username, password };
      const r = await api<{ user: User }>('/auth/register-student', { method: 'POST', body });
      setUser(r.user);
      nav('/');
    });
  };

  return (
    <main className="card narrow">
      <h1>Crear mi cuenta de alumno</h1>
      <p className="muted">No necesitas email. Usa tu nombre de pila y un nombre de usuario que recuerdes.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="code">Código del grupo (te lo da tu profesor)</label>
        <input id="code" required autoComplete="off" placeholder="XXXXX-XXXXX" value={form.inviteCode} onChange={set('inviteCode')} />
        <label htmlFor="name">Tu nombre de pila</label>
        <input id="name" required maxLength={80} autoComplete="given-name" value={form.displayName} onChange={set('displayName')} />
        <label htmlFor="username">Nombre de usuario (3-30 letras, números, . _ -)</label>
        <input id="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" autoComplete="username" value={form.username} onChange={set('username')} />
        <label htmlFor="password">Contraseña (mínimo 10 caracteres)</label>
        <input id="password" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set('password')} />
        <label htmlFor="password2">Repite la contraseña</label>
        <input id="password2" type="password" required minLength={10} autoComplete="new-password" value={form.password2} onChange={set('password2')} />
        <ErrorBox error={error} />
        <button type="submit" disabled={busy}>Crear cuenta</button>
      </form>
      <p className="muted"><Link to="/login">Ya tengo cuenta</Link></p>
    </main>
  );
}

export function RegisterTeacherPage() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ displayName: '', email: '', password: '', signupCode: '' });
  const { busy, error, run } = useAction();
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
  const { busy, error, run } = useAction();

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
        <p className="alert">Enlace incompleto. Pide uno nuevo.</p>
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

export function AccountPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  if (!user) return null;
  return (
    <main className="card narrow">
      <h1>Mi cuenta</h1>
      <p className="muted">Usuario: {user.login}</p>
      <h2>Cambiar contraseña</h2>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void run(async () => {
            await api('/auth/change-password', { method: 'POST', body: form });
            setForm({ currentPassword: '', newPassword: '' });
            setDone(true);
          });
        }}
      >
        <label htmlFor="cur">Contraseña actual</label>
        <input id="cur" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <label htmlFor="new">Nueva contraseña (mínimo 10)</label>
        <input id="new" type="password" autoComplete="new-password" required minLength={10} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <ErrorBox error={error} />
        {done && <p className="notice" role="status">Contraseña cambiada. Se han cerrado tus otras sesiones.</p>}
        <button type="submit" disabled={busy}>Cambiar</button>
      </form>
      <h2>Mis datos</h2>
      <p>Puedes descargar una copia de todos tus datos en formato JSON.</p>
      <a className="button secondary" href="/api/me/export" download>Descargar mis datos</a>
    </main>
  );
}
