import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';

/** A Material 3 menu item. `selected` renders the leading check and is announced as current. */
export const MenuItem: React.FC<{
  label: string;
  /** Optional so an entry can advertise a capability that does not exist yet. */
  onClick?: () => void;
  icon?: React.ReactNode;
  selected?: boolean;
  /** Inert entries advertise future capability instead of pretending to work today. */
  disabled?: boolean;
  supporting?: string;
  testId?: string;
}> = ({ label, onClick, icon, selected, disabled, supporting, testId }) => (
  <div
    role="menuitem"
    aria-disabled={disabled || undefined}
    aria-current={selected || undefined}
    tabIndex={-1}
    data-testid={testId}
    onClick={() => !disabled && onClick?.()}
    className={`flex min-h-8 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] leading-5 select-none ${
      disabled
        ? 'cursor-default text-[var(--md-sys-color-on-surface-variant)] opacity-60'
        : 'text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-state-hover)] active:bg-[var(--md-sys-color-state-pressed)]'
    }`}
  >
    {selected ? <Check size={14} className="shrink-0 text-[var(--md-sys-color-primary)]" /> : icon ? (
      <span className="flex w-3.5 shrink-0 justify-center text-[var(--md-sys-color-on-surface-variant)]">
        {icon}
      </span>
    ) : (
      <span className="w-3.5 shrink-0" />
    )}
    <span className="flex-1 truncate">{label}</span>
    {supporting && (
      <span className="shrink-0 text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{supporting}</span>
    )}
  </div>
);

/**
 * A Material 3 menu anchored to its trigger.
 *
 * Escape closes it, so the menu never traps a keyboard user, and the roving focus lands on the
 * first item on open — a menu the keyboard cannot reach is not a menu.
 */
export const Menu: React.FC<{
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  label: string;
  align?: 'start' | 'end';
  width?: number;
}> = ({ open, anchorRef, onClose, children, label, align = 'start', width = 200 }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? []
      );
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
      items[(next + items.length) % items.length].focus();
    };

    const onPointerDown = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      style={{ width }}
      className={`absolute top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] py-1 shadow-[0_2px_8px_rgba(0,0,0,0.14)] ${
        align === 'end' ? 'end-0' : 'start-0'
      }`}
    >
      {children}
    </div>
  );
};