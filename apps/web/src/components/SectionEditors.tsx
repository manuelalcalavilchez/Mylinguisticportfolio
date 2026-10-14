import { useEffect, useRef, useState } from 'react';
import type { Answer, Level, PortfolioContent } from '../lib/types';
import { ErrorBox } from '../lib/ui';
import { CAN_DO_V1, RELATION_LABEL, SA_LABEL } from './PortfolioView';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/** Guardado automático con espera de 1,2 s tras el último cambio. Avisa si se cierra la página con cambios. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<void>) {
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<unknown>(null);
  const first = useRef(true);
  const seq = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  const flush = async () => {
    const my = ++seq.current;
    setState('saving');
    try {
      await save(latest.current);
      if (my === seq.current) {
        setState('saved');
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) {
        setState('error');
        setError(e);
      }
    }
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState('dirty');
    const t = setTimeout(() => void flush(), 1200);
    return () => clearTimeout(t);
  }, [JSON.stringify(value)]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [state]);

  return { state, error, flush };
}

export function SaveIndicator({ state, error, onRetry }: { state: SaveState; error: unknown; onRetry: () => void }) {
  const text = { saved: 'Todos los cambios guardados ✓', dirty: 'Cambios sin guardar…', saving: 'Guardando…', error: 'No se ha podido guardar' }[state];
  return (
    <div className={`save-state save-${state}`} role="status" aria-live="polite">
      <span>{text}</span>
      {state === 'error' && <><ErrorBox error={error} /><button type="button" className="secondary small" onClick={onRetry}>Reintentar</button></>}
    </div>
  );
}

type Editor<K extends keyof PortfolioContent> = {
  value: NonNullable<PortfolioContent[K]>;
  onChange: (v: NonNullable<PortfolioContent[K]>) => void;
};

function Area({ id, label, hint, value, max, rows = 5, onChange }: {
  id: string; label: string; hint?: string; value?: string; max: number; rows?: number; onChange: (v: string) => void;
}) {
  return (
    <label htmlFor={id}>
      {label}
      {hint && <span className="hint">{hint}</span>}
      <textarea id={id} rows={rows} maxLength={max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      <span className="counter">{(value ?? '').length}/{max}</span>
    </label>
  );
}

export function HomeEditor({ value, onChange }: Editor<'home'>) {
  const goals = value.goals ?? [];
  return (
    <div className="editor">
      <label htmlFor="h-title">Title of my portfolio<input id="h-title" maxLength={120} value={value.title ?? ''} onChange={(e) => onChange({ ...value, title: e.target.value })} /></label>
      <Area id="h-about" label="About me" hint="Introduce yourself in English. Do not include your surname, address, phone or school name." value={value.aboutMe} max={3000} onChange={(aboutMe) => onChange({ ...value, aboutMe })} />
      <Area id="h-int" label="My interests" value={value.interests} max={1000} rows={3} onChange={(interests) => onChange({ ...value, interests })} />
      <fieldset>
        <legend>My goals for this course</legend>
        {goals.map((g, i) => (
          <div className="row" key={i}>
            <input aria-label={`Goal ${i + 1}`} maxLength={300} value={g} onChange={(e) => onChange({ ...value, goals: goals.map((x, j) => (j === i ? e.target.value : x)) })} />
            <button type="button" className="link danger-text" onClick={() => onChange({ ...value, goals: goals.filter((_, j) => j !== i) })} aria-label={`Remove goal ${i + 1}`}>✕</button>
          </div>
        ))}
        {goals.length < 10 && <button type="button" className="secondary small" onClick={() => onChange({ ...value, goals: [...goals, ''] })}>+ Add goal</button>}
      </fieldset>
    </div>
  );
}

const LEVELS: Level[] = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function PassportEditor({ value, onChange }: Editor<'passport'>) {
  const langs = value.languages ?? [];
  const certs = value.certificates ?? [];
  const sa = value.selfAssessment ?? {};
  return (
    <div className="editor">
      <fieldset>
        <legend>My languages</legend>
        {langs.map((l, i) => (
          <div className="row wrap" key={i}>
            <input aria-label="Language" placeholder="Language" maxLength={60} value={l.language ?? ''} onChange={(e) => onChange({ ...value, languages: langs.map((x, j) => (j === i ? { ...x, language: e.target.value } : x)) })} />
            <select aria-label="Relation" value={l.relation ?? ''} onChange={(e) => onChange({ ...value, languages: langs.map((x, j) => (j === i ? { ...x, relation: e.target.value as typeof l.relation } : x)) })}>
              {Object.entries(RELATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input aria-label="Notes" placeholder="Notes" maxLength={300} value={l.notes ?? ''} onChange={(e) => onChange({ ...value, languages: langs.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)) })} />
            <button type="button" className="link danger-text" aria-label="Remove language" onClick={() => onChange({ ...value, languages: langs.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {langs.length < 10 && <button type="button" className="secondary small" onClick={() => onChange({ ...value, languages: [...langs, { language: '', relation: '' }] })}>+ Add language</button>}
      </fieldset>
      <fieldset>
        <legend>Self-assessment of my English</legend>
        <p className="hint">Choose the level you think you have in each skill. It is orientative, not an official certificate.</p>
        <div className="grid">
          {(Object.keys(SA_LABEL) as (keyof typeof SA_LABEL)[]).map((k) => (
            <label key={k}>{SA_LABEL[k]}
              <select value={sa[k] ?? ''} onChange={(e) => onChange({ ...value, selfAssessment: { ...sa, [k]: e.target.value as Level } })}>
                {LEVELS.map((lv) => <option key={lv} value={lv}>{lv || '—'}</option>)}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Certificates (optional)</legend>
        {certs.map((c, i) => (
          <div className="row" key={i}>
            <input aria-label="Certificate" placeholder="e.g. Cambridge A2 Key" maxLength={120} value={c.name ?? ''} onChange={(e) => onChange({ ...value, certificates: certs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input aria-label="Year" placeholder="Year" maxLength={4} className="short" value={c.year ?? ''} onChange={(e) => onChange({ ...value, certificates: certs.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)) })} />
            <button type="button" className="link danger-text" aria-label="Remove certificate" onClick={() => onChange({ ...value, certificates: certs.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {certs.length < 10 && <button type="button" className="secondary small" onClick={() => onChange({ ...value, certificates: [...certs, { name: '' }] })}>+ Add certificate</button>}
      </fieldset>
      <Area id="p-inter" label="Intercultural experiences" hint="Trips, exchanges, online friends, films, music…" value={value.intercultural} max={2000} onChange={(intercultural) => onChange({ ...value, intercultural })} />
    </div>
  );
}

export function BiographyEditor({ value, onChange }: Editor<'biography'>) {
  const objs = value.objectives ?? [];
  const canDo = value.canDo ?? {};
  return (
    <div className="editor">
      <Area id="b-hist" label="My language learning story" hint="When and how did you start learning languages? What has helped you?" value={value.languageHistory} max={4000} onChange={(languageHistory) => onChange({ ...value, languageHistory })} />
      <Area id="b-str" label="How I learn best (strategies)" value={value.strategies} max={2000} rows={3} onChange={(strategies) => onChange({ ...value, strategies })} />
      <fieldset>
        <legend>My objectives (at least 2)</legend>
        {objs.map((o, i) => (
          <div className="row wrap" key={i}>
            <input aria-label="Goal" placeholder="Goal" maxLength={300} value={o.goal ?? ''} onChange={(e) => onChange({ ...value, objectives: objs.map((x, j) => (j === i ? { ...x, goal: e.target.value } : x)) })} />
            <input aria-label="How" placeholder="How will I do it?" maxLength={300} value={o.how ?? ''} onChange={(e) => onChange({ ...value, objectives: objs.map((x, j) => (j === i ? { ...x, how: e.target.value } : x)) })} />
            <input aria-label="When" placeholder="When?" maxLength={40} className="short" value={o.deadline ?? ''} onChange={(e) => onChange({ ...value, objectives: objs.map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)) })} />
            <select aria-label="Status" value={o.achieved ?? 'no'} onChange={(e) => onChange({ ...value, objectives: objs.map((x, j) => (j === i ? { ...x, achieved: e.target.value as 'no' } : x)) })}>
              <option value="no">Not yet</option><option value="partly">Partly</option><option value="yes">Achieved</option>
            </select>
            <button type="button" className="link danger-text" aria-label="Remove objective" onClick={() => onChange({ ...value, objectives: objs.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {objs.length < 10 && <button type="button" className="secondary small" onClick={() => onChange({ ...value, objectives: [...objs, { goal: '', achieved: 'no' }] })}>+ Add objective</button>}
      </fieldset>
      <fieldset>
        <legend>Can-do checklist</legend>
        <ul className="cando edit">
          {CAN_DO_V1.map((c) => (
            <li key={c.id}>
              <span id={`cd-${c.id}`}>{c.text}</span>
              <span className="radios" role="radiogroup" aria-labelledby={`cd-${c.id}`}>
                {(['not_yet', 'partly', 'yes'] as Answer[]).map((a) => (
                  <label key={a} className="radio">
                    <input type="radio" name={`cd-${c.id}`} checked={canDo[c.id] === a} onChange={() => onChange({ ...value, canDo: { ...canDo, [c.id]: a } })} />
                    {{ not_yet: 'Not yet', partly: 'Partly', yes: 'Yes' }[a]}
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </fieldset>
    </div>
  );
}

export function DossierIntroEditor({ value, onChange }: Editor<'dossier'>) {
  return (
    <div className="editor">
      <Area id="d-intro" label="Introduction to my dossier" hint="Explain which pieces of work you chose and why." value={value.intro} max={2000} rows={3} onChange={(intro) => onChange({ ...value, intro })} />
    </div>
  );
}
