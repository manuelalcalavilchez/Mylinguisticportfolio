-- 003: ajustes para el piloto
-- * El identificador de acceso puede ser un email (profesores) o un nombre de usuario (alumnado):
--   no exigimos email a menores (minimización de datos).
ALTER TABLE users RENAME COLUMN email TO login;
DROP INDEX users_email_lower_uq;
CREATE UNIQUE INDEX users_login_lower_uq ON users (lower(login));

-- * Rúbrica configurable por proyecto
ALTER TABLE projects ADD COLUMN rubric jsonb NOT NULL DEFAULT '[]'::jsonb;

-- * Actividades del dossier ligadas a una destreza
ALTER TABLE activities ADD COLUMN skill text CHECK (skill IS NULL OR skill IN
  ('writing', 'speaking', 'listening', 'reading', 'cultural_project', 'free_choice'));

-- * Versión de plantilla del portfolio y selección enviada al pedir publicación
ALTER TABLE portfolios
  ADD COLUMN template_version integer NOT NULL DEFAULT 1,
  ADD COLUMN publication_request jsonb;

-- * Tipos de revisión: comentario de sección, revisión de evidencia, evaluación con rúbrica, publicación
ALTER TABLE reviews
  ADD COLUMN kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'evidence_review', 'assessment', 'publication')),
  ADD COLUMN section text CHECK (section IS NULL OR section IN ('home', 'passport', 'biography', 'dossier'));

ALTER TABLE publications ADD COLUMN approved_at timestamptz;

-- Una actividad/evidencia nunca debe apuntar a un portfolio de otro proyecto: se valida en la aplicación.
CREATE INDEX evidences_activity_idx ON evidences (activity_id);
CREATE INDEX consents_active_idx ON consents (subject_id, purpose) WHERE status = 'granted';
