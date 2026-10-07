import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { UnifiedSidebar } from '../navigation/UnifiedSidebar';
import { ChatWorkspace } from '../chat/ChatWorkspace';
import { BotsWorkspace } from '../bots/BotsWorkspace';
import { ToolsWorkspace } from '../tools/ToolsWorkspace';
import { KnowledgeWorkspace } from '../knowledge/KnowledgeWorkspace';
import { SettingsWorkspace } from '../settings/SettingsWorkspace';
import { CommandPalette } from '../search/CommandPalette';
import { AuthWorkspace } from '../auth/AuthWorkspace';

export const AppShell: React.FC = () => {
  const { currentSection, isRTL, isAuthenticated, isBooting } = useWorkspace();

  const renderSection = () => {
    switch (currentSection) {
      case 'chat':
        return <ChatWorkspace />;
      case 'bots':
        return <BotsWorkspace />;
      case 'tools':
        return <ToolsWorkspace />;
      case 'knowledge':
        return <KnowledgeWorkspace />;
      case 'settings':
        return <SettingsWorkspace />;
      default:
        return <ChatWorkspace />;
    }
  };

  if (isBooting) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <span className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
          Loading your workspace…
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className="h-screen w-screen overflow-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <AuthWorkspace />
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Primary Unified Navigation Sidebar */}
      <UnifiedSidebar />

      {/* Main Workspace Viewport (New Chat = Home) */}
      <main className="flex-1 h-full overflow-hidden relative">
        {renderSection()}
      </main>

      {/* Global Command Palette */}
      <CommandPalette />
    </div>
  );
};
