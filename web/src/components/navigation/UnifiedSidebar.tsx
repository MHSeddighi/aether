import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  MessageSquarePlus,
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
  const {
    currentSection,
    setCurrentSection,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isMobileDrawerOpen,
    setIsMobileDrawerOpen,
    conversations,
    activeConversationId,
    selectConversation,
    startNewChat,
    deleteConversation,
    renameConversation,
    account,
    setIsCommandPaletteOpen,
    t,
    isRTL,
  } = useWorkspace();

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'bots' | 'tools' | 'chat'>('all');

  // Filter conversations across bot generations, tool generations, and chats
  const filteredConversations = conversations.filter((c) => {
    if (historyFilter === 'bots') return c.mode === 'agent-bot' || c.mode === 'simple-bot' || c.title.toLowerCase().includes('bot');
    if (historyFilter === 'tools') return c.mode === 'tool-building' || c.title.toLowerCase().includes('tool');
    if (historyFilter === 'chat') return !c.mode || (!c.title.toLowerCase().includes('bot') && !c.title.toLowerCase().includes('tool'));
    return true;
  });

  // Group conversations by category
  const todayChats = filteredConversations.filter(
    (c) => c.category === 'today'
  );
  const pastChats = filteredConversations.filter(
    (c) => c.category !== 'today'
  );

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
    count?: number
  ) => {
    const isActive = currentSection === section;

    if (isSidebarCollapsed) {
      // Centered M3 Navigation Rail item with active pill indicator
      return (
        <button
          key={section}
          type="button"
          onClick={() => {
            setCurrentSection(section);
            setIsMobileDrawerOpen(false);
          }}
          className="w-full flex flex-col items-center justify-center py-1 group focus:outline-none"
          title={label}
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
        onClick={() => {
          setCurrentSection(section);
          setIsMobileDrawerOpen(false);
        }}
        className={`w-full h-11 flex items-center justify-between px-3 rounded-2xl text-xs font-medium transition-colors group focus:outline-none ${
          isActive
            ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-semibold'
            : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`w-5 h-5 shrink-0 transition-colors ${
              isActive
                ? 'text-[var(--md-sys-color-on-secondary-container)]'
                : 'text-[var(--md-sys-color-on-surface-variant)] group-hover:text-[var(--md-sys-color-on-surface)]'
            }`}
          />
          <span className="truncate text-xs">{label}</span>
        </div>
        {count !== undefined && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
            {count}
          </span>
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
      {/* Top Block: Product Brand Name & Icon + New Chat + Destinations */}
      <div className={`shrink-0 w-full ${isSidebarCollapsed ? 'space-y-4' : 'space-y-3'}`}>
        {/* Product Brand Row (Distinctive vibrant logo icon) */}
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center justify-center pt-1">
            <div
              className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#FF512F] via-[#DD2476] to-[#405DE6] flex items-center justify-center text-white shadow-md shadow-pink-500/20"
              title="Aetheris Studio"
            >
              <Sparkles className="w-5 h-5 fill-white/20 stroke-[2.2]" />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-[#FF512F] via-[#DD2476] to-[#405DE6] flex items-center justify-center text-white shrink-0 shadow-md shadow-pink-500/20">
                <Sparkles className="w-4 h-4 fill-white/20 stroke-[2.2]" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-[var(--md-sys-color-on-surface)] block truncate tracking-tight">
                  {t.appName || 'Aetheris Studio'}
                </span>
              </div>
            </div>

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

        {/* ＋ New Chat Button: Standard Material 3 Prominent Button */}
        {isSidebarCollapsed ? (
          <div className="flex justify-center w-full">
            <button
              type="button"
              onClick={() => startNewChat()}
              className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] flex items-center justify-center shadow-sm hover:opacity-95 transition-all active:scale-95"
              title={t.newChat}
            >
              <MessageSquarePlus className="w-5 h-5 stroke-[2.2]" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startNewChat()}
            className="w-full h-11 flex items-center justify-center gap-2 px-4 rounded-2xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-medium text-xs shadow-sm hover:opacity-95 transition-all active:scale-98"
          >
            <MessageSquarePlus className="w-4 h-4 stroke-[2.2]" />
            <span className="font-semibold">{t.newChat}</span>
          </button>
        )}

        {/* Primary Destinations conforming to MUI v3 */}
        <nav className={`w-full ${isSidebarCollapsed ? 'space-y-1.5 pt-1' : 'space-y-1 pt-1'}`}>
          {renderNavDestination('bots', t.bots, Bot)}
          {renderNavDestination('tools', t.tools, Wrench)}
          {renderNavDestination('knowledge', t.knowledge, Database)}
        </nav>
      </div>

      {/* Middle Block: Conversation History (Only in expanded drawer mode) */}
      {!isSidebarCollapsed && (
        <div className="flex-1 overflow-y-auto py-2 my-1 border-t border-[var(--md-sys-color-outline-variant)] space-y-2">
          <div className="flex items-center justify-between px-2 text-[10px] font-mono uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] opacity-80">
            <span>{t.history}</span>
            <span className="text-[9px]">{filteredConversations.length}</span>
          </div>

          {/* Category Filter Pills: All / Bots / Tools / Chat */}
          <div className="px-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {(['all', 'bots', 'tools', 'chat'] as const).map((cat) => (
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
                {cat === 'all' ? t.all : cat === 'bots' ? t.bots : cat === 'tools' ? t.tools : 'Chat'}
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
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        activeConversationId === conv.id && currentSection === 'chat'
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
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        activeConversationId === conv.id && currentSection === 'chat'
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

        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 pt-1 w-full">
            {/* Centered User Initials */}
            {/* Profile Avatar with vibrant gradient */}
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-white flex items-center justify-center font-bold text-[11px] shadow-sm"
              title="Alex Mercer (alex.mercer@agency.dev)"
            >
              AM
            </div>

            {/* Centered Collapse Toggle Button */}
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
          <div className="flex items-center justify-between pt-1 px-1">
            <div className="flex items-center gap-2.5 text-xs text-[var(--md-sys-color-on-surface)] min-w-0">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-white flex items-center justify-center font-bold text-[10px] shrink-0 shadow-sm">
                AM
              </div>
              <div className="min-w-0">
                <span className="truncate block font-medium max-w-[120px]">Alex Mercer</span>
                <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] block truncate max-w-[120px]">
                  alex.mercer@agency.dev
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)] transition-colors"
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
    </>
  );
};
