import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import {
  PORTFOLIO_STATUS, SECTION_HELP, SECTION_LABEL, SECTION_SHORT, type Evidence, type PortfolioContent, type PortfolioResponse, type PublicSnapshot,
  type Section,
} from '../lib/types';
import { Badge, ErrorBox, Loading, ProgressBar, formatDate, statusTone, useAction, useLoad } from '../lib/ui';
import { PortfolioView, SectionView, Text } from '../components/PortfolioView';
import { DesignStudio } from '../components/DesignStudio';
import { withDefaults, type Design } from '../lib/design';
import {
  BiographyEditor, DossierIntroEditor, HomeEditor, PassportEditor, SaveIndicator, useAutosave,
} from '../components/SectionEditors';
import { StudentEvidences, TeacherEvidences } from '../components/Evidences';

type Tab = Section | 'design' | 'final' | 'feedback' | 'publication';
const SECTIONS: Section[] = ['home', 'passport', 'biography', 'dossier'];

export function PortfolioPage() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<PortfolioResponse>(`/portfolios/${id}`), [id]);
  const [tab, setTab] = useState<Tab>('home');
  if (!data) return <main className="page">{loading ? <Loading /> : <ErrorBox error={error} />}</main>;
  return <PortfolioScreen key={data.portfolio.id} data={data} reload={reload} tab={tab} setTab={setTab} />;
}

function PortfolioScreen({ data, reload, tab, setTab }: {
  data: PortfolioResponse; reload: () => Promise<void>; tab: Tab; setTab: (t: Tab) => void;
}) {
  const { portfolio: p, as } = data;
  const isOwner = as === 'owner';
  const openReviews = data.reviews.filter((r) => r.status === 'open' && r.kind !== 'evidence_review').length;
  // Último diseño guardado (para la vista final sin recargar).
  const [design, setDesign] = useState<Design>(withDefaults(p.design));

  // Control de versión compartido: los guardados se encadenan para no pisarse entre secciones y diseño.
  const versionRef = useRef(p.version);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((path: string, body: (v: number) => unknown) => {
    const run = queue.current.catch(() => undefined).then(async () => {
      const r = await api<{ version: number }>(`/portfolios/${p.id}/${path}`, { method: 'PUT', body: body(versionRef.current) });
      versionRef.current = r.version;
    });
    queue.current = run;
    return run;
  }, [p.id]);
  const saveSection = useCallback(
    (section: Section, value: unknown) => enqueue(`sections/${section}`, (version) => ({ version, data: value })),
    [enqueue],
  );
  const saveDesign = useCallback(async (d: Design) => {
    await enqueue('design', (version) => ({ version, design: d }));
    setDesign(d);
  }, [enqueue]);
  const refresh = async () => {
    await reload();
  };
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };
  const fileUrl = (e: Evidence) => `/api/evidences/${e.id}/file`;
  const sectionIdx = SECTIONS.indexOf(tab as Section);
  const next = sectionIdx >= 0 && sectionIdx < SECTIONS.length - 1 ? SECTIONS[sectionIdx + 1]! : null;
  const prev = sectionIdx > 0 ? SECTIONS[sectionIdx - 1]! : null;
  const navItem = (t: Tab, label: string, extra?: React.ReactNode) => (
    <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
      <span>{label}</span>{extra}
    </button>
  );

  return (
    <main className="page">
      {isOwner ? <Link className="back" to="/">Mis portfolios</Link> : <Link className="back" to={`/proyectos/${p.projectId}`}>Seguimiento del grupo</Link>}
      <header className="page-head">
        <div>
          <h1>{p.content.home?.title || 'My Linguistic Portfolio'}</h1>
          <p className="muted">{data.project.title}{!isOwner && ` · ${data.student.displayName} (${data.student.login})`}</p>
        </div>
        <div className="row wrap">
          <Badge tone={statusTone(p.status)}>{PORTFOLIO_STATUS[p.status]}</Badge>
          <ProgressBar percent={data.progress.percent} label="Progreso del portfolio" />
        </div>
      </header>
      {isOwner && !p.editable && (
        <p className="notice warn">
          {data.project.status !== 'active'
            ? 'El proyecto está cerrado: tu portfolio se puede ver pero ya no se puede cambiar.'
            : 'Tu portfolio está en revisión de publicación. Si quieres seguir editando, cancela la solicitud en «Publicar».'}
        </p>
      )}

      <div className={tab === 'design' || tab === 'final' ? 'pf-editor full' : 'pf-editor'}>
        <nav className="pf-nav" aria-label="Partes del portfolio">
          <span className="nav-group">{isOwner ? 'Escribe' : 'Contenido'}</span>
          {SECTIONS.map((s) => {
            const pr = data.progress.sections[s];
            const done = pr.done >= pr.total;
            return navItem(s, SECTION_SHORT[s], (
              <span className={done ? 'tick done' : 'tick'} aria-label={`${pr.done} de ${pr.total}`}>{done ? '✓' : `${pr.done}/${pr.total}`}</span>
            ));
          })}
          <span className="nav-group">{isOwner ? 'Dale tu estilo' : 'Resultado'}</span>
          {isOwner && navItem('design', '🎨 Diseño')}
          {navItem('final', '👀 Vista final')}
          <span className="nav-group">Revisión</span>
          {navItem('feedback', isOwner ? 'Comentarios' : 'Evaluar', openReviews > 0 ? <Badge tone="info">{openReviews}</Badge> : undefined)}
          {navItem('publication', 'Publicar')}
        </nav>

        <div className="pf-work">
          {sectionIdx >= 0 && (
            <section className="panel" aria-labelledby="sec-title">
              <div className="section-head">
                <div>
                  <h2 id="sec-title">{SECTION_LABEL[tab as Section]}</h2>
                  {isOwner && <p className="section-intro">{SECTION_HELP[tab as Section]}</p>}
                </div>
              </div>
              <Instructions data={data} section={tab as Section} />
              {isOwner && p.editable
                ? <EditableSection key={tab} section={tab as Section} content={p.content} save={saveSection} />
                : <SectionView section={tab as Section} content={p.content} />}
              {tab === 'dossier' && (isOwner
                ? <StudentEvidences portfolioId={p.id} evidences={data.evidences} activities={data.activities} reviews={data.reviews} editable={p.editable} onChange={refresh} />
                : <TeacherEvidences evidences={data.evidences} reviews={data.reviews} onChange={refresh} />)}
              {!isOwner && <CommentBox portfolioId={p.id} section={tab as Section} onChange={refresh} />}
              <div className="section-footer">
                {prev ? <button type="button" className="ghost" onClick={() => go(prev)}>‹ {SECTION_SHORT[prev]}</button> : <span />}
                {next
                  ? <button type="button" onClick={() => go(next)}>Siguiente: {SECTION_SHORT[next]} ›</button>
                  : <button type="button" onClick={() => go(isOwner ? 'design' : 'final')}>{isOwner ? 'Siguiente: diseñar mi portfolio ›' : 'Ver el portfolio final ›'}</button>}
              </div>
            </section>
          )}
          {tab === 'design' && isOwner && (
            <section className="panel">
              <DesignStudio
                initial={design}
                content={p.content}
                evidences={data.evidences}
                fileUrl={fileUrl}
                ownerName={data.student.displayName}
                editable={p.editable}
                save={saveDesign}
              />
            </section>
          )}
          {tab === 'final' && (
            <section>
              <p className="muted">
                {isOwner
                  ? 'Así se ve tu portfolio completo, con todas tus evidencias. Lo que se publique dependerá de lo que elijas en «Publicar».'
                  : 'Portfolio completo con el diseño elegido por el alumno.'}
              </p>
              <div className="preview-frame">
                <PortfolioView content={p.content} evidences={data.evidences} fileUrl={fileUrl} design={design} owner={data.student.displayName} idPrefix="final" />
              </div>
            </section>
          )}
          {tab === 'feedback' && <div className="panel"><FeedbackPanel data={data} onChange={refresh} /></div>}
          {tab === 'publication' && <div className="panel"><PublicationPanel data={data} onChange={refresh} /></div>}
        </div>
      </div>
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
                  <PortfolioView
                    content={preview.snapshot.sections}
                    sections={SECTIONS.filter((s) => s in preview.snapshot!.sections)}
                    evidences={preview.snapshot.evidences as Evidence[]}
                    fileUrl={(e) => `/api/evidences/${e.id}/file`}
                    design={preview.snapshot.design}
                    owner={publicOwnerLine(preview.snapshot)}
                    fallbackTitle={`${preview.snapshot.publicName}’s Linguistic Portfolio`}
                    idPrefix="prev"
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

export function publicOwnerLine(s: PublicSnapshot) {
  return [s.publicName, s.course, s.publishedAt ? formatDate(s.publishedAt) : ''].filter(Boolean).join(' · ');
}
