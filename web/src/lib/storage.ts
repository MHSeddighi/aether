const PREFIX = 'aetheris:';

export const STORAGE_KEYS = {
  themeMode: `${PREFIX}themeMode`,
  themePresetId: `${PREFIX}themePresetId`,
  customPrimaryColor: `${PREFIX}customPrimaryColor`,
  locale: `${PREFIX}locale`,
  sidebarCollapsed: `${PREFIX}sidebarCollapsed`,
  bots: `${PREFIX}bots`,
  tools: `${PREFIX}tools`,
  knowledge: `${PREFIX}knowledge`,
  conversations: `${PREFIX}conversations`,
  selectedBotId: `${PREFIX}selectedBotId`,
  session: `${PREFIX}session`,
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or private mode: settings simply do not persist.
  }
}

export function removeStorage(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}