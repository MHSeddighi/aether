import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';

interface M3SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Google Material 3 Switch Component
 * Compact, responsive switch sized proportionally to adjacent badges and inputs.
 * - 'sm' (default): 20px height, 36px width, thumb 14px/10px (matches adjacent element heights)
 * - 'md': 24px height, 44px width, thumb 18px/14px
 */
export const M3Switch: React.FC<M3SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
  size = 'sm',
  className = '',
}) => {
  const { isRTL } = useWorkspace();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  const isSm = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex items-center shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--md-sys-color-primary)] select-none ${
        isSm ? 'h-4.5 w-8' : 'h-5.5 w-10'
      } ${
        checked
          ? 'bg-[var(--md-sys-color-primary)] border-[var(--md-sys-color-primary)]'
          : 'bg-[var(--md-sys-color-surface-container-highest)] border-[var(--md-sys-color-outline)]'
      } ${className}`}
    >
      {/* Handle / Thumb */}
      <span
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-all duration-200 ease-in-out ${
          isSm
            ? checked
              ? 'w-3 h-3 bg-[var(--md-sys-color-on-primary)] shadow-xs'
              : 'w-2 h-2 bg-[var(--md-sys-color-outline)]'
            : checked
            ? 'w-4 h-4 bg-[var(--md-sys-color-on-primary)] shadow-xs'
            : 'w-3 h-3 bg-[var(--md-sys-color-outline)]'
        }`}
        style={{
          [isRTL ? 'right' : 'left']: isSm
            ? checked
              ? '16px'
              : '2.5px'
            : checked
            ? '20px'
              : '3px',
        }}
      >
        {checked && (
          <svg
            className={`${isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'} text-[var(--md-sys-color-primary)] block shrink-0`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
    </button>
  );
};
