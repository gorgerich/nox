"use client";

import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * Confirmation for an action that destroys something.
 *
 * Replaces `window.confirm`, which rendered a browser chrome dialog in the
 * middle of a native-feeling app and could not be styled, trapped or themed.
 *
 * The destructive colour lives here and nowhere earlier in the flow: a red
 * panel sitting on the screen before the user has decided anything is an alarm
 * for something that has not happened. Red belongs on the button that does it.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Отмена",
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sheetRef = useFocusTrap<HTMLDivElement>(open, onCancel);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 p-3 animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        ref={sheetRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        className="w-full max-w-md space-y-2 pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom-4 duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overflow-hidden rounded-2xl bg-surface-elevated">
          <div className="px-5 py-4 text-center">
            <p id="confirm-sheet-title" className="text-[15px] font-semibold text-foreground">
              {title}
            </p>
            {body ? <p className="mt-1 text-[13px] leading-snug text-muted">{body}</p> : null}
          </div>
          <div className="h-px bg-border-subtle" />
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`h-[54px] w-full text-[17px] font-medium transition-smooth hover:bg-surface-hover active:bg-surface-hover disabled:opacity-45 ${
              destructive ? "text-danger" : "text-primary"
            }`}
          >
            {busy ? "Подождите…" : confirmLabel}
          </button>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="h-[54px] w-full rounded-2xl bg-surface-elevated text-[17px] font-semibold text-primary transition-smooth hover:bg-surface-hover active:bg-surface-hover"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
