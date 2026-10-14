import { useState } from 'react';
import { api, upload } from '../lib/api';
import {
  EVIDENCE_STATUS, SKILL_LABEL, type Activity, type Evidence, type Review, type Skill,
} from '../lib/types';
import { Badge, ErrorBox, formatDate, statusTone, useAction } from '../lib/ui';
import { EvidenceView, FilePreview, Text } from './PortfolioView';

const SKILLS = Object.keys(SKILL_LABEL) as Skill[];
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,video/webm,video/mp4,audio/mp4,.m4a';

const fileUrl = (e: Evidence) => `/api/evidences/${e.id}/file`;

function Feedback({ reviews, evidenceId }: { reviews: Review[]; evidenceId: string }) {
  const mine = reviews.filter((r) => r.evidenceId === evidenceId);
  if (!mine.length) return null;
  return (
    <div className="feedback">
      <h5>Teacher feedback</h5>
      {mine.map((r) => (
        <p key={r.id}><span className="muted">{formatDate(r.createdAt)} · {r.teacherName}:</span> <Text value={r.feedback} /></p>
      ))}
    </div>
  );
}

/** Dossier del alumno: crear, editar, adjuntar y entregar evidencias. */
export function StudentEvidences({
  portfolioId, evidences, activities, reviews, editable, onChange,
}: {
  portfolioId: string; evidences: Evidence[]; activities: Activity[]; reviews: Review[]; editable: boolean;
  onChange: () => Promise<void>;
}) {
  const act = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState<Skill>('writing');
  const covered = new Set(evidences.filter((e) => e.status === 'submitted' || e.status === 'accepted').map((e) => e.skill));

  return (
    <section>
      <h3>My evidence</h3>
      <p className="hint">You need at least one piece of evidence for each skill. Accepted formats: PDF, images, audio and video (max size set by your school). Word documents: export them to PDF first.</p>
      <ul className="skill-slots">
        {SKILLS.map((s) => <li key={s} className={covered.has(s) ? 'done' : ''}>{covered.has(s) ? '✓' : '○'} {SKILL_LABEL[s]}</li>)}
      </ul>
      <ErrorBox error={act.error} />
      {evidences.map((e) => (
        <div key={e.id} className="evidence-card">
          <div className="row between">
            <div>
              <strong>{e.title}</strong> <span className="muted">· {SKILL_LABEL[e.skill]}</span>{' '}
              <Badge tone={statusTone(e.status!)}>{EVIDENCE_STATUS[e.status!]}</Badge>
            </div>
            <button type="button" className="secondary small" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              {open === e.id ? 'Cerrar' : editable && (e.status === 'draft' || e.status === 'returned') ? 'Editar' : 'Ver'}
            </button>
          </div>
          <Feedback reviews={reviews} evidenceId={e.id} />
          {open === e.id && (
            editable && (e.status === 'draft' || e.status === 'returned')
              ? <EvidenceForm e={e} activities={activities} onChange={onChange} />
              : <EvidenceView e={e} fileUrl={fileUrl(e)} />
          )}
        </div>
      ))}
      {editable && (
        <form className="row" onSubmit={(ev) => {
          ev.preventDefault();
          void act.run(async () => {
            const act0 = activities.find((a) => a.skill === newSkill);
            const r = await api<{ evidence: Evidence }>(`/portfolios/${portfolioId}/evidences`, {
              method: 'POST',
              body: { title: act0?.title ?? SKILL_LABEL[newSkill], skill: newSkill, activityId: act0?.id ?? null, date: new Date().toISOString().slice(0, 10) },
            });
            await onChange();
            setOpen(r.evidence.id);
          });
        }}>
          <label className="grow">Nueva evidencia
            <select value={newSkill} onChange={(e) => setNewSkill(e.target.value as Skill)}>
              {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
            </select>
          </label>
          <button type="submit" disabled={act.busy}>+ Añadir evidencia</button>
        </form>
      )}
    </section>
  );
}

function EvidenceForm({ e, activities, onChange }: { e: Evidence; activities: Activity[]; onChange: () => Promise<void> }) {
  const [f, setF] = useState({
    title: e.title, date: e.date ?? '', skill: e.skill, activityId: e.activityId ?? '', externalUrl: e.externalUrl ?? '',
    reflection: { learned: '', strengths: '', difficulties: '', improvement: '', ...e.reflection },
  });
  const act = useAction();
  const [msg, setMsg] = useState('');
  const r = (k: keyof typeof f.reflection, label: string, hint: string) => (
    <label>{label}<span className="hint">{hint}</span>
      <textarea rows={3} maxLength={2000} value={f.reflection[k]} onChange={(ev) => setF({ ...f, reflection: { ...f.reflection, [k]: ev.target.value } })} />
    </label>
  );
  const save = () => api(`/evidences/${e.id}`, {
    method: 'PATCH',
    body: { ...f, date: f.date || null, activityId: f.activityId || null, externalUrl: f.externalUrl.trim() || null },
  });

  return (
    <form className="editor" onSubmit={(ev) => {
      ev.preventDefault();
      void act.run(async () => {
        await save();
        setMsg('Guardado ✓');
        await onChange();
      });
    }}>
      <div className="grid">
        <label>Title<input required maxLength={160} value={f.title} onChange={(ev) => setF({ ...f, title: ev.target.value })} /></label>
        <label>Date<input type="date" value={f.date} onChange={(ev) => setF({ ...f, date: ev.target.value })} /></label>
        <label>Skill
          <select value={f.skill} onChange={(ev) => setF({ ...f, skill: ev.target.value as Skill })}>
            {SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Activity
          <select value={f.activityId} onChange={(ev) => setF({ ...f, activityId: ev.target.value })}>
            <option value="">—</option>
            {activities.filter((a) => a.section === 'dossier').map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </label>
      </div>
      <label>Link (optional, https://…)<input type="url" maxLength={2000} value={f.externalUrl} onChange={(ev) => setF({ ...f, externalUrl: ev.target.value })} /></label>
      <fieldset>
        <legend>File</legend>
        {e.hasFile ? (
          <div className="row wrap">
            <FilePreview url={fileUrl(e)} mime={e.fileMime} />
            <button type="button" className="link danger-text" onClick={() => void act.run(async () => {
              await api(`/evidences/${e.id}/file`, { method: 'DELETE' });
              await onChange();
            })}>Quitar archivo</button>
          </div>
        ) : <p className="muted">Sin archivo</p>}
        <input type="file" accept={ACCEPT} aria-label="Subir archivo" onChange={(ev) => {
          const file = ev.target.files?.[0];
          if (!file) return;
          void act.run(async () => {
            await upload(`/evidences/${e.id}/file`, file);
            setMsg('Archivo subido ✓');
            await onChange();
          });
          ev.target.value = '';
        }} />
      </fieldset>
      <fieldset>
        <legend>Reflection</legend>
        {r('learned', 'What did I learn?', 'Required to submit')}
        {r('strengths', 'What did I do well?', '')}
        {r('difficulties', 'What was difficult?', '')}
        {r('improvement', 'How will I improve?', 'Required to submit')}
      </fieldset>
      <ErrorBox error={act.error} />
      <div className="row wrap">
        <button type="submit" disabled={act.busy}>Guardar</button>
        <button type="button" disabled={act.busy} onClick={() => void act.run(async () => {
          await save();
          await api(`/evidences/${e.id}/submit`, { method: 'POST' });
          await onChange();
        })}>Guardar y entregar al profesor</button>
        <button type="button" className="danger" disabled={act.busy} onClick={() => {
          if (!window.confirm('¿Eliminar esta evidencia y su archivo?')) return;
          void act.run(async () => {
            await api(`/evidences/${e.id}`, { method: 'DELETE' });
            await onChange();
          });
        }}>Eliminar</button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </form>
  );
}

/** Vista del profesor: revisar evidencias entregadas. */
export function TeacherEvidences({ evidences, reviews, onChange }: { evidences: Evidence[]; reviews: Review[]; onChange: () => Promise<void> }) {
  return (
    <section>
      <h3>Evidencias ({evidences.length})</h3>
      {evidences.length === 0 && <p className="muted">El alumno aún no ha añadido evidencias.</p>}
      {evidences.map((e) => (
        <div key={e.id} className="evidence-card">
          <EvidenceView e={e} fileUrl={fileUrl(e)} showStatus />
          <Feedback reviews={reviews} evidenceId={e.id} />
          {e.status === 'submitted' && <ReviewForm evidenceId={e.id} onChange={onChange} />}
        </div>
      ))}
    </section>
  );
}

function ReviewForm({ evidenceId, onChange }: { evidenceId: string; onChange: () => Promise<void> }) {
  const [feedback, setFeedback] = useState('');
  const act = useAction();
  const send = (decision: 'accept' | 'return') =>
    void act.run(async () => {
      await api(`/evidences/${evidenceId}/review`, { method: 'POST', body: { decision, feedback } });
      await onChange();
    });
  return (
    <div className="review-form">
      <label>Comentario para el alumno<textarea rows={2} maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
      <ErrorBox error={act.error} />
      <div className="row">
        <button type="button" disabled={act.busy} onClick={() => send('accept')}>Aceptar</button>
        <button type="button" className="secondary" disabled={act.busy} onClick={() => send('return')}>Devolver para mejorar</button>
      </div>
    </div>
  );
}
