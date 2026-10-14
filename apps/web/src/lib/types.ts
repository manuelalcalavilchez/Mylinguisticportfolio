export type Section = 'home' | 'passport' | 'biography' | 'dossier';
export type Skill = 'writing' | 'speaking' | 'listening' | 'reading' | 'cultural_project' | 'free_choice';
export type Level = '' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type Answer = 'not_yet' | 'partly' | 'yes';

export interface PortfolioContent {
  home?: { title?: string; aboutMe?: string; interests?: string; goals?: string[] };
  passport?: {
    languages?: { language?: string; relation?: '' | 'mother_tongue' | 'school' | 'family' | 'other'; notes?: string }[];
    selfAssessment?: Partial<Record<'listening' | 'reading' | 'spokenInteraction' | 'spokenProduction' | 'writing', Level>>;
    certificates?: { name?: string; year?: string }[];
    intercultural?: string;
  };
  biography?: {
    languageHistory?: string;
    strategies?: string;
    objectives?: { goal?: string; how?: string; deadline?: string; achieved?: 'no' | 'partly' | 'yes' }[];
    canDo?: Record<string, Answer>;
  };
  dossier?: { intro?: string };
}

export interface Evidence {
  id: string;
  activityId: string | null;
  title: string;
  date: string | null;
  language: string;
  skill: Skill;
  externalUrl: string | null;
  hasFile: boolean;
  fileMime: string | null;
  fileSize?: number | null;
  reflection: { learned?: string; strengths?: string; difficulties?: string; improvement?: string };
  status?: 'draft' | 'submitted' | 'returned' | 'accepted';
}

export interface Activity {
  id: string;
  section: Section;
  title: string;
  instructions: string;
  dueDate: string | null;
  skill: Skill | null;
}

export interface RubricCriterion {
  id: string;
  name: string;
  levels: { score: number; descriptor: string }[];
}

export interface Review {
  id: string;
  kind: 'comment' | 'evidence_review' | 'assessment' | 'publication';
  section: Section | null;
  evidenceId: string | null;
  feedback: string;
  rubricResult: { scores: Record<string, number>; total: number; max: number } | null;
  status: 'open' | 'resolved';
  createdAt: string;
  teacherName: string;
}

export interface Progress {
  sections: Record<Section, { done: number; total: number }>;
  percent: number;
}

export interface PortfolioResponse {
  as: 'owner' | 'teacher';
  portfolio: {
    id: string;
    projectId: string;
    status: string;
    version: number;
    templateVersion: number;
    content: PortfolioContent;
    publicationRequest: { sections: Section[]; evidenceIds: string[]; publicName: string } | null;
    updatedAt: string;
    editable: boolean;
  };
  student: { displayName: string; login?: string };
  project: { title: string; status: string; rubric: RubricCriterion[] };
  template: { canDo: { id: string; skill: string; text: string }[] };
  activities: Activity[];
  evidences: Evidence[];
  reviews: Review[];
  publication: { slug: string; publishedAt: string } | null;
  progress: Progress;
}

export interface PublicSnapshot {
  publicName: string;
  projectTitle: string;
  language: string;
  course: string;
  sections: PortfolioContent;
  evidences: (Evidence & { hasFile: boolean })[];
  publishedAt?: string;
}

export const SECTION_LABEL: Record<Section, string> = {
  home: 'Home',
  passport: 'My Language Passport',
  biography: 'My Language Biography',
  dossier: 'My Dossier',
};

export const SKILL_LABEL: Record<Skill, string> = {
  writing: 'Writing',
  speaking: 'Speaking',
  listening: 'Listening',
  reading: 'Reading',
  cultural_project: 'Language & culture project',
  free_choice: 'My choice',
};

export const PORTFOLIO_STATUS: Record<string, string> = {
  not_started: 'Sin empezar',
  private_draft: 'Borrador privado',
  publication_requested: 'Publicación solicitada',
  changes_requested: 'Cambios solicitados',
  approved: 'Aprobado (pendiente de publicar)',
  published: 'Publicado',
  revoked: 'Publicación retirada',
};

export const EVIDENCE_STATUS: Record<string, string> = {
  draft: 'Borrador',
  submitted: 'Entregada',
  returned: 'Devuelta para mejorar',
  accepted: 'Aceptada',
};
