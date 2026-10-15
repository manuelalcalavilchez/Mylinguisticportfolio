import { useState, type ReactNode } from 'react';
import {
  CARD_STYLES, CORNERS, DEFAULT_DESIGN, EMOJIS, FONTS, LAYOUTS, PALETTES, PATTERNS, contrast, randomDesign, withDefaults,
  type Design,
} from '../lib/design';
import { SECTION_LABEL, type Evidence, type PortfolioContent, type Section } from '../lib/types';
import { PortfolioView } from './PortfolioView';
import { SaveIndicator, useAutosave } from './SectionEditors';

const MAX_STICKERS = 6;

/**
 * Estudio de diseño: el alumno compone el aspecto de su portfolio final con herramientas cerradas
 * y ve el resultado al instante con su propio contenido.
 */
export function DesignStudio({ initial, content, evidences, fileUrl, ownerName, editable, save }: {
  initial: Partial<Design>;
  content: PortfolioContent;
  evidences: Evidence[];
  fileUrl: (e: Evidence) => string;
  ownerName: string;
  editable: boolean;
  save: (d: Design) => Promise<void>;
}) {
  const [d, setD] = useState<Design>(withDefaults(initial));
  const { state, error, flush } = useAutosave(d, save);
  const set = (patch: Partial<Design>) => setD({ ...d, ...patch });
  const setCover = (patch: Partial<Design['cover']>) => setD({ ...d, cover: { ...d.cover, ...patch } });
  const palette = PALETTES.find((p) => p.id === d.palette)!;
  const lowContrast = d.accent && contrast(d.accent, palette.surface) < 3;

  const move = (i: number, dir: -1 | 1) => {
    const order = [...d.sectionOrder];
    const j = i + dir;
    [order[i], order[j]] = [order[j]!, order[i]!];
    set({ sectionOrder: order });
  };
  const toggleSticker = (e: string) => {
    if (d.stickers.includes(e)) set({ stickers: d.stickers.filter((x) => x !== e) });
    else if (d.stickers.length < MAX_STICKERS) set({ stickers: [...d.stickers, e] });
  };

  return (
    <div>
      <div className="studio-top">
        <div>
          <h2 className="panel-title">Diseña tu portfolio</h2>
          <p className="section-intro">Elige cómo se verá tu portfolio final. Los cambios se guardan solos y se ven al momento en la vista previa.</p>
        </div>
        {editable && (
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setD(randomDesign(d))}>🎲 Sorpréndeme</button>
            <button type="button" className="ghost" onClick={() => setD({ ...DEFAULT_DESIGN, cover: { ...DEFAULT_DESIGN.cover, motto: d.cover.motto } })}>Empezar de cero</button>
          </div>
        )}
      </div>
      {editable && <SaveIndicator state={state} error={error} onRetry={() => void flush()} />}
      {!editable && <p className="notice info">Ahora mismo no puedes cambiar el diseño (proyecto cerrado o publicación en revisión).</p>}

      <div className="studio">
        <fieldset className="studio-tools" disabled={!editable}>
          <legend className="visually-hidden">Herramientas de diseño</legend>
          <Group open title="1. Plantilla" hint="La estructura general de la página.">
            <div className="choice-grid">
              {LAYOUTS.map((l) => (
                <Choice key={l.id} on={d.layout === l.id} onClick={() => set({ layout: l.id })} title={l.hint}>
                  <span className={`thumb thumb-${l.id}`} aria-hidden="true"><i /><i /><i /></span>
                  {l.name}
                </Choice>
              ))}
            </div>
          </Group>

          <Group open title="2. Colores">
            <div className="choice-grid">
              {PALETTES.map((p) => (
                <Choice key={p.id} on={d.palette === p.id && !d.accent} onClick={() => set({ palette: p.id, accent: '' })}>
                  <PaletteSwatch bg={p.bg} accent={p.accent} accent2={p.accent2} ink={p.ink} />
                  {p.name}
                </Choice>
              ))}
            </div>
            <label className="radio" style={{ marginTop: 6 }}>
              <input type="color" value={d.accent || palette.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Mi propio color principal" />
              <span>Mi propio color principal{d.accent && <> · <button type="button" className="link" onClick={() => set({ accent: '' })}>quitar</button></>}</span>
            </label>
            {lowContrast && <p className="hint">Ese color se ve poco sobre el fondo. Prueba uno más oscuro o más intenso.</p>}
          </Group>

          <Group open title="3. Letra">
            <div className="choice-grid">
              {FONTS.map((f) => (
                <Choice key={f.id} on={d.font === f.id} onClick={() => set({ font: f.id })}>
                  <span className={`font-sample f-${f.id}`} aria-hidden="true">Hello!</span>
                  {f.name}
                </Choice>
              ))}
            </div>
          </Group>

          <Group open title="4. Portada">
            <label htmlFor="motto">Mi lema (en inglés, opcional)
              <input id="motto" maxLength={140} value={d.cover.motto} placeholder="e.g. Every word is a new door" onChange={(e) => setCover({ motto: e.target.value })} />
            </label>
            <div>
              <p className="hint" id="avatar-label">Mi icono</p>
              <div className="choice-grid tight" role="group" aria-labelledby="avatar-label">
                <Choice on={!d.cover.avatar} onClick={() => setCover({ avatar: '' })} label="Sin icono"><span aria-hidden="true">∅</span></Choice>
                {EMOJIS.map((e) => (
                  <Choice key={e} emoji on={d.cover.avatar === e} onClick={() => setCover({ avatar: e })} label={`Icono ${e}`}>{e}</Choice>
                ))}
              </div>
            </div>
            <div>
              <p className="hint" id="pattern-label">Fondo de la portada</p>
              <div className="choice-grid" role="group" aria-labelledby="pattern-label">
                {PATTERNS.map((p) => (
                  <Choice key={p.id} on={d.cover.pattern === p.id} onClick={() => setCover({ pattern: p.id })}>
                    <PatternChip pattern={p.id} design={d} />
                    {p.name}
                  </Choice>
                ))}
              </div>
            </div>
            <div className="row wrap" role="group" aria-label="Alineación de la portada">
              <Choice on={d.cover.align === 'left'} onClick={() => setCover({ align: 'left' })}>⟸ A la izquierda</Choice>
              <Choice on={d.cover.align === 'center'} onClick={() => setCover({ align: 'center' })}>⟺ Centrada</Choice>
            </div>
          </Group>

          <Group title="5. Pegatinas" hint={`Elige hasta ${MAX_STICKERS} para decorar la portada (${d.stickers.length}/${MAX_STICKERS}).`}>
            <div className="choice-grid tight">
              {EMOJIS.map((e) => (
                <Choice key={e} emoji on={d.stickers.includes(e)} disabled={!d.stickers.includes(e) && d.stickers.length >= MAX_STICKERS}
                  onClick={() => toggleSticker(e)} label={`Pegatina ${e}`}>{e}</Choice>
              ))}
            </div>
          </Group>

          <Group title="6. Orden de las secciones">
            <ol className="order-list">
              {d.sectionOrder.map((s: Section, i) => (
                <li key={s}>
                  <span>{SECTION_LABEL[s]}</span>
                  <button type="button" className="secondary small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${SECTION_LABEL[s]}`}>↑</button>
                  <button type="button" className="secondary small" disabled={i === d.sectionOrder.length - 1} onClick={() => move(i, 1)} aria-label={`Bajar ${SECTION_LABEL[s]}`}>↓</button>
                </li>
              ))}
            </ol>
          </Group>

          <Group title="7. Tarjetas y esquinas">
            <div className="choice-grid">
              {CARD_STYLES.map((c) => <Choice key={c.id} on={d.cardStyle === c.id} onClick={() => set({ cardStyle: c.id })}>{c.name}</Choice>)}
            </div>
            <div className="choice-grid">
              {CORNERS.map((c) => <Choice key={c.id} on={d.corners === c.id} onClick={() => set({ corners: c.id })}>{c.name}</Choice>)}
            </div>
          </Group>
        </fieldset>

        <div className="studio-preview" id="studio-preview">
          <div className="frame-bar">
            <strong>Así se verá</strong>
            <span className="muted small">Con tu contenido actual</span>
          </div>
          <div className="frame">
            <PortfolioView content={content} evidences={evidences} fileUrl={fileUrl} design={d} owner={ownerName} idPrefix="studio" />
          </div>
        </div>
      </div>
      <div className="studio-mobile-bar"><a className="button" href="#studio-preview">Ver cómo queda</a></div>
    </div>
  );
}

function Group({ title, hint, children, open = false }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="tool-group" open={open}>
      <summary>{title}</summary>
      <div className="tool-body">
        {hint && <p className="hint">{hint}</p>}
        {children}
      </div>
    </details>
  );
}

function Choice({ on, onClick, children, label, title, emoji, disabled }: {
  on: boolean; onClick: () => void; children: ReactNode; label?: string; title?: string; emoji?: boolean; disabled?: boolean;
}) {
  return (
    <button type="button" className={emoji ? 'choice emoji' : 'choice'} aria-pressed={on} aria-label={label} title={title ?? label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function PaletteSwatch({ bg, accent, accent2, ink }: { bg: string; accent: string; accent2: string; ink: string }) {
  return (
    <span className="swatch" aria-hidden="true">
      {[bg, accent, accent2, ink].map((c, i) => <span key={i} style={{ background: c }} />)}
    </span>
  );
}

function PatternChip({ pattern, design }: { pattern: string; design: Design }) {
  const p = PALETTES.find((x) => x.id === design.palette)!;
  return (
    <span
      className={`pattern-chip pf-pattern-${pattern}`}
      aria-hidden="true"
      style={{ '--pf-accent': design.accent || p.accent, '--pf-accent2': p.accent2, background: p.bg } as React.CSSProperties}
    />
  );
}
