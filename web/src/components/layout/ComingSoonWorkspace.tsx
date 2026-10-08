import React from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Clock } from 'lucide-react';

/**
 * Placeholder for a section the product has not built yet.
 *
 * It states the fact and stops there. Designing a half-built Tools or Knowledge destination now
 * would only create a second mental model to undo later.
 */
export const ComingSoonWorkspace: React.FC<{ feature: 'tools' | 'knowledge' }> = ({ feature }) => {
  const { t } = useWorkspace();
  const label = feature === 'tools' ? t.tools : t.knowledge;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Clock size={20} className="text-[var(--md-sys-color-on-surface-variant)]" />
      <p className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">{label}</p>
      <p className="max-w-xs text-xs leading-relaxed text-[var(--md-sys-color-on-surface-variant)]">
        {t.comingSoon}
      </p>
    </div>
  );
};