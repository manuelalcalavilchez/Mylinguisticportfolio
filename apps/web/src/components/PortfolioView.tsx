import type { ReactNode } from 'react';
import { themeVars, withDefaults, type Design } from '../lib/design';
import {
  EVIDENCE_STATUS, SECTION_LABEL, SECTION_SHORT, SKILL_LABEL, type Evidence, type PortfolioContent, type Section,
} from '../lib/types';
import { Badge, formatDate, statusTone } from '../lib/ui';

// Plantilla v1 (copia de la del servidor para mostrar los textos de autoevaluación).
export const CAN_DO_V1: { id: string; skill: string; text: string }[] = [
  { id: 'l1', skill: 'listening', text: 'I can understand the main points of clear standard speech on familiar matters.' },
  { id: 'l2', skill: 'listening', text: 'I can follow the main points of TV programmes or videos on topics of interest when they speak clearly.' },
  { id: 'r1', skill: 'reading', text: 'I can understand texts that consist mainly of everyday or study-related language.' },
  { id: 'r2', skill: 'reading', text: 'I can understand the description of events, feelings and wishes in personal messages.' },
  { id: 'si1', skill: 'spokenInteraction', text: 'I can take part in conversations on familiar topics without preparation.' },
  { id: 'si2', skill: 'spokenInteraction', text: 'I can deal with most situations likely to arise while travelling.' },
  { id: 'sp1', skill: 'spokenProduction', text: 'I can describe experiences, events, dreams and plans in simple connected sentences.' },
  { id: 'sp2', skill: 'spokenProduction', text: 'I can briefly give reasons and explanations for my opinions.' },
  { id: 'w1', skill: 'writing', text: 'I can write simple connected text on topics which are familiar or of personal interest.' },
  { id: 'w2', skill: 'writing', text: 'I can write personal messages describing experiences and impressions.' },
];

export const SA_LABEL = {
  listening: 'Listening',
  reading: 'Reading',
  spokenInteraction: 'Spoken interaction',
  spokenProduction: 'Spoken production',
  writing: 'Writing',
} as const;

export const RELATION_LABEL: Record<string, string> = {
  '': '—', mother_tongue: 'Mother tongue', school: 'Learnt at school', family: 'Family language', other: 'Other',
};
const ANSWER_LABEL = { not_yet: 'Not yet', partly: 'Partly', yes: 'Yes' } as const;
const ACHIEVED_LABEL = { no: 'Not yet', partly: 'Partly', yes: 'Achieved' } as const;

/** Texto plano preservando saltos de línea. React escapa el contenido: nunca se interpreta como HTML. */
export function Text({ value, empty = '—' }: { value?: string; empty?: string }) {
  if (!value?.trim()) return <span className="muted">{empty}</span>;
  return <span className="pre">{value}</span>;
}

export function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  let ok: boolean;
  try {
    ok = ['http:', 'https:'].includes(new URL(href).protocol);
  } catch {
    ok = false;
  }
  if (!ok) return <span className="muted">(enlace no válido)</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">{children}</a>;
}

export function FilePreview({ url, mime }: { url: string; mime: string | null }) {
  if (!mime) return null;
  if (mime.startsWith('image/')) return <img className="evidence-img" src={url} alt="Evidence file" loading="lazy" />;
  if (mime.startsWith('audio/')) return <audio controls preload="none" src={url} />;
  if (mime.startsWith('video/')) return <video controls preload="none" src={url} className="evidence-video" />;
  return <a href={url} target="_blank" rel="noopener noreferrer">Abrir archivo ({mime === 'application/pdf' ? 'PDF' : mime})</a>;
}

export function SectionView({ section, content }: { section: Section; content: PortfolioContent }) {
  if (section === 'home') {
    const h = content.home ?? {};
    return (
      <div className="view">
        <h4>About me</h4><p><Text value={h.aboutMe} /></p>
        <h4>Interests</h4><p><Text value={h.interests} /></p>
        <h4>My goals</h4>
        {(h.goals ?? []).filter(Boolean).length ? <ul>{h.goals!.filter(Boolean).map((g, i) => <li key={i}><Text value={g} /></li>)}</ul> : <p className="muted">—</p>}
      </div>
    );
  }
  if (section === 'passport') {
    const p = content.passport ?? {};
    return (
      <div className="view">
        <h4>My languages</h4>
        {(p.languages ?? []).length ? (
          <div className="table-wrap"><table><thead><tr><th>Language</th><th>Relation</th><th>Notes</th></tr></thead>
            <tbody>{p.languages!.map((l, i) => <tr key={i}><td>{l.language}</td><td>{RELATION_LABEL[l.relation ?? '']}</td><td><Text value={l.notes} empty="" /></td></tr>)}</tbody>
          </table></div>
        ) : <p className="muted">—</p>}
        <h4>Self-assessment of my English</h4>
        <p className="muted small">Orientative self-assessment based on the CEFR descriptors. It is not an official certification.</p>
        <dl className="grid-dl">
          {(Object.keys(SA_LABEL) as (keyof typeof SA_LABEL)[]).map((k) => (
            <div key={k}><dt>{SA_LABEL[k]}</dt><dd>{p.selfAssessment?.[k] || '—'}</dd></div>
          ))}
        </dl>
        <h4>Certificates</h4>
        {(p.certificates ?? []).length ? <ul>{p.certificates!.map((c, i) => <li key={i}>{c.name} {c.year && `(${c.year})`}</li>)}</ul> : <p className="muted">—</p>}
        <h4>Intercultural experiences</h4><p><Text value={p.intercultural} /></p>
      </div>
    );
  }
  if (section === 'biography') {
    const b = content.biography ?? {};
    return (
      <div className="view">
        <h4>My language learning story</h4><p><Text value={b.languageHistory} /></p>
        <h4>How I learn best</h4><p><Text value={b.strategies} /></p>
        <h4>My objectives</h4>
        {(b.objectives ?? []).length ? (
          <div className="table-wrap"><table><thead><tr><th>Goal</th><th>How</th><th>When</th><th>Status</th></tr></thead>
            <tbody>{b.objectives!.map((o, i) => <tr key={i}><td><Text value={o.goal} /></td><td><Text value={o.how} empty="" /></td><td>{o.deadline}</td><td>{o.achieved ? ACHIEVED_LABEL[o.achieved] : ''}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="muted">—</p>}
        <h4>Can-do checklist</h4>
        <ul className="cando">
          {CAN_DO_V1.map((c) => (
            <li key={c.id}><span>{c.text}</span> <strong>{b.canDo?.[c.id] ? ANSWER_LABEL[b.canDo[c.id]!] : '—'}</strong></li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="view">
      <h4>Introduction</h4><p><Text value={content.dossier?.intro} /></p>
    </div>
  );
}

export function EvidenceView({ e, fileUrl, showStatus, className = 'evidence' }: { e: Evidence; fileUrl?: string; showStatus?: boolean; className?: string }) {
  return (
    <article className={className}>
      <header>
        <h4>{e.title}</h4>
        <span className="skill-tag">{SKILL_LABEL[e.skill]}</span>
        <span className="muted small">{[e.date && formatDate(e.date), e.language].filter(Boolean).join(', ')}</span>
        {showStatus && e.status && <Badge tone={statusTone(e.status)}>{EVIDENCE_STATUS[e.status]}</Badge>}
      </header>
      {e.hasFile && fileUrl && <FilePreview url={fileUrl} mime={e.fileMime} />}
      {e.externalUrl && <p><SafeLink href={e.externalUrl}>{e.externalUrl}</SafeLink></p>}
      <dl className="reflection">
        <dt>What I learnt</dt><dd><Text value={e.reflection.learned} /></dd>
        <dt>My strengths</dt><dd><Text value={e.reflection.strengths} /></dd>
        <dt>Difficulties</dt><dd><Text value={e.reflection.difficulties} /></dd>
        <dt>How I will improve</dt><dd><Text value={e.reflection.improvement} /></dd>
      </dl>
    </article>
  );
}

/**
 * Portfolio final con el diseño elegido por el alumno (vista previa, profesor y página pública).
 * El diseño solo aporta clases y variables de opciones cerradas: el contenido sigue siendo texto escapado por React.
 */
export function PortfolioView({
  content, evidences, sections = ['home', 'passport', 'biography', 'dossier'], fileUrl, design: rawDesign,
  owner, idPrefix = 'pf', footer, fallbackTitle = 'My Linguistic Portfolio',
}: {
  content: PortfolioContent;
  evidences: Evidence[];
  sections?: Section[];
  fileUrl: (e: Evidence) => string;
  design?: Partial<Design> | null;
  /** Línea bajo el título: nombre público, curso... */
  owner?: string;
  idPrefix?: string;
  footer?: ReactNode;
  fallbackTitle?: string;
}) {
  const d = withDefaults(rawDesign);
  const order = d.sectionOrder.filter((s) => sections.includes(s));
  const showDossier = order.includes('dossier') || evidences.length > 0;
  const finalOrder = showDossier && !order.includes('dossier') ? [...order, 'dossier' as Section] : order;
  const title = content.home?.title?.trim() || fallbackTitle;
  const cls = [
    'pf', `pf-layout-${d.layout}`, `pf-font-${d.font}`, `pf-card-${d.cardStyle}`, `pf-corners-${d.corners}`,
  ].join(' ');
  return (
    <div className="pf-wrap">
    <article className={cls} style={themeVars(d) as React.CSSProperties}>
      <header className={`pf-cover pf-pattern-${d.cover.pattern} pf-align-${d.cover.align}${d.stickers.length ? ' has-stickers' : ''}`}>
        {d.stickers.map((st, i) => <span key={i} className={`pf-sticker s${i}`} aria-hidden="true">{st}</span>)}
        <div className="pf-cover-row">
          {d.cover.avatar && <div className="pf-avatar" aria-hidden="true">{d.cover.avatar}</div>}
          <div>
            {owner && <p className="pf-owner">{owner}</p>}
            <h1 className="pf-title">{title}</h1>
          </div>
        </div>
        {d.cover.motto && <p className="pf-motto">{d.cover.motto}</p>}
        {finalOrder.length > 1 && (
          <nav className="pf-toc" aria-label="Contents">
            {finalOrder.map((s) => <a key={s} href={`#${idPrefix}-${s}`}>{SECTION_SHORT[s]}</a>)}
          </nav>
        )}
      </header>
      <div className="pf-body">
        {finalOrder.map((s) => (
          <section key={s} id={`${idPrefix}-${s}`} className={`pf-section pf-${s}${s === 'dossier' ? '' : ' pf-card'}`}>
            {s === 'dossier' ? (
              <>
                <div className="pf-card">
                  <h2 className="pf-h2">{SECTION_LABEL[s]}</h2>
                  {sections.includes('dossier') && <SectionView section={s} content={content} />}
                </div>
                {evidences.length > 0 && (
                  <div className="pf-evidences">
                    {evidences.map((e) => <EvidenceView key={e.id} e={e} fileUrl={fileUrl(e)} className="evidence pf-card pf-evidence" />)}
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="pf-h2">{SECTION_LABEL[s]}</h2>
                <SectionView section={s} content={content} />
              </>
            )}
          </section>
        ))}
      </div>
      {footer && <footer className="pf-footer">{footer}</footer>}
    </article>
    </div>
  );
}
