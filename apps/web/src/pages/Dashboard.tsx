import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inkOn, PALETTES } from '../lib/design';
import { PORTFOLIO_STATUS, SECTION_SHORT, type Progress, type Section } from '../lib/types';
import {
  Badge, EmptyState, ErrorBox, Loading, ProgressBar, SectionStamps, formatDate, statusTone, useAction, useLoad,
} from '../lib/ui';

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
  const { data, error, loading } = useLoad(() => api<{ groups: TeacherGroup[] }>('/groups'), []);
  const [form, setForm] = useState({ name: '', course: '4.º ESO' });
  const act = useAction();
  const nav = useNavigate();
  const groups = data?.groups ?? [];
  const activeGroups = groups.filter((g) => g.status !== 'archived');
  const archived = groups.filter((g) => g.status === 'archived');

  const create = (ev: FormEvent) => {
    ev.preventDefault();
    void act.run(async () => {
      const r = await api<{ group: { id: string } }>('/groups', { method: 'POST', body: form });
      nav(`/grupos/${r.group.id}`);
    });
  };

  const tile = (g: TeacherGroup) => (
    <li key={g.id} className={g.status === 'archived' ? 'tile archived' : 'tile'}>
      <Link to={`/grupos/${g.id}`} className="tile-title">{g.name}</Link>
      <div className="tile-meta"><span>{g.course}</span><span>👥 {g.studentCount} {g.studentCount === 1 ? 'alumno' : 'alumnos'}</span></div>
      {g.projects?.length ? (
        <div className="tile-links">
          {g.projects.map((p) => <Link key={p.id} to={`/proyectos/${p.id}`}>Seguimiento de «{p.title}»</Link>)}
        </div>
      ) : null}
    </li>
  );

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Hola, {user!.displayName}</h1>
          <p className="lede">Tus grupos y el seguimiento de los portfolios de tu alumnado.</p>
        </div>
      </header>
      {loading && <Loading />}
      <ErrorBox error={error} />
      {data && groups.length === 0 && (
        <>
          <ol className="steps">
            <li><strong>Crea un grupo</strong>Se crea con un proyecto de portfolio ya preparado.</li>
            <li><strong>Genera un código</strong>Tu alumnado lo usa para crear su cuenta, sin email.</li>
            <li><strong>Sigue su progreso</strong>Comenta, evalúa con la rúbrica y aprueba lo que se publica.</li>
          </ol>
          <h2>Crea tu primer grupo</h2>
        </>
      )}
      {activeGroups.length > 0 && <ul className="tiles">{activeGroups.map(tile)}</ul>}

      <section className="panel" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>{groups.length ? 'Nuevo grupo' : 'Datos del grupo'}</h2>
        <form onSubmit={create} className="grid">
          <label>Nombre del grupo<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="4.º ESO B – Inglés" /></label>
          <label>Curso<input required maxLength={40} value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} /></label>
          <button type="submit" disabled={act.busy}>Crear grupo</button>
        </form>
        <ErrorBox error={act.error} />
      </section>
      {archived.length > 0 && (
        <details style={{ marginTop: 20 }}>
          <summary>Grupos archivados ({archived.length})</summary>
          <ul className="tiles" style={{ marginTop: 12 }}>{archived.map(tile)}</ul>
        </details>
      )}
    </main>
  );
}

interface StudentPortfolio {
  id: string;
  status: string;
  progress: Progress;
  look: { palette: string; accent: string; avatar: string };
}
interface StudentProject extends ProjectRef { portfolio: StudentPortfolio | null }
interface StudentGroup { id: string; name: string; course: string; teacherName: string; projects: StudentProject[] | null }

const ORDER: Section[] = ['home', 'passport', 'biography', 'dossier'];

function nextStep(p: StudentPortfolio | null): string {
  if (!p) return 'Empieza por presentarte en la sección Home.';
  const pending = ORDER.find((s) => p.progress.sections[s].done < p.progress.sections[s].total);
  if (!pending) return 'Todo completo. Dale tu estilo en Diseño y pide publicarlo cuando quieras.';
  const tips: Record<Section, string> = {
    home: 'Sigue con Home: cuéntanos sobre ti y tus objetivos.',
    passport: 'Sigue con tu Passport: tus idiomas y tu autoevaluación.',
    biography: 'Sigue con tu Biography: tu historia, objetivos y la checklist.',
    dossier: 'Sigue con tu Dossier: entrega una evidencia de cada destreza.',
  };
  return tips[pending];
}

function StudentDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api<{ groups: StudentGroup[] }>('/groups'), []);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const act = useAction();
  const nav = useNavigate();

  const open = (projectId: string) =>
    act.run(async () => {
      const r = await api<{ portfolioId: string }>(`/projects/${projectId}/my-portfolio`, { method: 'POST' });
      nav(`/portfolio/${r.portfolioId}`);
    });
  const cards = (data?.groups ?? []).flatMap((g) => (g.projects ?? []).map((p) => ({ g, p })));

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Hi, {user!.displayName}!</h1>
          <p className="lede">Este es tu pasaporte de idiomas. Cada sección completada se sella.</p>
        </div>
        {cards.length > 0 && !joining && <button type="button" className="secondary" onClick={() => setJoining(true)}>Unirme a otro grupo</button>}
      </header>
      {loading && <Loading />}
      <ErrorBox error={error ?? act.error} />
      {data && cards.length === 0 && (
        <EmptyState icon="🧳" title="Aún no estás en ningún grupo">
          <p>Pide a tu profesor el código del grupo y escríbelo aquí abajo.</p>
        </EmptyState>
      )}
      <ul className="passports">
        {cards.map(({ g, p }) => {
          const pf = p.portfolio;
          const pal = PALETTES.find((x) => x.id === pf?.look.palette);
          const bg = pf?.look.accent || pal?.accent;
          return (
            <li key={p.id} className="passport">
              <div className="passport-cover" style={bg ? { '--pc-bg': bg, '--pc-ink': inkOn(bg) } as React.CSSProperties : undefined}>
                <span className="pc-avatar" aria-hidden="true">{pf?.look.avatar || '🌍'}</span>
                <div>
                  <h3>{p.title}</h3>
                  <p>{g.name} · {g.teacherName}</p>
                </div>
              </div>
              <div className="passport-body">
                <SectionStamps sections={ORDER.map((s) => ({
                  key: s, label: SECTION_SHORT[s],
                  done: pf?.progress.sections[s].done ?? 0, total: pf?.progress.sections[s].total ?? 1,
                }))} />
                <div className="row between wrap">
                  <ProgressBar percent={pf?.progress.percent ?? 0} label={`Progreso de ${p.title}`} />
                  {pf && pf.status !== 'private_draft' && <Badge tone={statusTone(pf.status)}>{PORTFOLIO_STATUS[pf.status]}</Badge>}
                </div>
                {p.status === 'closed'
                  ? <p className="next-step">Proyecto cerrado: puedes ver tu portfolio pero ya no cambiarlo.</p>
                  : <p className="next-step"><b>Siguiente paso:</b> {nextStep(pf)}</p>}
                <div className="actions">
                  <button type="button" onClick={() => void open(p.id)} disabled={act.busy}>
                    {!pf ? 'Empezar mi portfolio' : p.status === 'closed' ? 'Ver mi portfolio' : 'Seguir con mi portfolio'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {(cards.length === 0 || joining) && (
        <section className="panel" style={{ marginTop: 24, maxWidth: 560 }}>
          <h2 style={{ marginTop: 0 }}>Unirme a un grupo</h2>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              void act.run(async () => {
                await api('/groups/join', { method: 'POST', body: { code } });
                setCode('');
                setJoining(false);
                await reload();
              });
            }}
          >
            <label>Código que te ha dado tu profesor<input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" autoComplete="off" /></label>
            <div className="actions">
              <button type="submit" disabled={act.busy}>Unirme</button>
              {cards.length > 0 && <button type="button" className="ghost" onClick={() => setJoining(false)}>Cancelar</button>}
            </div>
          </form>
        </section>
      )}
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
    <main className="page">
      <header className="page-head"><div><h1>Administración</h1><p className="lede">Cuentas, recuperación de contraseñas y publicaciones activas.</p></div></header>
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
      {pubs.data?.publications.length === 0 && <EmptyState title="No hay publicaciones activas" />}
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
