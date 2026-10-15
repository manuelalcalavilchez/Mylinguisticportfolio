import { z } from 'zod';
import { SECTIONS } from './validation.js';

/**
 * Diseño del portfolio (v1). El alumno solo elige entre opciones cerradas: no hay CSS, HTML ni URLs libres,
 * así que el diseño nunca puede inyectar estilos o contenido externo en la página pública.
 * Todos los campos tienen valor por defecto: un diseño vacío o antiguo se normaliza al completo.
 */
export const LAYOUTS = ['notebook', 'magazine', 'poster', 'minimal'] as const;
export const PALETTES = ['ocean', 'forest', 'sunset', 'lavender', 'comic', 'night', 'paper', 'cherry'] as const;
export const FONTS = ['modern', 'elegant', 'handwritten', 'typewriter', 'rounded'] as const;
export const PATTERNS = ['none', 'dots', 'stripes', 'waves', 'grid', 'confetti'] as const;
export const CARD_STYLES = ['flat', 'outline', 'shadow', 'tape'] as const;
export const CORNERS = ['square', 'soft', 'round'] as const;

/** Emojis permitidos para avatar y pegatinas (lista cerrada, apta para el aula). */
export const EMOJIS = [
  '🦊', '🐼', '🐨', '🦉', '🐙', '🦋', '🐢', '🦄', '🐧', '🐝', '🐳', '🦁',
  '🌻', '🌵', '🌈', '⭐', '🌍', '🌙', '🔥', '❄️', '🍀', '🌊', '⚡', '☀️',
  '🚀', '✈️', '🗺️', '🗽', '🎡', '🏰', '🎧', '🎸', '🎹', '🎨', '📚', '✏️',
  '📷', '🎬', '🎭', '🎮', '⚽', '🏀', '🛹', '🍕', '☕', '🧁', '💬', '❤️',
  '🇬🇧', '🇮🇪', '🇺🇸', '🇨🇦', '🇦🇺', '🇳🇿', '🇪🇸', '🇫🇷',
] as const;

const emoji = z.enum(EMOJIS);

export const designSchemaV1 = z
  .object({
    layout: z.enum(LAYOUTS).default('notebook'),
    palette: z.enum(PALETTES).default('ocean'),
    // Color de acento propio (opcional). Solo #rrggbb.
    accent: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).default(''),
    font: z.enum(FONTS).default('modern'),
    cover: z
      .object({
        motto: z.string().trim().max(140).default(''),
        avatar: z.union([z.literal(''), emoji]).default(''),
        pattern: z.enum(PATTERNS).default('dots'),
        align: z.enum(['left', 'center']).default('left'),
      })
      .strict()
      .default({ motto: '', avatar: '', pattern: 'dots', align: 'left' }),
    stickers: z.array(emoji).max(6).default([]),
    sectionOrder: z
      .array(z.enum(SECTIONS))
      .length(SECTIONS.length)
      .refine((a) => new Set(a).size === a.length, 'Cada sección debe aparecer una vez')
      .default([...SECTIONS]),
    cardStyle: z.enum(CARD_STYLES).default('outline'),
    corners: z.enum(CORNERS).default('soft'),
  })
  .strict();

export type Design = z.infer<typeof designSchemaV1>;

/** Normaliza un diseño guardado. Si algo no es válido (p. ej. una versión antigua), vuelve a los valores por defecto. */
export function normalizeDesign(raw: unknown): Design {
  const r = designSchemaV1.safeParse(raw ?? {});
  return r.success ? r.data : designSchemaV1.parse({});
}
