/**
 * The route tree, built with TanStack Router.
 *
 * URLs are real paths (`/bots/<id>/studio`), served by the browser history API.
 * The host must therefore rewrite unknown paths to `index.html`; the Vite dev
 * server and `vite preview` both do, so deep links work in dev and in preview.
 *
 * Every workspace route runs behind `requireSession()`, and the bot routes
 * resolve the bot through the query cache before rendering. Loaders and the
 * workspace provider share one TanStack Query cache, so a deep link such as
 * `/bots/<id>/studio` never renders against an empty store: the loader primes
 * the cache and the provider renders straight from it.
 */

import React from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  createBrowserHistory,
  Outlet,
  Link,
  redirect,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { queryClient, fetchBots, fetchBot, fetchSession, queryKeys } from './lib/queries';
import { useWorkspace } from './context/WorkspaceContext';
import { AppShell } from './components/layout/AppShell';
import { AuthWorkspace } from './components/auth/AuthWorkspace';
import { ChatWorkspace } from './components/chat/ChatWorkspace';
import { BotsWorkspace } from './components/bots/BotsWorkspace';
import { SettingsWorkspace } from './components/settings/SettingsWorkspace';
import { ComingSoonWorkspace } from './components/layout/ComingSoonWorkspace';

/**
 * Resolves the session through the query cache and redirects anonymous visitors.
 * `ensureQueryData` dedupes concurrent loaders, so several matching routes only
 * ever make one request.
 */
async function requireSession() {
  const session = await queryClient.ensureQueryData({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
  });
  if (!session) throw redirect({ to: '/login' });
  return session;
}

const rootRoute = createRootRoute({
  component: () => (
    <WorkspaceProvider>
      <Outlet />
    </WorkspaceProvider>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: AuthScreen,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  component: AuthScreen,
});

/** The shell (sidebar + viewport) wraps every authenticated page. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  beforeLoad: () => requireSession(),
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat' });
  },
});

const chatRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/chat',
  component: ChatWorkspace,
});

const botsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bots',
  component: () => <BotsWorkspace view="list" />,
  // Entering the catalog always revalidates: bots can be created through the API
  // while the app is open, and the provider's observer never unmounts to refetch.
  loader: () =>
    // `staleTime: 0` makes this a revalidation: the loader awaits the fresh list,
    // so the catalog never renders a stale one.
    queryClient.fetchQuery({
      queryKey: queryKeys.bots,
      queryFn: fetchBots,
      staleTime: 0,
    }),
});

/** Shared parent for the two bot pages: resolves the bot before either renders. */
const botRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bots/$botId',
  component: Outlet,
  errorComponent: RouteError,
  loader: async ({ params }) => {
    await requireSession();
    const bot = await fetchBot(params.botId);
    if (!bot) throw redirect({ to: '/bots' });
    queryClient.setQueryData(queryKeys.bot(bot.id), bot);
    return { botId: bot.id, botName: bot.name };
  },
});

const botOverviewRoute = createRoute({
  getParentRoute: () => botRoute,
  path: 'overview',
  component: () => <BotsWorkspace view="overview" />,
});

const botStudioRoute = createRoute({
  getParentRoute: () => botRoute,
  path: 'studio',
  component: () => <BotsWorkspace view="studio" />,
});

const toolsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tools',
  component: function ToolsRoute() {
    return <ComingSoonWorkspace feature="tools" />;
  },
});

const knowledgeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/knowledge',
  component: function KnowledgeRoute() {
    return <ComingSoonWorkspace feature="knowledge" />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsWorkspace,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  appRoute.addChildren([
    indexRoute,
    chatRoute,
    botsRoute,
    botRoute.addChildren([botOverviewRoute, botStudioRoute]),
    toolsRoute,
    knowledgeRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  defaultPreload: 'intent',
  defaultNotFoundComponent: NotFound,
  context: { queryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Shown when a loader fails for a reason we cannot resolve by navigating away. */
function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useWorkspace();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">{t.somethingWentWrong}</p>
      <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] max-w-sm leading-relaxed">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        type="button"
        onClick={reset}
        className="h-9 px-4 rounded-lg bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-xs font-semibold hover:opacity-90 transition-opacity"
      >
        {t.retry}
      </button>
    </div>
  );
}

function NotFound() {
  const { t } = useWorkspace();
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]">
      <p className="text-sm font-semibold">{t.pageNotFound}</p>
      <Link to="/chat" className="text-xs underline">
        {t.backToChat}
      </Link>
    </div>
  );
}

function AuthScreen() {
  const { isAuthenticated, isRTL } = useWorkspace();

  React.useEffect(() => {
    if (isAuthenticated) void router.navigate({ to: '/chat', replace: true });
  }, [isAuthenticated]);

  // Full viewport and scrollable: the sign-up form is taller than a laptop screen.
  return (
    <div
      className="h-screen w-screen overflow-y-auto overflow-x-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AuthWorkspace />
    </div>
  );
}