import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  PORTFOLIO_STATUS, SECTION_LABEL, SKILL_LABEL, type Activity, type Progress, type RubricCriterion, type Section, type Skill,
} from '../lib/types';
import { Badge, ErrorBox, Loading, ProgressBar, formatDate, statusTone, useAction, useLoad } from '../lib/ui';

interface ProjectResp {
  project: { id: string; groupId: string; title: string; status: string; rubric: RubricCriterion[] };
  activities: Activity[];
}
interface ProgressResp {
  students: {
    studentId: string; displayName: string; login: string; portfolioId: string | null; status: string;
    updatedAt: string | null; pendingReviews: number; progress: Progress;
  }[];
  groupAverage: number;
}

export function ProjectPage() {
  const { id } = useParams();
  const proj = useLoad(() => api<ProjectResp>(`/projects/${id}`), [id]);
  const prog = useLoad(() => api<ProgressResp>(`/projects/${id}/progress`), [id]);
  const act = useAction();
  const [tab, setTab] = useState<'progress' | 'activities' | 'rubric'>('progress');

  if (!proj.data) return <main className="card">{proj.loading ? <Loading /> : <ErrorBox error={proj.error} />}</main>;
  const { project, activities } = proj.data;

  return (
    <main className="card wide">
      <p><Link to={`/grupos/${project.groupId}`}>← Grupo</Link></p>
      <h1>{project.title} <Badge>{project.status === 'active' ? 'activo' : project.status}</Badge></h1>
      <ErrorBox error={act.error} />
      <div className="tabs" role="tablist">
        {(['progress', 'activities', 'rubric'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {{ progress: 'Seguimiento', activities: 'Actividades', rubric: 'Rúbrica' }[t]}
          </button>
        ))}
      </div>

      {tab === 'progress' && (
        <section>
          <p className="muted">Progreso orientativo: no equivale a una certificación de nivel MCER.</p>
          {prog.loading && <Loading />}
          <ErrorBox error={prog.error} />
          {prog.data && (
            <>
              <ProgressBar percent={prog.data.groupAverage} label="Media del grupo" />
              <p className="muted">Media del grupo: {prog.data.groupAverage}% · {prog.data.students.length} alumnos</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Alumno</th><th>Estado</th><th>Progreso</th>
                      {(Object.keys(SECTION_LABEL) as Section[]).map((s) => <th key={s}>{SECTION_LABEL[s].replace('My ', '')}</th>)}
                      <th>Por revisar</th><th>Actualizado</th></tr>
                  </thead>
                  <tbody>
                    {prog.data.students.map((s) => (
                      <tr key={s.studentId}>
                        <td>{s.portfolioId ? <Link to={`/portfolio/${s.portfolioId}`}>{s.displayName}</Link> : s.displayName}</td>
                        <td><Badge tone={statusTone(s.status)}>{PORTFOLIO_STATUS[s.status] ?? s.status}</Badge></td>
                        <td>{s.progress.percent}%</td>
                        {(Object.keys(SECTION_LABEL) as Section[]).map((k) => (
                          <td key={k}>{s.progress.sections[k].done}/{s.progress.sections[k].total}</td>
                        ))}
                        <td>{s.pendingReviews > 0 ? <Badge tone="info">{s.pendingReviews}</Badge> : '—'}</td>
                        <td>{formatDate(s.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p>
            <button type="button" className="secondary" onClick={() => void act.run(async () => {
              await api(`/projects/${project.id}`, { method: 'PATCH', body: { status: project.status === 'active' ? 'closed' : 'active' } });
              await proj.reload();
            })}>{project.status === 'active' ? 'Cerrar proyecto (deja de admitir cambios)' : 'Reabrir proyecto'}</button>
          </p>
        </section>
      )}

      {tab === 'activities' && <ActivitiesEditor projectId={project.id} activities={activities} onChange={proj.reload} />}
      {tab === 'rubric' && <RubricEditor projectId={project.id} rubric={project.rubric} onChange={proj.reload} />}
    </main>
  );
}

function ActivitiesEditor({ projectId, activities, onChange }: { projectId: string; activities: Activity[]; onChange: () => Promise<void> }) {
  const act = useAction();
  const empty = { section: 'dossier' as Section, title: '', instructions: '', dueDate: '', skill: '' as Skill | '' };
  const [form, setForm] = useState(empty);
  return (
    <section>
      <ErrorBox error={act.error} />
      {(Object.keys(SECTION_LABEL) as Section[]).map((s) => (
        <div key={s}>
          <h3>{SECTION_LABEL[s]}</h3>
          <ul className="list">
            {activities.filter((a) => a.section === s).map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong>{a.skill ? ` · ${SKILL_LABEL[a.skill]}` : ''}{a.dueDate ? ` · entrega ${formatDate(a.dueDate)}` : ''}
                <br /><span className="muted">{a.instructions}</span>{' '}
                <button type="button" className="link" onClick={() => {
                  const dueDate = window.prompt('Fecha de entrega (AAAA-MM-DD, vacío para quitarla):', a.dueDate ?? '');
                  if (dueDate === null) return;
                  void act.run(async () => {
                    await api(`/activities/${a.id}`, { method: 'PATCH', body: { dueDate: dueDate || null } });
                    await onChange();
                  });
                }}>Fecha</button>{' '}
                <button type="button" className="link danger-text" onClick={() => {
                  if (!window.confirm('¿Eliminar la actividad? Las evidencias vinculadas se conservan.')) return;
                  void act.run(async () => {
                    await api(`/activities/${a.id}`, { method: 'DELETE' });
                    await onChange();
                  });
                }}>Eliminar</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <h3>Nueva actividad</h3>
      <form className="grid" onSubmit={(e) => {
        e.preventDefault();
        void act.run(async () => {
          await api(`/projects/${projectId}/activities`, {
            method: 'POST',
            body: { ...form, dueDate: form.dueDate || null, skill: form.skill || null },
          });
          setForm(empty);
          await onChange();
        });
      }}>
        <label>Sección
          <select value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value as Section })}>
            {(Object.keys(SECTION_LABEL) as Section[]).map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Título<input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Destreza
          <select value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value as Skill | '' })}>
            <option value="">—</option>
            {(Object.keys(SKILL_LABEL) as Skill[]).map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Entrega<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
        <label className="span-all">Instrucciones<textarea rows={3} maxLength={3000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
        <button type="submit" disabled={act.busy}>Añadir</button>
      </form>
    </section>
  );
}

function RubricEditor({ projectId, rubric, onChange }: { projectId: string; rubric: RubricCriterion[]; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState<RubricCriterion[]>(rubric);
  const act = useAction();
  const [saved, setSaved] = useState(false);
  const update = (i: number, c: RubricCriterion) => {
    setSaved(false);
    setDraft(draft.map((x, j) => (j === i ? c : x)));
  };
  return (
    <section>
      <p className="muted">
        Propuesta inicial de rúbrica, configurable. Es una ayuda orientativa y no sustituye la programación didáctica del centro.
      </p>
      {draft.map((c, i) => (
        <fieldset key={i} className="criterion">
          <legend>Criterio {i + 1}</legend>
          <label>Nombre<input value={c.name} maxLength={120} onChange={(e) => update(i, { ...c, name: e.target.value })} /></label>
          {c.levels.map((l, k) => (
            <label key={k}>Nivel {l.score}
              <input value={l.descriptor} maxLength={400} onChange={(e) => update(i, { ...c, levels: c.levels.map((x, m) => (m === k ? { ...x, descriptor: e.target.value } : x)) })} />
            </label>
          ))}
          <button type="button" className="link danger-text" onClick={() => { setSaved(false); setDraft(draft.filter((_, j) => j !== i)); }}>Quitar criterio</button>
        </fieldset>
      ))}
      <div className="row">
        <button type="button" className="secondary" disabled={draft.length >= 12} onClick={() => {
          setSaved(false);
          setDraft([...draft, {
            id: `c${Date.now().toString(36)}`, name: 'New criterion',
            levels: [1, 2, 3, 4].map((score) => ({ score, descriptor: '' })),
          }]);
        }}>Añadir criterio</button>
        <button type="button" disabled={act.busy} onClick={() => void act.run(async () => {
          await api(`/projects/${projectId}/rubric`, { method: 'PUT', body: { rubric: draft } });
          await onChange();
          setSaved(true);
        })}>Guardar rúbrica</button>
        {saved && <span role="status">Guardada ✓</span>}
      </div>
      <ErrorBox error={act.error} />
    </section>
  );
}
