import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, EmptyState, ErrorBox, Loading, formatDate, useAction, useLoad } from '../lib/ui';

interface Member {
  id: string;
  login: string;
  displayName: string;
  status: 'active' | 'removed';
  joinedAt: string;
  publicationConsent: boolean;
  consentReference: string | null;
}
interface GroupDetail {
  group: { id: string; name: string; course: string; description: string | null; status: string };
  invite: { active: boolean; usable: boolean; expiresAt: string | null; maxUses: number | null; uses: number };
  members: Member[];
  projects: { id: string; title: string; status: string }[];
}

export function GroupPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<GroupDetail>(`/groups/${id}`), [id]);
  const act = useAction();
  const [newCode, setNewCode] = useState<{ code: string; expiresAt: string; maxUses: number } | null>(null);
  const [resetUrl, setResetUrl] = useState<{ name: string; url: string } | null>(null);
  const [inviteOpts, setInviteOpts] = useState({ expiresInDays: 14, maxUses: 40 });
  const [projectTitle, setProjectTitle] = useState('');

  if (loading && !data) return <main className="page"><Loading /></main>;
  if (!data) return <main className="page"><ErrorBox error={error} /></main>;
  const { group, invite, members, projects } = data;
  const active = members.filter((m) => m.status === 'active');
  const removed = members.filter((m) => m.status === 'removed');

  const consent = (m: Member) => {
    const reference = window.prompt(
      `Registrar autorización de publicación para ${m.displayName}.\n` +
        'Escribe una referencia del documento firmado (p. ej. "Autorización familia 01/10/2026, archivada en secretaría").\n' +
        'No escribas datos personales adicionales.',
    );
    if (!reference) return;
    void act.run(async () => {
      await api(`/groups/${group.id}/members/${m.id}/consents`, { method: 'POST', body: { purpose: 'public_publication', reference } });
      await reload();
    });
  };

  return (
    <main className="page">
      <Link className="back" to="/">Mis grupos</Link>
      <header className="page-head">
        <div>
          <h1>{group.name}</h1>
          <p className="muted">{group.course} · {active.length} {active.length === 1 ? 'alumno' : 'alumnos'}</p>
        </div>
        {projects[0] && <Link className="button" to={`/proyectos/${projects[0].id}`}>Ver seguimiento</Link>}
      </header>
      {group.status === 'archived' && <p className="notice">Grupo archivado: no admite nuevas incorporaciones.</p>}
      <ErrorBox error={act.error ?? error} />

      <section className="panel">
        <h2 className="panel-title">Proyectos</h2>
        <ul className="list">
          {projects.map((p) => (
            <li key={p.id}><Link to={`/proyectos/${p.id}`}>{p.title}</Link> <Badge>{p.status}</Badge></li>
          ))}
        </ul>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          void act.run(async () => {
            await api(`/groups/${group.id}/projects`, { method: 'POST', body: { title: projectTitle } });
            setProjectTitle('');
            await reload();
          });
        }}>
          <label className="grow">Nuevo proyecto<input required maxLength={160} value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} /></label>
          <button type="submit" disabled={act.busy}>Crear</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Incorporar alumnado</h2>
        <p className="muted">
          Genera un código y compártelo en clase: tu alumnado crea su cuenta en <strong>{window.location.origin}/unirse</strong>.
          Por seguridad, el código solo se muestra una vez (para un alumno concreto, genera uno de 1 uso).
        </p>
        <p>
          Código actual:{' '}
          {invite.active
            ? (invite.usable
              ? <Badge tone="ok">Activo · {invite.uses}/{invite.maxUses} usos · caduca {formatDate(invite.expiresAt)}</Badge>
              : <Badge tone="warn">Caducado o agotado</Badge>)
            : <Badge>Sin código</Badge>}
        </p>
        {newCode && (
          <div className="notice code-box" role="status">
            <p>Comparte este código con tus alumnos (válido hasta {formatDate(newCode.expiresAt)}, {newCode.maxUses} usos):</p>
            <p className="big-code">{newCode.code}</p>
            <p className="muted">Se registran en <strong>{window.location.origin}/unirse</strong></p>
          </div>
        )}
        <form className="grid" onSubmit={(e) => {
          e.preventDefault();
          void act.run(async () => {
            setNewCode(await api(`/groups/${group.id}/invite`, { method: 'POST', body: inviteOpts }));
            await reload();
          });
        }}>
          <label>Días de validez<input type="number" min={1} max={60} value={inviteOpts.expiresInDays} onChange={(e) => setInviteOpts({ ...inviteOpts, expiresInDays: Number(e.target.value) })} /></label>
          <label>Usos máximos<input type="number" min={1} max={200} value={inviteOpts.maxUses} onChange={(e) => setInviteOpts({ ...inviteOpts, maxUses: Number(e.target.value) })} /></label>
          <button type="submit" disabled={act.busy || group.status !== 'active'}>{invite.active ? 'Generar nuevo código' : 'Generar código'}</button>
          {invite.active && (
            <button type="button" className="secondary" onClick={() => void act.run(async () => {
              await api(`/groups/${group.id}/invite`, { method: 'DELETE' });
              setNewCode(null);
              await reload();
            })}>Revocar código</button>
          )}
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Alumnado ({active.length})</h2>
        {resetUrl && (
          <div className="notice" role="status">
            <p>Enlace de recuperación para {resetUrl.name} (un solo uso, 60 min). Entrégaselo en persona o por un canal privado:</p>
            <input readOnly value={resetUrl.url} onFocus={(e) => e.target.select()} aria-label="Enlace de recuperación" />
          </div>
        )}
        {active.length === 0 && <EmptyState icon="🎒" title="Todavía no hay alumnos">Genera un código arriba y compártelo en clase.</EmptyState>}
        {active.length > 0 && <div className="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Alta</th><th>Autorización publicación</th><th>Acciones</th></tr></thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td>{m.displayName}</td>
                  <td>{m.login}</td>
                  <td>{formatDate(m.joinedAt)}</td>
                  <td>
                    {m.publicationConsent ? (
                      <>
                        <Badge tone="ok">Registrada</Badge>{' '}
                        <button type="button" className="link" title={m.consentReference ?? ''} onClick={() => {
                          if (!window.confirm('¿Retirar la autorización? Se retirarán también sus publicaciones activas.')) return;
                          void act.run(async () => {
                            await api(`/groups/${group.id}/members/${m.id}/consents/withdraw`, { method: 'POST', body: { purpose: 'public_publication' } });
                            await reload();
                          });
                        }}>Retirar</button>
                      </>
                    ) : (
                      <button type="button" className="secondary small" onClick={() => consent(m)}>Registrar</button>
                    )}
                  </td>
                  <td className="actions">
                    <button type="button" className="secondary small" onClick={() => void act.run(async () => {
                      const r = await api<{ resetUrl: string }>(`/groups/${group.id}/members/${m.id}/reset-link`, { method: 'POST' });
                      setResetUrl({ name: m.displayName, url: r.resetUrl });
                    })}>Recuperar contraseña</button>
                    <button type="button" className="danger small" onClick={() => {
                      if (!window.confirm(`¿Retirar a ${m.displayName} del grupo? Dejarás de ver su portfolio.`)) return;
                      void act.run(async () => {
                        await api(`/groups/${group.id}/members/${m.id}`, { method: 'PATCH', body: { status: 'removed' } });
                        await reload();
                      });
                    }}>Retirar del grupo</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {removed.length > 0 && (
          <details>
            <summary>Retirados ({removed.length})</summary>
            <ul className="list">
              {removed.map((m) => (
                <li key={m.id}>
                  {m.displayName} ({m.login}){' '}
                  <button type="button" className="secondary small" onClick={() => void act.run(async () => {
                    await api(`/groups/${group.id}/members/${m.id}`, { method: 'PATCH', body: { status: 'active' } });
                    await reload();
                  })}>Reincorporar</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Ajustes del grupo</h2>
        <button type="button" className="secondary" onClick={() => void act.run(async () => {
          await api(`/groups/${group.id}`, { method: 'PATCH', body: { status: group.status === 'active' ? 'archived' : 'active' } });
          await reload();
        })}>{group.status === 'active' ? 'Archivar grupo' : 'Reactivar grupo'}</button>
      </section>
    </main>
  );
}
