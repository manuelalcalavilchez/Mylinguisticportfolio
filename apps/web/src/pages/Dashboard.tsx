import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBox, Loading, formatDate, useAction, useLoad } from '../lib/ui';

export function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'admin') return <AdminDashboard />;
  if (user.role === 'teacher') return <TeacherDashboard />;
  return <StudentDashboard />;
}

interface ProjectRef { id: string; title: string; status: string }
interface TeacherGroup { id: string; name: string; course: string; status: string; studentCount: number; projects: ProjectRef[] | null }

function TeacherDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<{ groups: TeacherGroup[] }>('/groups'), []);
  const [form, setForm] = useState({ name: '', course: '4.º ESO' });
  const act = useAction();
  const nav = useNavigate();

  const create = (ev: FormEvent) => {
    ev.preventDefault();
    void act.run(async () => {
      const r = await api<{ group: { id: string } }>('/groups', { method: 'POST', body: form });
      nav(`/grupos/${r.group.id}`);
    });
  };

  return (
    <main className="card">
      <h1>Hola, {user!.displayName}</h1>
      <h2>Mis grupos</h2>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && data.groups.length === 0 && <p className="muted">Aún no tienes grupos. Crea el primero abajo.</p>}
      <ul className="tiles">
        {data?.groups.map((g) => (
          <li key={g.id} className={g.status === 'archived' ? 'tile archived' : 'tile'}>
            <Link to={`/grupos/${g.id}`} className="tile-title">{g.name}</Link>
            <span className="muted">{g.course} · {g.studentCount} alumnos{g.status === 'archived' ? ' · archivado' : ''}</span>
            {g.projects?.map((p) => (
              <Link key={p.id} to={`/proyectos/${p.id}`}>Seguimiento: {p.title}</Link>
            ))}
          </li>
        ))}
      </ul>
      <h2>Crear grupo</h2>
      <form onSubmit={create} className="grid">
        <label>Nombre del grupo<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="4.º ESO B – Inglés" /></label>
        <label>Curso<input required maxLength={40} value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} /></label>
        <button type="submit" disabled={act.busy}>Crear grupo</button>
      </form>
      <ErrorBox error={act.error} />
      <button type="button" className="link" onClick={() => void reload()}>Actualizar</button>
    </main>
  );
}

interface StudentGroup { id: string; name: string; course: string; teacherName: string; projects: ProjectRef[] | null }

function StudentDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<{ groups: StudentGroup[] }>('/groups'), []);
  const [code, setCode] = useState('');
  const act = useAction();
  const nav = useNavigate();

  const open = (projectId: string) =>
    act.run(async () => {
      const r = await api<{ portfolioId: string }>(`/projects/${projectId}/my-portfolio`, { method: 'POST' });
      nav(`/portfolio/${r.portfolioId}`);
    });

  return (
    <main className="card">
      <h1>Hi, {user!.displayName}!</h1>
      <h2>Mis portfolios</h2>
      {loading && <Loading />}
      <ErrorBox error={error ?? act.error} />
      {data && data.groups.length === 0 && <p className="muted">Todavía no estás en ningún grupo.</p>}
      <ul className="tiles">
        {data?.groups.map((g) => (
          <li key={g.id} className="tile">
            <span className="tile-title">{g.name}</span>
            <span className="muted">{g.course} · Profesor/a: {g.teacherName}</span>
            {g.projects?.map((p) => (
              <button key={p.id} type="button" onClick={() => void open(p.id)} disabled={act.busy}>
                Abrir: {p.title}{p.status === 'closed' ? ' (cerrado)' : ''}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <h2>Unirme a otro grupo</h2>
      <form
        className="row"
        onSubmit={(ev) => {
          ev.preventDefault();
          void act.run(async () => {
            await api('/groups/join', { method: 'POST', body: { code } });
            setCode('');
            await reload();
          });
        }}
      >
        <label className="grow">Código del grupo<input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" /></label>
        <button type="submit" disabled={act.busy}>Unirme</button>
      </form>
    </main>
  );
}

interface AdminUser { id: string; login: string; displayName: string; role: string; status: string }
interface AdminPublication { id: string; slug: string; publishedAt: string; publicName: string; groupName: string; teacherName: string }

function AdminDashboard() {
  const users = useLoad(() => api<{ users: AdminUser[] }>('/admin/users'), []);
  const pubs = useLoad(() => api<{ publications: AdminPublication[] }>('/admin/publications'), []);
  const act = useAction();
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: '', email: '', password: '', role: 'teacher' });

  return (
    <main className="card">
      <h1>Administración</h1>
      <ErrorBox error={act.error ?? users.error} />
      {resetUrl && (
        <div className="notice" role="status">
          <p>Enlace de un solo uso (caduca en 60 min). Entrégalo por un canal privado:</p>
          <input readOnly value={resetUrl} onFocus={(e) => e.target.select()} aria-label="Enlace de recuperación" />
        </div>
      )}
      <h2>Usuarios</h2>
      {users.loading && <Loading />}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {users.data?.users.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.login}</td>
                <td>{u.role}</td>
                <td>{u.status}</td>
                <td className="actions">
                  <button type="button" className="secondary small" onClick={() => void act.run(async () => {
                    const r = await api<{ resetUrl: string }>(`/admin/users/${u.id}/reset-link`, { method: 'POST' });
                    setResetUrl(r.resetUrl);
                  })}>Enlace recuperación</button>
                  <button type="button" className="secondary small" onClick={() => void act.run(async () => {
                    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { status: u.status === 'active' ? 'disabled' : 'active' } });
                    await users.reload();
                  })}>{u.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                  <button type="button" className="danger small" onClick={() => {
                    const confirm = window.prompt(`Borrado DEFINITIVO de ${u.login} y todos sus datos.\nEscribe "${u.login}" para confirmar:`);
                    if (!confirm) return;
                    void act.run(async () => {
                      await api(`/admin/users/${u.id}`, { method: 'DELETE', body: { confirm } });
                      await users.reload();
                    });
                  }}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Crear profesor o administrador</h3>
      <form
        className="grid"
        onSubmit={(ev) => {
          ev.preventDefault();
          void act.run(async () => {
            await api('/admin/users', { method: 'POST', body: form });
            setForm({ displayName: '', email: '', password: '', role: 'teacher' });
            await users.reload();
          });
        }}
      >
        <label>Nombre<input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></label>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Contraseña inicial<input type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <label>Rol
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Profesor</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button type="submit" disabled={act.busy}>Crear</button>
      </form>
      <h2>Publicaciones activas</h2>
      {pubs.data?.publications.length === 0 && <p className="muted">No hay publicaciones activas.</p>}
      <ul className="list">
        {pubs.data?.publications.map((p) => (
          <li key={p.id}>
            <a href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer">{p.publicName}</a>{' '}
            <span className="muted">· {p.groupName} · {p.teacherName} · {formatDate(p.publishedAt)}</span>{' '}
            <button type="button" className="danger small" onClick={() => void act.run(async () => {
              await api(`/admin/publications/${p.id}/revoke`, { method: 'POST' });
              await pubs.reload();
            })}>Retirar</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
