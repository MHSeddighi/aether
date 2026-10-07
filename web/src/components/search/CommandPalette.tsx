import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import {
  Search,
  MessageSquare,
  Bot,
  Wrench,
  Database,
  ArrowRight,
  ArrowLeft,
  X,
} from 'lucide-react';

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    conversations,
    selectConversation,
    bots,
    openBotInStudio,
    setCurrentSection,
    tools,
    knowledge,
    t,
    isRTL,
  } = useWorkspace();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isCommandPaletteOpen]);

  interface SearchItem {
    id: string;
    category: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    action: () => void;
  }

  const items = useMemo<SearchItem[]>(() => {
    const list: SearchItem[] = [];

    // Chats
    conversations.forEach((c) => {
      list.push({
        id: `chat-${c.id}`,
        category: t.history,
        title: c.title,
        subtitle: `${c.messages.length} ${isRTL ? 'پیام' : 'messages'}`,
        icon: <MessageSquare className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />,
        action: () => {
          selectConversation(c.id);
        },
      });
    });

    // Bots
    bots.forEach((b) => {
      list.push({
        id: `bot-${b.id}`,
        category: t.bots,
        title: isRTL ? b.nameFa || b.name : b.name,
        subtitle: `${b.model} · ${b.toolIds.length} ${t.toolsCount}`,
        icon: <Bot className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />,
        action: () => {
          // Open the review page, not the editor
          openBotInStudio(b, 'overview');
        },
      });
    });

    // Tools
    tools.forEach((tl) => {
      list.push({
        id: `tool-${tl.id}`,
        category: t.tools,
        title: isRTL ? tl.nameFa || tl.name : tl.name,
        subtitle: tl.connectionState,
        icon: <Wrench className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />,
        action: () => {
          setCurrentSection('tools');
        },
      });
    });

    // Knowledge
    knowledge.forEach((kn) => {
      list.push({
        id: `kn-${kn.id}`,
        category: t.knowledge,
        title: isRTL ? kn.nameFa || kn.name : kn.name,
        subtitle: `${kn.sizeFormatted} · ${kn.chunksCount} ${t.chunksIndexed}`,
        icon: <Database className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)]" />,
        action: () => {
          setCurrentSection('knowledge');
        },
      });
    });

    return list;
  }, [conversations, bots, tools, knowledge, t, isRTL, selectConversation, openBotInStudio, setCurrentSection]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(lower) ||
        item.subtitle.toLowerCase().includes(lower) ||
        item.category.toLowerCase().includes(lower)
    );
  }, [items, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        setIsCommandPaletteOpen(false);
      }
    } else if (e.key === 'Escape') {
      setIsCommandPaletteOpen(false);
    }
  };

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="fixed inset-0"
        onClick={() => setIsCommandPaletteOpen(false)}
      />

      <div
        className="relative z-10 w-full max-w-xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline)] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh] animate-in zoom-in-95 duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="p-4 border-b border-[var(--md-sys-color-outline-variant)] flex items-center gap-3">
          <Search className="w-4 h-4 text-[var(--md-sys-color-on-surface-variant)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t.searchPlaceholder}
            className="w-full bg-transparent text-sm text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none"
            dir={isRTL ? 'rtl' : 'ltr'}
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
              ESC
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
              {isRTL ? 'موردی یافت نشد.' : 'No results found.'}
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.action();
                    setIsCommandPaletteOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between p-3 rounded-2xl text-xs transition-colors ${
                    isSelected
                      ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] font-medium'
                      : 'text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-[var(--md-sys-color-surface-container)] shrink-0 border border-[var(--md-sys-color-outline-variant)]">
                      {item.icon}
                    </div>
                    <div className="text-start min-w-0">
                      <span className="truncate block font-medium">
                        {item.title}
                      </span>
                      <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] block truncate font-mono">
                        {item.subtitle}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)]">
                      {item.category}
                    </span>
                    {isSelected && (
                      isRTL ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="p-2.5 bg-[var(--md-sys-color-surface-container-low)] border-t border-[var(--md-sys-color-outline-variant)] flex items-center justify-between text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)] px-4">
          <span>{filteredItems.length} {isRTL ? 'نتیجه' : 'items'}</span>
          <div className="flex items-center gap-3">
            <span>↑↓ {isRTL ? 'جابجایی' : 'Navigate'}</span>
            <span>↵ {isRTL ? 'انتخاب' : 'Select'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
