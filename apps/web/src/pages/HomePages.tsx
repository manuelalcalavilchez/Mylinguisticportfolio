import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox } from './AuthPages';

const ROLE_LABEL = { admin: 'Administrador', teacher: 'Profesor', student: 'Alumno' } as const;

export function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <main className="card">
      <h1>Hola, {user.displayName}</h1>
      <p className="muted">Rol: {ROLE_LABEL[user.role]}</p>
      {user.role === 'admin' && <AdminUsers />}
      {user.role === 'teacher' && (
        <section>
          <h2>Mis grupos</h2>
          <p className="muted">Disponible en la fase 2 (crear grupos e invitar alumnos).</p>
        </section>
      )}
      {user.role === 'student' && (
        <section>
          <h2>Mi portfolio</h2>
          <p className="muted">Disponible en la fase 3 (Home, Passport, Biography y Dossier).</p>
        </section>
      )}
    </main>
  );
}

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
}

function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'teacher' });

  const load = () => api<{ users: AdminUser[] }>('/admin/users').then((r) => setUsers(r.users)).catch(setError);
  useEffect(() => {
    void load();
  }, []);

  const create = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: form });
      setForm({ displayName: '', email: '', password: '', role: 'teacher' });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const toggle = async (u: AdminUser) => {
    setError(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const reset = async (u: AdminUser) => {
    setError(null);
    try {
      const r = await api<{ resetUrl: string }>(`/admin/users/${u.id}/reset-link`, { method: 'POST' });
      setResetUrl(r.resetUrl);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section>
      <h2>Usuarios</h2>
      <ErrorBox error={error} />
      {resetUrl && (
        <div className="notice" role="status">
          <p>Enlace de un solo uso (caduca en 60 min). Entrégalo por un canal privado:</p>
          <input readOnly value={resetUrl} onFocus={(e) => e.target.select()} aria-label="Enlace de recuperación" />
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.status}</td>
                <td className="actions">
                  <button type="button" className="secondary" onClick={() => void reset(u)}>Enlace recuperación</button>
                  <button type="button" className="secondary" onClick={() => void toggle(u)}>{u.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Crear profesor</h3>
      <form onSubmit={create} className="grid">
        <label>Nombre<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Contraseña inicial<input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label>Rol
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Profesor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button type="submit">Crear</button>
      </form>
    </section>
  );
}
