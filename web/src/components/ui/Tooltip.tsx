import React, { useState } from 'react';

/**
 * A Material 3 tooltip.
 *
 * Two details matter here and neither is free with a native `title`:
 *
 * - It opens on **focus** as well as hover, so the label reaches keyboard users. A `title`
 *   attribute does not.
 * - The caller still supplies the accessible name via `aria-label`; this is the visual
 *   reinforcement, exactly as MUI's `Tooltip` behaves alongside a labelled `IconButton`.
 */
export const Tooltip: React.FC<{
  label: string;
  children: React.ReactElement;
  placement?: 'top' | 'bottom';
}> = ({ label, children, placement = 'top' }) => {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={`pointer-events-none absolute start-1/2 z-50 w-max max-w-[16rem] -translate-x-1/2 rtl:translate-x-1/2 rounded-md bg-[var(--md-sys-color-on-surface)] px-2 py-1 text-[11px] leading-4 font-medium text-[var(--md-sys-color-surface)] opacity-0 transition-opacity duration-150 ${
          placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        } ${open ? 'opacity-100' : ''}`}
      >
        {label}
      </span>
    </span>
  );
};