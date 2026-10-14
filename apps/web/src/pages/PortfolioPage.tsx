import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  PORTFOLIO_STATUS, SECTION_LABEL, type Evidence, type PortfolioContent, type PortfolioResponse, type PublicSnapshot,
  type Section,
} from '../lib/types';
import { Badge, ErrorBox, Loading, ProgressBar, formatDate, statusTone, useAction, useLoad } from '../lib/ui';
import { PortfolioView, SectionView, Text } from '../components/PortfolioView';
import {
  BiographyEditor, DossierIntroEditor, HomeEditor, PassportEditor, SaveIndicator, useAutosave,
} from '../components/SectionEditors';
import { StudentEvidences, TeacherEvidences } from '../components/Evidences';

type Tab = Section | 'feedback' | 'publication';
const SECTIONS: Section[] = ['home', 'passport', 'biography', 'dossier'];

export function PortfolioPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<PortfolioResponse>(`/portfolios/${id}`), [id]);
  const [tab, setTab] = useState<Tab>('home');
  if (!data) return <main className="card">{loading ? <Loading /> : <ErrorBox error={error} />}</main>;
  return <PortfolioScreen key={data.portfolio.id} data={data} reload={reload} tab={tab} setTab={setTab} />;
}

function PortfolioScreen({ data, reload, tab, setTab }: {
  data: PortfolioResponse; reload: () => Promise<void>; tab: Tab; setTab: (t: Tab) => void;
}) {
  const { portfolio: p, as } = data;
  const isOwner = as === 'owner';
  const openReviews = data.reviews.filter((r) => r.status === 'open' && r.kind !== 'evidence_review').length;

  // Control de versión compartido: los guardados se encadenan para no pisarse entre secciones.
  const versionRef = useRef(p.version);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const saveSection = useCallback(
    (section: Section, value: unknown) => {
      const run = queue.current.catch(() => undefined).then(async () => {
        const r = await api<{ version: number }>(`/portfolios/${p.id}/sections/${section}`, {
          method: 'PUT', body: { version: versionRef.current, data: value },
        });
        versionRef.current = r.version;
      });
      queue.current = run;
      return run;
    },
    [p.id],
  );
  const refresh = async () => {
    await reload();
  };

  return (
    <main className="card wide">
      <p>{isOwner ? <Link to="/">← Inicio</Link> : <Link to={`/proyectos/${p.projectId}`}>← Seguimiento del grupo</Link>}</p>
      <header className="portfolio-header">
        <div>
          <h1>{p.content.home?.title || 'My Linguistic Portfolio'}</h1>
          <p className="muted">
            {data.project.title}{!isOwner && ` · ${data.student.displayName} (${data.student.login})`}
          </p>
        </div>
        <div>
          <Badge tone={statusTone(p.status)}>{PORTFOLIO_STATUS[p.status]}</Badge>
          <ProgressBar percent={data.progress.percent} label="Progreso del portfolio" />
        </div>
      </header>
      {isOwner && !p.editable && (
        <p className="notice">
          {data.project.status !== 'active'
            ? 'El proyecto está cerrado: el portfolio es de solo lectura.'
            : 'Tu portfolio está en revisión de publicación. Para editar, cancela la solicitud en la pestaña Publicación.'}
        </p>
      )}
      <nav className="tabs" role="tablist" aria-label="Secciones del portfolio">
        {SECTIONS.map((s) => (
          <button key={s} role="tab" aria-selected={tab === s} className={tab === s ? 'tab active' : 'tab'} onClick={() => setTab(s)}>
            {SECTION_LABEL[s]} <span className="muted small">{data.progress.sections[s].done}/{data.progress.sections[s].total}</span>
          </button>
        ))}
        <button role="tab" aria-selected={tab === 'feedback'} className={tab === 'feedback' ? 'tab active' : 'tab'} onClick={() => setTab('feedback')}>
          {isOwner ? 'Feedback' : 'Revisión'} {openReviews > 0 && <Badge tone="info">{openReviews}</Badge>}
        </button>
        <button role="tab" aria-selected={tab === 'publication'} className={tab === 'publication' ? 'tab active' : 'tab'} onClick={() => setTab('publication')}>
          Publicación
        </button>
      </nav>

      {SECTIONS.includes(tab as Section) && (
        <section role="tabpanel">
          <Instructions data={data} section={tab as Section} />
          {isOwner && p.editable
            ? <EditableSection section={tab as Section} content={p.content} save={saveSection} />
            : <SectionView section={tab as Section} content={p.content} />}
          {tab === 'dossier' && (isOwner
            ? <StudentEvidences portfolioId={p.id} evidences={data.evidences} activities={data.activities} reviews={data.reviews} editable={p.editable} onChange={refresh} />
            : <TeacherEvidences evidences={data.evidences} reviews={data.reviews} onChange={refresh} />)}
          {!isOwner && <CommentBox portfolioId={p.id} section={tab as Section} onChange={refresh} />}
        </section>
      )}
      {tab === 'feedback' && <FeedbackPanel data={data} onChange={refresh} />}
      {tab === 'publication' && <PublicationPanel data={data} onChange={refresh} />}
    </main>
  );
}

function Instructions({ data, section }: { data: PortfolioResponse; section: Section }) {
  const acts = data.activities.filter((a) => a.section === section && (section !== 'dossier' || !a.skill));
  const comments = data.reviews.filter((r) => r.kind === 'comment' && r.section === section && r.status === 'open');
  if (!acts.length && !comments.length) return null;
  return (
    <div className="instructions">
      {acts.map((a) => (
        <p key={a.id}><strong>{a.title}</strong>{a.dueDate && <span className="muted"> · entrega {formatDate(a.dueDate)}</span>}<br /><Text value={a.instructions} empty="" /></p>
      ))}
      {comments.map((c) => (
        <p key={c.id} className="comment">💬 {c.teacherName}: <Text value={c.feedback} /></p>
      ))}
    </div>
  );
}

function EditableSection({ section, content, save }: {
  section: Section; content: PortfolioContent; save: (s: Section, v: unknown) => Promise<void>;
}) {
  // Un editor por sección; el estado local se inicializa una vez y se guarda automáticamente.
  if (section === 'home') return <Auto section="home" initial={content.home ?? {}} save={save} render={(v, set) => <HomeEditor value={v} onChange={set} />} />;
  if (section === 'passport') return <Auto section="passport" initial={content.passport ?? {}} save={save} render={(v, set) => <PassportEditor value={v} onChange={set} />} />;
  if (section === 'biography') return <Auto section="biography" initial={content.biography ?? {}} save={save} render={(v, set) => <BiographyEditor value={v} onChange={set} />} />;
  return <Auto section="dossier" initial={content.dossier ?? {}} save={save} render={(v, set) => <DossierIntroEditor value={v} onChange={set} />} />;
}

function Auto<T>({ section, initial, save, render }: {
  section: Section; initial: T; save: (s: Section, v: unknown) => Promise<void>;
  render: (v: T, set: (v: T) => void) => React.ReactNode;
}) {
  const [value, setValue] = useState<T>(initial);
  const { state, error, flush } = useAutosave(value, (v) => save(section, v));
  return (
    <>
      <SaveIndicator state={state} error={error} onRetry={() => void flush()} />
      {render(value, setValue)}
    </>
  );
}

function CommentBox({ portfolioId, section, onChange }: { portfolioId: string; section: Section; onChange: () => Promise<void> }) {
  const [feedback, setFeedback] = useState('');
  const act = useAction();
  return (
    <form className="comment-box" onSubmit={(e) => {
      e.preventDefault();
      void act.run(async () => {
        await api(`/portfolios/${portfolioId}/comments`, { method: 'POST', body: { section, feedback } });
        setFeedback('');
        await onChange();
      });
    }}>
      <label>Comentario sobre {SECTION_LABEL[section]}<textarea rows={2} maxLength={4000} required value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
      <ErrorBox error={act.error} />
      <button type="submit" disabled={act.busy}>Enviar comentario</button>
    </form>
  );
}

function FeedbackPanel({ data, onChange }: { data: PortfolioResponse; onChange: () => Promise<void> }) {
  const isOwner = data.as === 'owner';
  const act = useAction();
  const rubric = data.project.rubric;
  const [scores, setScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState('');
  const general = data.reviews.filter((r) => r.kind !== 'evidence_review');
  const kindLabel = { comment: 'Comentario', assessment: 'Evaluación', publication: 'Publicación', evidence_review: 'Evidencia' };

  return (
    <section role="tabpanel">
      <h2>{isOwner ? 'Feedback de tu profesor' : 'Revisión y evaluación'}</h2>
      <ErrorBox error={act.error} />
      {general.length === 0 && <p className="muted">Todavía no hay comentarios.</p>}
      <ul className="reviews">
        {general.map((r) => (
          <li key={r.id} className={r.status === 'resolved' ? 'resolved' : ''}>
            <p className="muted small">
              {kindLabel[r.kind]}{r.section ? ` · ${SECTION_LABEL[r.section]}` : ''} · {formatDate(r.createdAt)} · {r.teacherName}
            </p>
            {r.rubricResult && (
              <p><strong>Rúbrica: {r.rubricResult.total}/{r.rubricResult.max}</strong>{' '}
                <span className="muted">({Object.entries(r.rubricResult.scores).map(([k, v]) => `${rubric.find((c) => c.id === k)?.name ?? k}: ${v}`).join(' · ')})</span>
              </p>
            )}
            <p><Text value={r.feedback} empty="" /></p>
            <button type="button" className="link" onClick={() => void act.run(async () => {
              await api(`/portfolios/${data.portfolio.id}/reviews/${r.id}`, { method: 'PATCH', body: { status: r.status === 'open' ? 'resolved' : 'open' } });
              await onChange();
            })}>{r.status === 'open' ? 'Marcar como resuelto' : 'Reabrir'}</button>
          </li>
        ))}
      </ul>
      {!isOwner && rubric.length > 0 && (
        <form className="assessment" onSubmit={(e) => {
          e.preventDefault();
          void act.run(async () => {
            await api(`/portfolios/${data.portfolio.id}/assessment`, { method: 'POST', body: { scores, feedback } });
            setScores({});
            setFeedback('');
            await onChange();
          });
        }}>
          <h3>Evaluar con la rúbrica</h3>
          <p className="muted small">Orientativa: no sustituye la programación del centro ni certifica un nivel MCER.</p>
          {rubric.map((c) => (
            <fieldset key={c.id}>
              <legend>{c.name}</legend>
              {c.levels.map((l) => (
                <label key={l.score} className="radio block">
                  <input type="radio" name={`rb-${c.id}`} checked={scores[c.id] === l.score} onChange={() => setScores({ ...scores, [c.id]: l.score })} />
                  <strong>{l.score}</strong> {l.descriptor}
                </label>
              ))}
            </fieldset>
          ))}
          <label>Comentario general<textarea rows={3} maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
          <button type="submit" disabled={act.busy || Object.keys(scores).length === 0}>Guardar evaluación</button>
        </form>
      )}
    </section>
  );
}

interface Preview { snapshot: PublicSnapshot | null; problems: { code: string; message: string; details?: { path: string; issue: string }[] }[]; status: string }

function PublicationPanel({ data, onChange }: { data: PortfolioResponse; onChange: () => Promise<void> }) {
  const { portfolio: p, as } = data;
  const act = useAction();
  const accepted = data.evidences.filter((e) => e.status === 'accepted');
  const req = p.publicationRequest;
  const [sel, setSel] = useState<{ sections: Section[]; evidenceIds: string[]; publicName: string }>({
    sections: req?.sections ?? ['home', 'passport', 'biography', 'dossier'],
    evidenceIds: req?.evidenceIds ?? accepted.map((e) => e.id),
    publicName: req?.publicName ?? '',
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [changes, setChanges] = useState('');
  const loadPreview = () => act.run(async () => setPreview(await api<Preview>(`/portfolios/${p.id}/publication/preview`)));
  const post = (path: string, body?: unknown) => act.run(async () => {
    await api(`/portfolios/${p.id}/publication/${path}`, { method: 'POST', body });
    setPreview(null);
    await onChange();
  });
  const toggle = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);
  const pubUrl = data.publication ? `${window.location.origin}/p/${data.publication.slug}` : null;
  const canRequest = ['private_draft', 'changes_requested', 'published', 'revoked'].includes(p.status);
  const issueLabel: Record<string, string> = { email: 'un email', phone: 'un teléfono', username: 'tu nombre de usuario' };

  return (
    <section role="tabpanel">
      <h2>Publicación</h2>
      <p className="muted">
        Tu portfolio es <strong>privado</strong>. Solo se publica una copia de lo que elijas, después de que tu profesor lo revise y apruebe,
        y si el centro tiene la autorización de tu familia. La copia publicada no cambia aunque sigas editando. Se puede retirar en cualquier momento.
      </p>
      <ErrorBox error={act.error} />
      {pubUrl && (
        <div className="notice">
          <p>Publicado el {formatDate(data.publication!.publishedAt)}: <a href={pubUrl} target="_blank" rel="noopener noreferrer">{pubUrl}</a></p>
          <button type="button" className="danger" disabled={act.busy} onClick={() => {
            if (window.confirm('¿Retirar la publicación? El enlace dejará de funcionar. Tu portfolio privado no se borra.')) void post('revoke');
          }}>Retirar publicación</button>
        </div>
      )}

      {as === 'owner' && canRequest && p.editable && (
        <form className="editor" onSubmit={(e) => { e.preventDefault(); void post('request', sel); }}>
          <h3>{pubUrl ? 'Solicitar publicar una versión nueva' : 'Solicitar publicación'}</h3>
          <fieldset>
            <legend>Secciones a publicar</legend>
            {SECTIONS.map((s) => (
              <label key={s} className="radio">
                <input type="checkbox" checked={sel.sections.includes(s)} onChange={() => setSel({ ...sel, sections: toggle(sel.sections, s) })} /> {SECTION_LABEL[s]}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Evidencias (solo las aceptadas por tu profesor)</legend>
            {accepted.length === 0 && <p className="muted">Aún no tienes evidencias aceptadas.</p>}
            {accepted.map((e) => (
              <label key={e.id} className="radio block">
                <input type="checkbox" checked={sel.evidenceIds.includes(e.id)} onChange={() => setSel({ ...sel, evidenceIds: toggle(sel.evidenceIds, e.id) })} /> {e.title}
              </label>
            ))}
          </fieldset>
          <label>Nombre público (nombre de pila o alias, sin apellidos)
            <input required minLength={2} maxLength={40} value={sel.publicName} onChange={(e) => setSel({ ...sel, publicName: e.target.value })} placeholder="p. ej. Alba R." />
          </label>
          <p className="hint">Antes de enviar, revisa que no aparezcan tu apellido, dirección, teléfono, email, centro ni fotos de otras personas.</p>
          <button type="submit" disabled={act.busy || sel.sections.length === 0}>Enviar a mi profesor</button>
        </form>
      )}

      {as === 'owner' && p.status === 'publication_requested' && (
        <div className="notice">
          <p>Solicitud enviada. Tu profesor la revisará.</p>
          <button type="button" className="secondary" disabled={act.busy} onClick={() => void post('cancel')}>Cancelar solicitud y volver a editar</button>
        </div>
      )}
      {as === 'owner' && p.status === 'approved' && <p className="notice">Tu profesor ha aprobado la publicación. Pronto estará disponible.</p>}

      {as === 'teacher' && ['publication_requested', 'approved'].includes(p.status) && (
        <div className="editor">
          <h3>{p.status === 'approved' ? 'Aprobado: pendiente de publicar' : 'Solicitud de publicación'}</h3>
          <p className="muted">Nombre público solicitado: <strong>{req?.publicName}</strong> · Secciones: {req?.sections.map((s) => SECTION_LABEL[s]).join(', ')} · {req?.evidenceIds.length ?? 0} evidencias</p>
          {p.status === 'publication_requested' && (
            <div className="row wrap">
              <button type="button" disabled={act.busy} onClick={() => void post('approve')}>Aprobar</button>
            </div>
          )}
          {p.status === 'approved' && (
            <div className="row wrap">
              <button type="button" disabled={act.busy} onClick={() => void post('publish', {})}>Publicar ahora</button>
            </div>
          )}
          <label>Solicitar cambios (el alumno verá este mensaje)<textarea rows={2} maxLength={4000} value={changes} onChange={(e) => setChanges(e.target.value)} /></label>
          <button type="button" className="secondary" disabled={act.busy || !changes.trim()} onClick={() => void post('request-changes', { feedback: changes })}>Solicitar cambios</button>
        </div>
      )}

      {(req || p.status !== 'private_draft') && (
        <div>
          <button type="button" className="secondary" disabled={act.busy} onClick={() => void loadPreview()}>Ver vista previa exacta de lo que se publicaría</button>
          {preview && (
            <>
              {preview.problems.length > 0 && (
                <div className="alert">
                  <p>Requisitos pendientes:</p>
                  <ul>
                    {preview.problems.map((x) => (
                      <li key={x.code}>
                        {x.message}
                        {x.details && <ul>{x.details.map((d, i) => <li key={i}>Revisa «{d.path}»: contiene {issueLabel[d.issue] ?? d.issue}</li>)}</ul>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.snapshot && (
                <div className="preview-frame" aria-label="Vista previa">
                  <PublicHeader s={preview.snapshot} />
                  <PortfolioView
                    content={preview.snapshot.sections}
                    sections={SECTIONS.filter((s) => s in preview.snapshot!.sections || s === 'dossier' && preview.snapshot!.evidences.length > 0)}
                    evidences={preview.snapshot.evidences as Evidence[]}
                    fileUrl={(e) => `/api/evidences/${e.id}/file`}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
      {data.reviews.filter((r) => r.kind === 'publication').slice(0, 1).map((r) => (
        <p key={r.id} className="comment">Último mensaje del profesor sobre la publicación: <Text value={r.feedback} /></p>
      ))}
      <p className="muted small">Estado: <Badge tone={statusTone(p.status)}>{PORTFOLIO_STATUS[p.status]}</Badge></p>
    </section>
  );
}

export function PublicHeader({ s }: { s: PublicSnapshot }) {
  return (
    <header className="public-header">
      <h1>{s.sections.home?.title || `${s.publicName}’s Linguistic Portfolio`}</h1>
      <p className="muted">{s.publicName} · {s.projectTitle} · {s.course}{s.publishedAt ? ` · ${formatDate(s.publishedAt)}` : ''}</p>
    </header>
  );
}
