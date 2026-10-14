import { z } from 'zod';
import type { Section, Skill } from './validation.js';

/**
 * Plantilla v1: Inglés · 4.º ESO.
 * Las plantillas se versionan: un portfolio guarda su template_version y nunca se migra automáticamente,
 * así que cambios futuros (v2) no rompen el trabajo existente.
 */
export const CURRENT_TEMPLATE_VERSION = 1;

const text = (max: number) => z.string().max(max);
const LEVEL = z.enum(['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const ANSWER = z.enum(['not_yet', 'partly', 'yes']);

export const CAN_DO_V1 = [
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
] as const;

export const contentSchemaV1 = z
  .object({
    home: z
      .object({
        title: text(120),
        aboutMe: text(3000),
        interests: text(1000),
        goals: z.array(text(300)).max(10),
      })
      .partial()
      .strict(),
    passport: z
      .object({
        languages: z
          .array(
            z
              .object({
                language: text(60),
                relation: z.enum(['', 'mother_tongue', 'school', 'family', 'other']),
                notes: text(300),
              })
              .partial(),
          )
          .max(10),
        selfAssessment: z
          .object({ listening: LEVEL, reading: LEVEL, spokenInteraction: LEVEL, spokenProduction: LEVEL, writing: LEVEL })
          .partial(),
        certificates: z.array(z.object({ name: text(120), year: text(4) }).partial()).max(10),
        intercultural: text(2000),
      })
      .partial()
      .strict(),
    biography: z
      .object({
        languageHistory: text(4000),
        strategies: text(2000),
        objectives: z
          .array(
            z
              .object({ goal: text(300), how: text(300), deadline: text(40), achieved: z.enum(['no', 'partly', 'yes']) })
              .partial(),
          )
          .max(10),
        canDo: z.partialRecord(z.enum(CAN_DO_V1.map((c) => c.id) as [string, ...string[]]), ANSWER),
      })
      .partial()
      .strict(),
    dossier: z.object({ intro: text(2000) }).partial().strict(),
  })
  .partial()
  .strict();

export type PortfolioContent = z.infer<typeof contentSchemaV1>;
export const sectionSchemasV1 = contentSchemaV1.shape;

export const DEFAULT_ACTIVITIES_V1: { section: Section; title: string; instructions: string; skill?: Skill }[] = [
  { section: 'home', title: 'Introduce yourself', instructions: 'Write a short presentation of yourself and your goals for this course.' },
  { section: 'passport', title: 'My language profile', instructions: 'List the languages you know and assess your English in each skill.' },
  { section: 'biography', title: 'My language learning story', instructions: 'Describe how you learn languages, your strategies and at least two goals.' },
  { section: 'dossier', skill: 'writing', title: 'Writing evidence', instructions: 'A text you wrote in English (e.g. an email, a story or an essay).' },
  { section: 'dossier', skill: 'speaking', title: 'Speaking evidence', instructions: 'An audio or video recording of you speaking English.' },
  { section: 'dossier', skill: 'listening', title: 'Listening evidence', instructions: 'A task showing what you understood from an audio or video.' },
  { section: 'dossier', skill: 'reading', title: 'Reading evidence', instructions: 'A task about a text, article or book you read in English.' },
  { section: 'dossier', skill: 'cultural_project', title: 'Language and culture project', instructions: 'A project about the culture of English-speaking countries.' },
  { section: 'dossier', skill: 'free_choice', title: 'My choice', instructions: 'Any piece of work you are proud of.' },
];

export interface RubricCriterion {
  id: string;
  name: string;
  levels: { score: number; descriptor: string }[];
}

export const rubricSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z0-9_-]{1,30}$/),
      name: z.string().trim().min(1).max(120),
      levels: z
        .array(z.object({ score: z.number().int().min(0).max(10), descriptor: z.string().trim().max(400) }))
        .min(2)
        .max(6),
    }),
  )
  .max(12);

const LV = (d: [string, string, string, string]) => d.map((descriptor, i) => ({ score: i + 1, descriptor }));
export const DEFAULT_RUBRIC_V1: RubricCriterion[] = [
  { id: 'completeness', name: 'Completeness of the portfolio', levels: LV(['Most sections missing', 'Some sections complete', 'Almost complete', 'All sections complete and careful']) },
  { id: 'reflection', name: 'Quality of reflection', levels: LV(['Very little reflection', 'Descriptive reflection', 'Identifies strengths and difficulties', 'Deep reflection with concrete improvement plans']) },
  { id: 'evidence', name: 'Variety and quality of evidence', levels: LV(['Few or unrelated evidences', 'Some skills covered', 'All skills covered', 'All skills covered with high-quality work']) },
  { id: 'language', name: 'Use of English', levels: LV(['Frequent errors impede understanding', 'Understandable with errors', 'Generally accurate', 'Accurate and varied language']) },
];

const filled = (s?: string) => !!s && s.trim().length > 0;

export interface Progress {
  sections: Record<Section, { done: number; total: number }>;
  percent: number;
}

/** Progreso orientativo del portfolio (no es certificación MCER). */
export function computeProgress(
  content: PortfolioContent,
  evidences: { skill: Skill; status: string }[],
): Progress {
  const h = content.home ?? {};
  const p = content.passport ?? {};
  const b = content.biography ?? {};
  const sa = p.selfAssessment ?? {};
  const canDoAnswered = Object.keys(b.canDo ?? {}).length;
  const delivered = new Set(evidences.filter((e) => e.status === 'submitted' || e.status === 'accepted').map((e) => e.skill));
  const skills: Skill[] = ['writing', 'speaking', 'listening', 'reading', 'cultural_project', 'free_choice'];

  const sections: Progress['sections'] = {
    home: { done: [filled(h.aboutMe), (h.goals ?? []).some(filled)].filter(Boolean).length, total: 2 },
    passport: {
      done: [
        (p.languages ?? []).some((l) => filled(l.language)),
        Object.values(sa).filter(Boolean).length === 5,
      ].filter(Boolean).length,
      total: 2,
    },
    biography: {
      done: [
        filled(b.languageHistory),
        (b.objectives ?? []).filter((o) => filled(o.goal)).length >= 2,
        canDoAnswered >= CAN_DO_V1.length,
      ].filter(Boolean).length,
      total: 3,
    },
    dossier: { done: skills.filter((s) => delivered.has(s)).length, total: skills.length },
  };
  const done = Object.values(sections).reduce((a, s) => a + s.done, 0);
  const total = Object.values(sections).reduce((a, s) => a + s.total, 0);
  return { sections, percent: Math.round((done / total) * 100) };
}
