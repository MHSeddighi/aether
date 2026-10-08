import React, { useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  MessageSquarePlus,
  MessageSquare,
  LogOut,
  Bot,
  Wrench,
  Database,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
  Edit2,
  Clock,
  Sparkles,
} from 'lucide-react';
import { MainSection } from '../../context/WorkspaceContext';
import { MagicalAgentIcon } from '../ui/MagicalAgentIcon';

export const UnifiedSidebar: React.FC = () => {
  const navigate = useNavigate();
  const activeSection = useRouterState({
    select: (state) => state.location.pathname.split('/').filter(Boolean)[0] ?? 'chat',
  });

  const {
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isMobileDrawerOpen,
    setIsMobileDrawerOpen,
    conversations,
    activeConversationId,
    selectConversation,
    startNewChat,
    goToChat,
    deleteConversation,
    renameConversation,
    account,
    profile,
    signOut,
    setIsCommandPaletteOpen,
    t,
    isRTL,
  } = useWorkspace();

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'bots' | 'tools'>('all');
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  const showComingSoon = (label: string) => {
    setComingSoon(label);
    window.setTimeout(() => setComingSoon(null), 3000);
  };

  // Filter conversations across bot generations, tool generations, and chats
  const filteredConversations = conversations.filter((c) => {
    if (historyFilter === 'bots') return c.mode === 'agent-bot' || c.mode === 'simple-bot' || c.title.toLowerCase().includes('bot');
    if (historyFilter === 'tools') return c.mode === 'tool-building' || c.title.toLowerCase().includes('tool');
    return true;
  });

  // Group conversations by category
  const todayChats = filteredConversations.filter(
    (c) => c.category === 'today'
  );
  const pastChats = filteredConversations.filter(
    (c) => c.category !== 'today'
  );

  const handleNewConversation = () => {
    startNewChat();
    void navigate({ to: '/chat' });
  };

  const handleStartRename = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    setEditingChatId(id);
    setEditingTitle(title);
  };

  const handleSaveRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    if (editingTitle.trim()) {
      renameConversation(id, editingTitle.trim());
    }
    setEditingChatId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  };

  // Nav Item rendering adhering strictly to Material 3 (MUI v3) Navigation Rail & Drawer spec
  const renderNavDestination = (
    section: MainSection,
    label: string,
    Icon: React.ElementType,
    count?: number,
    options?: { disabled?: boolean }
  ) => {
    const isActive = activeSection === section;
    const disabled = options?.disabled ?? false;
    const activate = () => {
      if (disabled) {
        showComingSoon(label);
        return;
      }
      if (section === 'chat') goToChat();
      void navigate({ to: `/${section}` });
      setIsMobileDrawerOpen(false);
    };

    if (isSidebarCollapsed) {
      // Centered M3 Navigation Rail item with active pill indicator
      return (
        <button
          key={section}
          type="button"
          onClick={activate}
          aria-disabled={disabled}
          data-testid={`nav-${section}`}
          className={`w-full flex flex-col items-center justify-center py-1 group focus:outline-none ${
            disabled ? 'opacity-45 cursor-not-allowed' : ''
          }`}
          title={disabled ? `${label} · ${t.comingSoon}` : label}
        >
          <div
            className={`w-12 h-8 rounded-full flex items-center justify-center transition-colors ${
              isActive
                ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-semibold'
                : 'text-[var(--md-sys-color-on-surface-variant)] group-hover:text-[var(--md-sys-color-on-surface)] group-hover:bg-[var(--md-sys-color-surface-container-high)]'
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" />
          </div>
          <span
            className={`text-[10px] font-medium tracking-tight mt-1 text-center truncate max-w-[68px] ${
              isActive
                ? 'text-[var(--md-sys-color-on-surface)] font-semibold'
                : 'text-[var(--md-sys-color-on-surface-variant)]'
            }`}
          >
            {label}
          </span>
        </button>
      );
    }

    // Expanded M3 Navigation Drawer item
    return (
      <button
        key={section}
        type="button"
        onClick={activate}
        aria-disabled={disabled}
        data-testid={`nav-${section}`}
        className={`w-full h-11 flex items-center justify-between px-3 rounded-2xl text-xs font-medium transition-colors group focus:outline-none ${
          disabled
            ? 'opacity-45 cursor-not-allowed text-[var(--md-sys-color-on-surface-variant)]'
            : isActive
            ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-semibold'
            : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`w-5 h-5 shrink-0 transition-colors ${
              isActive && !disabled
                ? 'text-[var(--md-sys-color-on-secondary-container)]'
                : 'text-[var(--md-sys-color-on-surface-variant)] group-hover:text-[var(--md-sys-color-on-surface)]'
            }`}
          />
          <span className="truncate text-xs">{label}</span>
        </div>
        {disabled ? (
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
            {t.comingSoon}
          </span>
        ) : (
          count !== undefined && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
              {count}
            </span>
          )
        )}
      </button>
    );
  };

  const sidebarContent = (
    <div
      className={`flex flex-col h-full justify-between select-none overflow-hidden ${
        isSidebarCollapsed ? 'px-2 py-3 items-center' : 'p-3'
      }`}
    >
      {/* Top Block: Product brand + destinations */}
      <div className={`shrink-0 w-full ${isSidebarCollapsed ? 'space-y-4' : 'space-y-3'}`}>
        {/* Product Brand Row — amber into blue, and the brand is the way home. */}
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center justify-center pt-1">
            <button
              type="button"
              onClick={() => navigate({ to: '/chat' })}
              className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-amber-500/25 transition-transform hover:scale-105"
              title={t.appName}
              aria-label={t.appName}
            >
              <Sparkles className="w-5 h-5 fill-white/25 stroke-[2.2]" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1.5">
            <button
              type="button"
              onClick={() => navigate({ to: '/chat' })}
              className="flex items-center gap-2.5 min-w-0 text-start"
            >
              <span className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-blue-600 flex items-center justify-center text-white shrink-0 shadow-md shadow-amber-500/25">
                <Sparkles className="w-4 h-4 fill-white/25 stroke-[2.2]" />
              </span>
              <span className="text-xs font-bold text-[var(--md-sys-color-on-surface)] truncate tracking-tight">
                {t.appName}
              </span>
            </button>

            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="p-1.5 rounded-lg text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors flex items-center gap-1 text-[10px] font-mono"
              title="Search (⌘K)"
            >
              <Search className="w-4 h-4" />
              <kbd className="px-1 py-0.5 rounded bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[9px] opacity-75">
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {/* Primary Destinations conforming to MUI v3 */}
        <nav className={`w-full ${isSidebarCollapsed ? 'space-y-1.5 pt-1' : 'space-y-1 pt-1'}`}>
          {isSidebarCollapsed && (
            <button
              type="button"
              onClick={handleNewConversation}
              data-testid="new-chat"
              className="w-full flex flex-col items-center justify-center py-1 group focus:outline-none"
              title={t.newConversation}
            >
              <div className="w-12 h-8 rounded-full flex items-center justify-center text-[var(--md-sys-color-on-surface-variant)] group-hover:text-[var(--md-sys-color-on-surface)] group-hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors">
                <MessageSquarePlus className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-medium tracking-tight mt-1 text-center truncate max-w-[68px]">
                {t.newConversation}
              </span>
            </button>
          )}
          {renderNavDestination('chat', t.chat, MessageSquare)}
          {renderNavDestination('bots', t.bots, Bot)}
          {renderNavDestination('tools', t.tools, Wrench, undefined, { disabled: true })}
          {renderNavDestination('knowledge', t.knowledge, Database, undefined, { disabled: true })}
        </nav>
      </div>

      {/* Middle Block: Conversation History (Only in expanded drawer mode) */}
      {!isSidebarCollapsed && (
        <div className="flex-1 overflow-y-auto py-2 my-1 border-t border-[var(--md-sys-color-outline-variant)] space-y-2">
          {/* History header doubles as the New Conversation action: one quiet row
              instead of a primary button stacked above the section list. */}
          <div className="flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] opacity-80">
            <span>
              {t.history} <span className="text-[9px]">{filteredConversations.length}</span>
            </span>
            <button
              type="button"
              onClick={handleNewConversation}
              data-testid="new-chat"
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-sans font-semibold normal-case tracking-normal text-[var(--md-sys-color-on-surface)] bg-[var(--md-sys-color-surface-container-high)] hover:bg-[var(--md-sys-color-surface-container-highest)] transition-colors"
              title={t.newConversation}
            >
              <MessageSquarePlus className="w-3 h-3 stroke-[2.2]" />
              <span>{t.newConversation}</span>
            </button>
          </div>

          {/* Category Filter Pills: All / Bots / Tools */}
          <div className="px-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {(['all', 'bots', 'tools'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setHistoryFilter(cat)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-medium capitalize transition-colors shrink-0 ${
                  historyFilter === cat
                    ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-semibold'
                    : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)]'
                }`}
              >
                {cat === 'all' ? t.all : cat === 'bots' ? t.bots : t.tools}
              </button>
            ))}
          </div>

          {filteredConversations.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
              {t.emptyHistory}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Today */}
              {todayChats.length > 0 && (
                <div className="space-y-0.5">
                  <span className="px-2 text-[10px] font-medium text-[var(--md-sys-color-on-surface-variant)] opacity-70">
                    {t.today}
                  </span>
                  {todayChats.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => selectConversation(conv.id)}
                      data-testid="conversation-item"
                      data-conversation-id={conv.id}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        activeConversationId === conv.id && activeSection === 'chat'
                          ? 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-medium shadow-2xs'
                          : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)] hover:text-[var(--md-sys-color-on-surface)]'
                      }`}
                    >
                      {editingChatId === conv.id ? (
                        <form
                          onSubmit={(e) => handleSaveRename(e, conv.id)}
                          className="w-full flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={() => setEditingChatId(null)}
                            autoFocus
                            data-testid="conversation-rename-input"
                            className="w-full bg-[var(--md-sys-color-surface-container-highest)] px-1.5 py-0.5 rounded text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none"
                          />
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 min-w-0 pr-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-outline)] shrink-0 opacity-70" />
                            <span className="truncate">{conv.title}</span>
                          </div>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
                            <button
                              onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                              className="p-1 rounded hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]"
                              title={t.rename}
                            >
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => handleDelete(e, conv.id)}
                              data-testid="conversation-delete"
                              className="p-1 rounded hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-error)]"
                              title={t.delete}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Earlier */}
              {pastChats.length > 0 && (
                <div className="space-y-0.5">
                  <span className="px-2 text-[10px] font-medium text-[var(--md-sys-color-on-surface-variant)] opacity-70">
                    {t.previous7Days}
                  </span>
                  {pastChats.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => selectConversation(conv.id)}
                      data-testid="conversation-item"
                      data-conversation-id={conv.id}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        activeConversationId === conv.id && activeSection === 'chat'
                          ? 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] font-medium shadow-2xs'
                          : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container)] hover:text-[var(--md-sys-color-on-surface)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-outline)] shrink-0 opacity-40" />
                        <span className="truncate">{conv.title}</span>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity shrink-0">
                        <button
                          onClick={(e) => handleDelete(e, conv.id)}
                          data-testid="conversation-delete"
                          className="p-1 rounded hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-error)]"
                          title={t.delete}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bottom Block: Settings, User Profile & Collapse Toggle */}
      <div
        className={`w-full shrink-0 border-t border-[var(--md-sys-color-outline-variant)] ${
          isSidebarCollapsed ? 'pt-3 space-y-3 flex flex-col items-center' : 'pt-2 space-y-1'
        }`}
      >
        {renderNavDestination(
          'settings',
          t.settings,
          Settings
        )}

        {/* The signed-in account: initials, name, email and live plan — all read
            from the session, never hard-coded. */}
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 pt-1 w-full">
            <button
              type="button"
              onClick={() => navigate({ to: '/settings' })}
              className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-blue-600 text-white flex items-center justify-center font-bold text-[11px] shadow-sm"
              title={`${profile.name} (${profile.email})`}
              data-testid="profile-avatar"
            >
              {profile.initials}
            </button>

            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors"
              title={t.expandSidebar}
            >
              {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1 px-1 gap-1">
            <button
              type="button"
              onClick={() => navigate({ to: '/settings' })}
              className="flex items-center gap-2.5 text-xs text-[var(--md-sys-color-on-surface)] min-w-0 flex-1 text-start rounded-lg px-1 py-1 -mx-1 hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors"
              data-testid="profile"
              title={t.account}
            >
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 via-orange-500 to-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm">
                {profile.initials}
              </span>
              <span className="min-w-0">
                <span className="truncate block font-medium max-w-[110px]" data-testid="profile-name">
                  {profile.name}
                </span>
                <span
                  className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] block truncate max-w-[110px]"
                  data-testid="profile-email"
                >
                  {profile.email}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={signOut}
              className="p-1.5 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-error)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors shrink-0"
              title={t.authSignOut}
              data-testid="sidebar-sign-out"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors shrink-0"
              title={t.collapseSidebar}
            >
              {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop / Tablet Sidebar (w-20 when collapsed = 80px M3 spec, w-64 when expanded = 256px M3 spec) */}
      <aside
        className={`hidden md:block shrink-0 h-screen transition-all duration-200 border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] ${
          isRTL ? 'border-l' : 'border-r'
        } ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Navigation Drawer */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs animate-in fade-in"
            onClick={() => setIsMobileDrawerOpen(false)}
          />
          <div
            className={`relative z-10 w-72 h-full bg-[var(--md-sys-color-surface-container-low)] shadow-2xl animate-in ${
              isRTL ? 'slide-in-from-right mr-auto' : 'slide-in-from-left ml-auto'
            }`}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* "Coming soon" toast for disabled destinations */}
      {comingSoon && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl bg-[var(--md-sys-color-inverse-surface,#1e232e)] text-[var(--md-sys-color-inverse-on-surface,#f1f5f9)] text-xs font-medium shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>
            {comingSoon} · {t.comingSoon}
          </span>
        </div>
      )}
    </>
  );
};
