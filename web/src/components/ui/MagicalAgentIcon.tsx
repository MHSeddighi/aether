import React from 'react';

interface MagicalAgentIconProps {
  className?: string;
  size?: number;
  glow?: boolean;
  isThinking?: boolean;
}

/**
 * Distinctive, modern AI Agent Emblem adhering to Google Material 3 principles.
 * Refined, calm, monochromatic, dynamically tinted with currentColor or M3 system tokens.
 */
export const MagicalAgentIcon: React.FC<MagicalAgentIconProps> = ({
  className = '',
  size = 20,
  glow = false,
  isThinking = false,
}) => {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {glow && (
        <div
          className={`absolute inset-0 rounded-full blur-xs opacity-25 bg-[var(--md-sys-color-primary)] transition-all ${
            isThinking ? 'scale-125 animate-pulse' : 'scale-100'
          }`}
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`relative z-10 transition-transform ${
          isThinking ? 'animate-spin' : ''
        }`}
        style={isThinking ? { animationDuration: '4s' } : undefined}
      >
        {/* Modern 4-point geometric spark / agent prism */}
        <path
          d="M12 2C12.8 7.2 16.8 11.2 22 12C16.8 12.8 12.8 16.8 12 22C11.2 16.8 7.2 12.8 2 12C7.2 11.2 11.2 7.2 12 2Z"
          fill="currentColor"
          className="opacity-95"
        />

        {/* Central luminous core */}
        <circle cx="12" cy="12" r="2.5" fill="var(--md-sys-color-surface)" className="opacity-90" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      </svg>
    </div>
  );
};
