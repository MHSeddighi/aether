import { useState } from 'react';
import { Check, ChevronRight, TriangleAlert } from 'lucide-react';
import { useWorkspace } from '../../context/WorkspaceContext';
import type { ProgressStep } from './stages';

/**
 * What the bot builder is doing, in the user's terms.
 *
 * Two rules shape this. First, only real work appears: the list is built from run events, so a stage
 * is present because something started, not because a placeholder was rendered. Second, it stays out
 * of the way — no spinner, no card, no diagram. Three quarters of a second of "Creating
 * instructions" is enough to know the system is working; more than that is decoration.
 *
 * Completion collapses rather than disappearing, because "what did it just do" is a real question
 * and one click should answer it.
 */
export const BuildActivity: React.FC<{ steps: ProgressStep[]; running: boolean }> = ({
  steps,
  running,
}) => {
  const { t } = useWorkspace();
  const [open, setOpen] = useState(false);

  if (steps.length === 0) return null;

  const failed = steps.find((step) => step.status === 'failed');
  const done = steps.filter((step) => step.status === 'done').length;
  const active = steps.find((step) => step.status === 'running');

  // While work is happening the list is open: the point of the list is watching it happen. Once the
  // turn is over it folds into one line, because at that point the answer is what matters.
  if (!running && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="activity-details"
        className="mt-1.5 flex cursor-pointer items-center gap-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:text-[var(--md-sys-color-on-surface)]"
      >
        <ChevronRight size={11} />
        {t.detailsLabel}
        <span className="text-[var(--md-sys-color-outline)]">·</span>
        {failed ? t.stepFailed : `${done}/${steps.length}`}
      </button>
    );
  }

  return (
    <div className="mt-1.5" data-testid="build-activity">
      <ul className="space-y-0.5">
        {steps.map((step) => (
          <li
            key={step.id}
            data-status={step.status}
            className={`flex items-center gap-1.5 text-[11.5px] leading-5 ${
              step.status === 'running'
                ? 'text-[var(--md-sys-color-on-surface)]'
                : step.status === 'failed'
                  ? 'text-[var(--md-sys-color-error)]'
                  : 'text-[var(--md-sys-color-on-surface-variant)]'
            }`}
          >
            {step.status === 'done' ? (
              <Check size={11} className="shrink-0 text-[var(--md-sys-color-primary)]" aria-hidden="true" />
            ) : step.status === 'failed' ? (
              <TriangleAlert size={11} className="shrink-0 text-[var(--md-sys-color-error)]" aria-hidden="true" />
            ) : (
              // One breathing dot. `motion-reduce` removes the animation entirely rather than
              // replacing it with something else to look at.
              <span
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--md-sys-color-primary)] motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            <span>{step.status === 'failed' ? `${step.label} — ${t.stepFailed}` : step.label}</span>
          </li>
        ))}
      </ul>

      {!running && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-1 flex cursor-pointer items-center gap-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)] transition-colors hover:text-[var(--md-sys-color-on-surface)]"
        >
          <ChevronRight size={11} className="rotate-90" />
          {t.detailsLabel}
        </button>
      )}

      {/* Announced as a polite status so a screen reader hears the activity change without being
          interrupted on every single step. */}
      <span className="sr-only" role="status" aria-live="polite">
        {active ? active.label : ''}
      </span>
    </div>
  );
};