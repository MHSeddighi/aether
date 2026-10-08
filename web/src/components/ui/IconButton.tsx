import React from 'react';
import { Tooltip } from './Tooltip';

/**
 * A Material 3 icon button.
 *
 * The visible glyph is 16–18px, but the hit target is the 40px M3 minimum: a 24px box is below
 * the accessible touch-target floor and is the single most common way a "minimal" chat becomes
 * frustrating to use on a laptop trackpad or a phone.
 *
 * State layers come from the shared tokens rather than a bespoke hover colour per call site, so
 * every icon button in the product hovers, presses and disables identically.
 */
export const IconButton: React.FC<{
  /** Required. This is the accessible name; the tooltip is decoration on top of it. */
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** `filled` is the primary filled icon button; `tonal` and `standard` are the quiet variants. */
  variant?: 'standard' | 'tonal' | 'filled';
  /** Container sizes. `md` is the 40dp M3 standard; `sm` is the dense in-row variant. */
  size?: 'sm' | 'md';
  tooltipPlacement?: 'top' | 'bottom';
  testId?: string;
  className?: string;
}> = ({
  label,
  onClick,
  children,
  disabled,
  variant = 'standard',
  size = 'sm',
  tooltipPlacement,
  testId,
  className = '',
}) => {
  // Sizing lives here rather than in `className`: two competing `w-*` utilities would resolve by
  // stylesheet order, not by the order they appear here.
  const box = size === 'md' ? 'h-10 w-10' : 'h-8 w-8';

  const variantClass =
    variant === 'filled'
      ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 disabled:opacity-30'
      : variant === 'tonal'
        ? 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] hover:brightness-95 dark:hover:brightness-110'
        : 'text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-state-hover)] active:bg-[var(--md-sys-color-state-pressed)]';

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={`inline-flex ${box} shrink-0 cursor-pointer items-center justify-center rounded-full transition-[background-color,opacity] duration-100 disabled:pointer-events-none disabled:opacity-30 ${variantClass} ${className}`}
    >
      {children}
    </button>
  );

  // A tooltip around a disabled button would never be reachable, so it is skipped entirely.
  return disabled ? button : <Tooltip label={label} placement={tooltipPlacement}>{button}</Tooltip>;
};