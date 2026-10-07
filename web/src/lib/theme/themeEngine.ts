export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemePreset {
  id: string;
  name: string;
  nameFa: string;
  primary: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'teal', name: 'Teal (Calm)', nameFa: 'فیروزه‌ای (آرامش‌بخش)', primary: '#0f766e' },
  { id: 'cyan', name: 'Cyan (Precision)', nameFa: 'آبی اقیانوسی', primary: '#0284c7' },
  { id: 'sky', name: 'Sky (Clarity)', nameFa: 'آبی آسمانی', primary: '#0284c7' },
  { id: 'indigo', name: 'Indigo (Modern)', nameFa: 'نیلی (مدرن)', primary: '#4f46e5' },
  { id: 'violet', name: 'Violet (Cosmic)', nameFa: 'بنفش کیهانی', primary: '#7c3aed' },
  { id: 'purple', name: 'Purple (Deep)', nameFa: 'ارغوانی', primary: '#9333ea' },
  { id: 'fuchsia', name: 'Fuchsia (Radiant)', nameFa: 'سرخابی', primary: '#c026d3' },
  { id: 'rose', name: 'Rose (Vibrant)', nameFa: 'رز (پویا)', primary: '#e11d48' },
  { id: 'crimson', name: 'Crimson (Bold)', nameFa: 'یاقوتی', primary: '#dc2626' },
  { id: 'orange', name: 'Orange (Electric)', nameFa: 'نارنجی پرانرژی', primary: '#ea580c' },
  { id: 'amber', name: 'Amber (Warm)', nameFa: 'کهربایی (گرم)', primary: '#d97706' },
  { id: 'emerald', name: 'Emerald (Natural)', nameFa: 'زمردی (طبیعی)', primary: '#059669' },
  { id: 'lime', name: 'Lime (Fresh)', nameFa: 'لیمویی', primary: '#65a30d' },
  { id: 'slate', name: 'Slate (Monochrome)', nameFa: 'خاکستری تیره', primary: '#475569' },
  { id: 'zinc', name: 'Zinc (Neutral)', nameFa: 'روی (خنثی)', primary: '#52525b' },
];

// Helper to convert hex to RGB
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  if (clean.length !== 6) {
    return { r: 15, g: 118, b: 110 }; // Fallback to teal
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) {
    return { r: 15, g: 118, b: 110 };
  }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

// Blend color with black or white or another color
export function mix(hex1: string, hex2: string, weight: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  const r = c1.r * (1 - weight) + c2.r * weight;
  const g = c1.g * (1 - weight) + c2.g * weight;
  const b = c1.b * (1 - weight) + c2.b * weight;
  return rgbToHex(r, g, b);
}

export function generateMaterial3ThemeTokens(primaryHex: string, isDark: boolean): Record<string, string> {
  const validHex = primaryHex.startsWith('#') ? primaryHex : `#${primaryHex}`;
  
  if (isDark) {
    // Google Material 3 Dark Palette with authentic tonal elevation
    const primary = mix(validHex, '#ffffff', 0.4);
    const onPrimary = mix(validHex, '#000000', 0.88);
    const primaryContainer = mix(validHex, '#000000', 0.6);
    const onPrimaryContainer = mix(validHex, '#ffffff', 0.82);

    return {
      '--md-sys-color-primary': primary,
      '--md-sys-color-on-primary': onPrimary,
      '--md-sys-color-primary-container': primaryContainer,
      '--md-sys-color-on-primary-container': onPrimaryContainer,
      '--md-sys-color-secondary': mix(primary, '#94a3b8', 0.4),
      '--md-sys-color-secondary-container': '#1e293b',
      '--md-sys-color-on-secondary-container': '#cbd5e1',

      // M3 Surface Tonal Container Hierarchy
      '--md-sys-color-surface': '#0b0f14',
      '--md-sys-color-surface-dim': '#080c10',
      '--md-sys-color-surface-bright': '#171c24',
      '--md-sys-color-surface-container-lowest': '#070a0e',
      '--md-sys-color-surface-container-low': '#10141b',
      '--md-sys-color-surface-container': '#141922',
      '--md-sys-color-surface-container-high': '#1c222e',
      '--md-sys-color-surface-container-highest': '#252c3c',

      '--md-sys-color-on-surface': '#f1f5f9',
      '--md-sys-color-on-surface-variant': '#94a3b8',
      '--md-sys-color-outline': 'rgba(148, 163, 184, 0.18)',
      '--md-sys-color-outline-variant': 'rgba(148, 163, 184, 0.09)',

      '--md-sys-color-error': '#f87171',
      '--md-sys-color-error-container': 'rgba(239, 68, 68, 0.16)',
      '--md-sys-color-on-error': '#450a0a',
    };
  } else {
    // Google Material 3 Light Palette with authentic tonal elevation
    const primary = mix(validHex, '#000000', 0.08);
    const onPrimary = '#ffffff';
    const primaryContainer = mix(validHex, '#ffffff', 0.86);
    const onPrimaryContainer = mix(validHex, '#000000', 0.72);

    return {
      '--md-sys-color-primary': primary,
      '--md-sys-color-on-primary': onPrimary,
      '--md-sys-color-primary-container': primaryContainer,
      '--md-sys-color-on-primary-container': onPrimaryContainer,
      '--md-sys-color-secondary': mix(validHex, '#475569', 0.5),
      '--md-sys-color-secondary-container': '#e2e8f0',
      '--md-sys-color-on-secondary-container': '#1e293b',

      // M3 Surface Tonal Container Hierarchy
      '--md-sys-color-surface': '#f8fafc',
      '--md-sys-color-surface-dim': '#edf2f7',
      '--md-sys-color-surface-bright': '#ffffff',
      '--md-sys-color-surface-container-lowest': '#ffffff',
      '--md-sys-color-surface-container-low': '#f1f5f9',
      '--md-sys-color-surface-container': '#e8eef6',
      '--md-sys-color-surface-container-high': '#dfe5ee',
      '--md-sys-color-surface-container-highest': '#d5dbe5',

      '--md-sys-color-on-surface': '#0f172a',
      '--md-sys-color-on-surface-variant': '#64748b',
      '--md-sys-color-outline': 'rgba(100, 116, 139, 0.22)',
      '--md-sys-color-outline-variant': 'rgba(100, 116, 139, 0.12)',

      '--md-sys-color-error': '#dc2626',
      '--md-sys-color-error-container': '#fee2e2',
      '--md-sys-color-on-error': '#ffffff',
    };
  }
}

export function applyThemeTokensToDocument(tokens: Record<string, string>, isDark: boolean) {
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }

  Object.entries(tokens).forEach(([prop, val]) => {
    root.style.setProperty(prop, val);
  });
}
