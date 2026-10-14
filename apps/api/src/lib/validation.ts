import { z } from 'zod';

export const emailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());
/** Usuario para alumnado: sin email, solo [a-z0-9._-]. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,29}$/, '3-30 caracteres: letras, números, punto, guion o guion bajo');
/** Identificador de login: email o usuario. */
export const loginIdSchema = z.string().trim().toLowerCase().min(3).max(254);
export const passwordSchema = z.string().min(10, 'Mínimo 10 caracteres').max(200);
export const displayNameSchema = z.string().trim().min(1).max(80);
export const uuidSchema = z.uuid();

/** Solo URLs http(s): bloquea javascript:, data:, etc. */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Solo se admiten enlaces http(s)');

export const SKILLS = ['writing', 'speaking', 'listening', 'reading', 'cultural_project', 'free_choice'] as const;
export type Skill = (typeof SKILLS)[number];
export const SECTIONS = ['home', 'passport', 'biography', 'dossier'] as const;
export type Section = (typeof SECTIONS)[number];
