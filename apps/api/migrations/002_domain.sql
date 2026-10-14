-- 002: modelo de dominio (grupos, proyectos, portfolios, evidencias, revisión, publicación, consentimientos).
-- Las tablas se crean ya para fijar el modelo; la lógica se implementa en las fases 2-5.

CREATE TABLE groups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  course           text NOT NULL DEFAULT '4.º ESO',
  description      text,
  invite_code_hash bytea,
  invite_expires_at timestamptz,
  invite_max_uses  integer CHECK (invite_max_uses IS NULL OR invite_max_uses > 0),
  invite_uses      integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX groups_teacher_idx ON groups (teacher_id);
CREATE UNIQUE INDEX groups_invite_code_uq ON groups (invite_code_hash) WHERE invite_code_hash IS NOT NULL;

CREATE TABLE memberships (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('teacher', 'student')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title            text NOT NULL,
  language         text NOT NULL DEFAULT 'en',
  course           text NOT NULL DEFAULT '4.º ESO',
  template_version integer NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_group_idx ON projects (group_id);

CREATE TABLE activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section      text NOT NULL CHECK (section IN ('home', 'passport', 'biography', 'dossier')),
  title        text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  sort_order   integer NOT NULL DEFAULT 0,
  due_date     date,
  criteria     jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX activities_project_idx ON activities (project_id, section, sort_order);

CREATE TABLE portfolios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'private_draft' CHECK (status IN
               ('private_draft', 'publication_requested', 'changes_requested', 'approved', 'published', 'revoked')),
  content    jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, project_id)
);
CREATE INDEX portfolios_project_idx ON portfolios (project_id);

CREATE TABLE evidences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id        uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  activity_id         uuid REFERENCES activities(id) ON DELETE SET NULL,
  title               text NOT NULL,
  evidence_date       date,
  language            text NOT NULL DEFAULT 'en',
  skill               text NOT NULL CHECK (skill IN
                        ('writing', 'speaking', 'listening', 'reading', 'cultural_project', 'free_choice')),
  external_url        text,
  private_storage_key text,
  file_mime           text,
  file_size           integer,
  reflection          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'returned', 'accepted')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidences_portfolio_idx ON evidences (portfolio_id);

CREATE TABLE reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  evidence_id   uuid REFERENCES evidences(id) ON DELETE CASCADE,
  teacher_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  feedback      text NOT NULL DEFAULT '',
  rubric_result jsonb,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_portfolio_idx ON reviews (portfolio_id);

CREATE TABLE publications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id      uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  slug              text NOT NULL UNIQUE,
  snapshot          jsonb NOT NULL,
  published_version integer NOT NULL,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  allow_indexing    boolean NOT NULL DEFAULT false
);
-- Como máximo una publicación activa por portfolio
CREATE UNIQUE INDEX publications_active_uq ON publications (portfolio_id) WHERE revoked_at IS NULL;

CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('public_publication', 'image_rights')),
  status       text NOT NULL CHECK (status IN ('granted', 'withdrawn')),
  reference    text,
  recorded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX consents_subject_idx ON consents (subject_id, purpose);
