-- 004: diseño visual del portfolio, elegido por el alumno con herramientas cerradas (sin CSS libre).
ALTER TABLE portfolios ADD COLUMN design jsonb NOT NULL DEFAULT '{}'::jsonb;
