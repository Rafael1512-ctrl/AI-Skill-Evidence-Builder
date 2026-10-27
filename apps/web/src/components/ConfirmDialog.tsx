import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Confirm button label, e.g. "Lanjutkan". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Shown while the confirmed action is running; also disables both buttons. */
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/**
 * The shared confirmation modal.
 *
 * Used before any action that spends credits, so the price and the resulting balance are read
 * once more before the user commits. It is deliberately small: a labelled dialog, an explicit
 * cancel, and an Escape-to-cancel that is disabled while the action is in flight.
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = 'Batal',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onCancel();
    }

    document.addEventListener('keydown', handleKeyDown);
    confirmRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>

        {children ? <div className="mt-2 flex flex-col gap-2 text-sm">{children}</div> : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
