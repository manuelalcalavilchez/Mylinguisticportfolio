import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, SectionStamps, useAction } from '../lib/ui';

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
    <main className="auth-wrap">
      <div className="auth-hero">
        <h1>Your languages, your story.</h1>
        <p className="lede">Tu portfolio de inglés: preséntate, valora tu progreso, guarda tus mejores trabajos y diséñalo a tu manera.</p>
        <SectionStamps sections={[
          { key: 'h', label: 'Home', done: 1, total: 1 },
          { key: 'p', label: 'Passport', done: 1, total: 1 },
          { key: 'b', label: 'Biography', done: 1, total: 2 },
          { key: 'd', label: 'Dossier', done: 0, total: 1 },
        ]} />
      </div>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Entrar</h2>
        <form onSubmit={onSubmit}>
          <label htmlFor="login">Usuario o email</label>
          <input id="login" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
          <label htmlFor="password">Contraseña</label>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <ErrorBox error={error} />
          <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <div className="auth-links">
          <span>¿Primera vez y tienes el código de tu profesor? <Link to="/unirse">Crear mi cuenta de alumno</Link></span>
          <span className="small muted">¿Eres profesor? <Link to="/registro-profesor">Registro de profesorado</Link></span>
          <span className="small muted">¿Has olvidado la contraseña? Pide a tu profesor un enlace para cambiarla.</span>
        </div>
      </div>
    </main>
  );
}

/** Campo de contraseña con botón para mostrarla (menos errores al teclear en el móvil). */
export function PasswordInput({ id, value, onChange, autoComplete, minLength }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="row">
      <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} required minLength={minLength} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="ghost small" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        {show ? 'Ocultar' : 'Ver'}
      </button>
    </div>
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
    <main className="page narrow panel">
      <h1>Crea tu cuenta</h1>
      <p className="muted">No necesitas email. Solo el código de tu grupo, tu nombre de pila y un usuario que recuerdes.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor="code">Código del grupo (te lo da tu profesor)</label>
        <input id="code" required autoComplete="off" placeholder="XXXXX-XXXXX" value={form.inviteCode} onChange={set('inviteCode')} />
        <label htmlFor="name">Tu nombre de pila</label>
        <input id="name" required maxLength={80} autoComplete="given-name" value={form.displayName} onChange={set('displayName')} />
        <label htmlFor="username">Nombre de usuario<span className="hint">Entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo. Por ejemplo: alba.r</span></label>
        <input id="username" required pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,29}" autoComplete="username" value={form.username} onChange={set('username')} />
        <label htmlFor="password">Contraseña<span className="hint">Mínimo 10 caracteres. Una frase corta es fácil de recordar: «me gusta el verano»</span></label>
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
    <main className="page narrow panel">
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
    <main className="page narrow panel">
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
    <main className="page narrow panel">
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
