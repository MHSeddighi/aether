import React from 'react';

interface TechLoadingAnimationProps {
  variant?: 'circular' | 'linear' | 'dots' | 'equalizer' | 'orbital' | 'tokens' | 'quantum';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}

export const TechLoadingAnimation: React.FC<TechLoadingAnimationProps> = ({
  variant = 'circular',
  size = 'md',
  label,
  className = '',
}) => {
  // Dimension mapping
  const dim = size === 'sm' ? 16 : size === 'lg' ? 28 : 20;
  const strokeWidth = size === 'sm' ? 2.5 : size === 'lg' ? 3.5 : 3;

  // Linear Progress (M3 spec: 4px height, rounded ends)
  if (variant === 'linear') {
    return (
      <div className={`w-full space-y-1.5 ${className}`}>
        {label && (
          <div className="flex justify-between items-center text-xs text-[var(--md-sys-color-on-surface-variant)] font-medium">
            <span>{label}</span>
          </div>
        )}
        <div className="w-full h-1 bg-[var(--md-sys-color-surface-container-highest)] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--md-sys-color-primary)] rounded-full animate-[pulse_1.5s_ease-in-out_infinite] w-3/4" />
        </div>
      </div>
    );
  }

  // Dots / Typing Ellipsis (M3 calm pulse)
  if (variant === 'dots') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-bounce" />
        {label && <span className="text-xs text-[var(--md-sys-color-on-surface-variant)] ms-1">{label}</span>}
      </div>
    );
  }

  // Tokens / Status Chip (M3 Assist Chip with calm monochromatic spinner)
  if (variant === 'tokens') {
    return (
      <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] text-[11px] font-mono border border-[var(--md-sys-color-outline-variant)] ${className}`}>
        <svg
          className="animate-spin text-[var(--md-sys-color-primary)]"
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-90"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>{label || 'Generating...'}</span>
      </div>
    );
  }

  // Default: Google Material Design 3 Circular Progress (calm, monochromatic)
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        className="animate-spin text-[var(--md-sys-color-primary)] shrink-0"
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-20"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
        <path
          className="opacity-90"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {label && (
        <span className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-medium">
          {label}
        </span>
      )}
    </div>
  );
};
