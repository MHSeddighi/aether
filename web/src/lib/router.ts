import { MainSection } from '../context/WorkspaceContext';

export type BotView = 'overview' | 'studio';

export interface Route {
  section: MainSection | 'auth';
  botId?: string;
  botView?: BotView;
}

/**
 * Tiny hash router. The app is a static Vite bundle, so the URL is driven by
 * `location.hash`: `#/bots`, `#/bots/:id/overview`, `#/login`, ...
 */

const SECTIONS: MainSection[] = ['chat', 'bots', 'tools', 'knowledge', 'settings'];

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return { section: 'chat' };

  const head = parts[0];

  if (head === 'login' || head === 'signup') {
    return { section: 'auth' };
  }

  if (head === 'bots' && parts.length >= 2) {
    const view: BotView = parts[2] === 'studio' ? 'studio' : 'overview';
    return { section: 'bots', botId: parts[1], botView: view };
  }

  if (SECTIONS.includes(head as MainSection)) {
    return { section: head as MainSection };
  }

  return { section: 'chat' };
}

export function buildHash(route: Route): string {
  if (route.section === 'auth') return '#/login';

  if (route.section === 'bots' && route.botId) {
    return `#/bots/${route.botId}/${route.botView === 'studio' ? 'studio' : 'overview'}`;
  }

  return `#/${route.section}`;
}

export function readRoute(): Route {
  if (typeof window === 'undefined') return { section: 'chat' };
  return parseHash(window.location.hash);
}

export function writeRoute(route: Route, replace = false) {
  if (typeof window === 'undefined') return;
  const next = buildHash(route);
  if (window.location.hash === next) return;
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${next}`;
    window.history.replaceState(null, '', url);
  } else {
    window.location.hash = next;
  }
}