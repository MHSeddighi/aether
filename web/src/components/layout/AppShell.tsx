import React from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useWorkspace } from '../../context/WorkspaceContext';
import { UnifiedSidebar } from '../navigation/UnifiedSidebar';
import { CommandPalette } from '../search/CommandPalette';
import { ChatWorkspace } from '../chat/ChatWorkspace';

/**
 * Layout for every authenticated page: the routed viewport and the global command palette.
 *
 * The Bot Builder is the exception. Its workspace *is* the conversation, so it renders on its own —
 * no sidebar, no header, nothing between the user and the thread. The rest of the product still
 * navigates through the sidebar, because those pages are surfaces that need one.
 *
 * Which page renders inside the viewport is the router's decision; this only decides whether the
 * chat needs app chrome around it, and it answers that by asking the router where it is.
 */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isRTL } = useWorkspace();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const isChat = pathname === '/chat' || pathname === '/';

  if (isChat) {
    return (
      <div
        className="h-screen w-screen overflow-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <ChatWorkspace />
        <CommandPalette />
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <UnifiedSidebar />

      <main className="relative h-full flex-1 overflow-hidden">{children}</main>

      <CommandPalette />
    </div>
  );
};