import type { Section } from './types';

/** Opciones cerradas del diseño (deben coincidir con apps/api/src/lib/design.ts). */
export type Layout = 'notebook' | 'magazine' | 'poster' | 'minimal';
export type Palette = 'ocean' | 'forest' | 'sunset' | 'lavender' | 'comic' | 'night' | 'paper' | 'cherry';
export type Font = 'modern' | 'elegant' | 'handwritten' | 'typewriter' | 'rounded';
export type Pattern = 'none' | 'dots' | 'stripes' | 'waves' | 'grid' | 'confetti';
export type CardStyle = 'flat' | 'outline' | 'shadow' | 'tape';
export type Corners = 'square' | 'soft' | 'round';

export interface Design {
  layout: Layout;
  palette: Palette;
  accent: string;
  font: Font;
  cover: { motto: string; avatar: string; pattern: Pattern; align: 'left' | 'center' };
  stickers: string[];
  sectionOrder: Section[];
  cardStyle: CardStyle;
  corners: Corners;
}

export const DEFAULT_DESIGN: Design = {
  layout: 'notebook',
  palette: 'ocean',
  accent: '',
  font: 'modern',
  cover: { motto: '', avatar: '', pattern: 'dots', align: 'left' },
  stickers: [],
  sectionOrder: ['home', 'passport', 'biography', 'dossier'],
  cardStyle: 'outline',
  corners: 'soft',
};

/** Completa un diseño parcial o antiguo con los valores por defecto. */
export function withDefaults(d?: Partial<Design> | null): Design {
  return { ...DEFAULT_DESIGN, ...(d ?? {}), cover: { ...DEFAULT_DESIGN.cover, ...(d?.cover ?? {}) } };
}

export const LAYOUTS: { id: Layout; name: string; hint: string }[] = [
  { id: 'notebook', name: 'Cuaderno', hint: 'Páginas con renglones, una debajo de otra' },
  { id: 'magazine', name: 'Revista', hint: 'Portada grande y contenido a dos columnas' },
  { id: 'poster', name: 'Póster', hint: 'Bloques de color intensos y títulos enormes' },
  { id: 'minimal', name: 'Minimalista', hint: 'Mucho aire, líneas finas, nada sobra' },
];

export interface PaletteDef { id: Palette; name: string; bg: string; surface: string; ink: string; accent: string; accent2: string }
export const PALETTES: PaletteDef[] = [
  { id: 'ocean', name: 'Océano', bg: '#e6eff7', surface: '#ffffff', ink: '#0f2a43', accent: '#1f6fb2', accent2: '#f2a93b' },
  { id: 'forest', name: 'Bosque', bg: '#e9f1e6', surface: '#fbfdf9', ink: '#1e3324', accent: '#2f7d4f', accent2: '#e8b44c' },
  { id: 'sunset', name: 'Atardecer', bg: '#ffeee4', surface: '#ffffff', ink: '#3a1f2b', accent: '#d94a35', accent2: '#f6b73c' },
  { id: 'lavender', name: 'Lavanda', bg: '#efebfa', surface: '#ffffff', ink: '#2a2350', accent: '#6a4fc4', accent2: '#f28db2' },
  { id: 'comic', name: 'Cómic', bg: '#fff5c9', surface: '#ffffff', ink: '#111111', accent: '#e63946', accent2: '#2b7de9' },
  { id: 'night', name: 'Noche', bg: '#121726', surface: '#1c2236', ink: '#eceff7', accent: '#7fd1c7', accent2: '#f5c26b' },
  { id: 'paper', name: 'Papel', bg: '#efebe2', surface: '#fffdf8', ink: '#2b2926', accent: '#4f6272', accent2: '#c8a96a' },
  { id: 'cherry', name: 'Cereza', bg: '#fcecf0', surface: '#ffffff', ink: '#3b1424', accent: '#c2185b', accent2: '#7cb342' },
];

export const FONTS: { id: Font; name: string }[] = [
  { id: 'modern', name: 'Moderna' },
  { id: 'elegant', name: 'Elegante' },
  { id: 'handwritten', name: 'A mano' },
  { id: 'typewriter', name: 'Máquina de escribir' },
  { id: 'rounded', name: 'Redondeada' },
];

export const PATTERNS: { id: Pattern; name: string }[] = [
  { id: 'none', name: 'Liso' },
  { id: 'dots', name: 'Lunares' },
  { id: 'stripes', name: 'Rayas' },
  { id: 'waves', name: 'Ondas' },
  { id: 'grid', name: 'Cuadrícula' },
  { id: 'confetti', name: 'Confeti' },
];

export const CARD_STYLES: { id: CardStyle; name: string }[] = [
  { id: 'flat', name: 'Lisas' },
  { id: 'outline', name: 'Con borde' },
  { id: 'shadow', name: 'Pegatina' },
  { id: 'tape', name: 'Cinta adhesiva' },
];

export const CORNERS: { id: Corners; name: string }[] = [
  { id: 'square', name: 'Rectas' },
  { id: 'soft', name: 'Suaves' },
  { id: 'round', name: 'Redondas' },
];

export const EMOJIS = [
  '🦊', '🐼', '🐨', '🦉', '🐙', '🦋', '🐢', '🦄', '🐧', '🐝', '🐳', '🦁',
  '🌻', '🌵', '🌈', '⭐', '🌍', '🌙', '🔥', '❄️', '🍀', '🌊', '⚡', '☀️',
  '🚀', '✈️', '🗺️', '🗽', '🎡', '🏰', '🎧', '🎸', '🎹', '🎨', '📚', '✏️',
  '📷', '🎬', '🎭', '🎮', '⚽', '🏀', '🛹', '🍕', '☕', '🧁', '💬', '❤️',
  '🇬🇧', '🇮🇪', '🇺🇸', '🇨🇦', '🇦🇺', '🇳🇿', '🇪🇸', '🇫🇷',
] as const;

// --- Contraste (WCAG) para avisar si el color propio se lee mal ---
function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
}
/** Texto legible (negro o blanco) sobre un color. */
export function inkOn(hex: string) {
  return contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#111111' : '#ffffff';
}

/** Variables CSS del tema. Se aplican con CSSOM (compatible con la CSP, que bloquea estilos en línea). */
export function themeVars(d: Design): Record<string, string> {
  const p = PALETTES.find((x) => x.id === d.palette) ?? PALETTES[0]!;
  const accent = d.accent || p.accent;
  return {
    '--pf-bg': p.bg,
    '--pf-surface': p.surface,
    '--pf-ink': p.ink,
    '--pf-accent': accent,
    '--pf-accent-ink': inkOn(accent),
    '--pf-accent2': p.accent2,
    '--pf-accent2-ink': inkOn(p.accent2),
  };
}

/** Combinación aleatoria para el botón «Sorpréndeme». */
export function randomDesign(current: Design): Design {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;
  const pool = [...EMOJIS];
  const stickers = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
  return {
    ...current,
    layout: pick(LAYOUTS).id,
    palette: pick(PALETTES).id,
    accent: '',
    font: pick(FONTS).id,
    cover: { ...current.cover, avatar: pick(EMOJIS), pattern: pick(PATTERNS).id, align: pick(['left', 'center'] as const) },
    stickers,
    cardStyle: pick(CARD_STYLES).id,
    corners: pick(CORNERS).id,
  };
}
