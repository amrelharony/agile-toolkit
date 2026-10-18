import { toast } from "@/lib/utils/toast";

export interface UndoableAction {
  /** What happened, past tense: "Deleted “Late standups”", "Cleared 12 cards". */
  label: string;
  description?: string;
  /** Perform the change. */
  apply: () => void;
  /** Put things back exactly as they were before `apply`. */
  revert: () => void;
  /** How long the Undo button stays available (default 8 s). */
  durationMs?: number;
}

/**
 * Run a destructive change and offer Undo in a toast.
 *
 * Most deletes in the tools were instant and permanent, and only three tools
 * had any undo. Capture whatever `revert` needs before calling (the deleted
 * item, the previous list) — this helper only sequences the calls and the
 * toast. Undo works once; a second click is ignored.
 *
 *   const card = cards.find((c) => c.id === id)!;
 *   undoable({
 *     label: `Deleted “${card.text}”`,
 *     apply: () => removeCard(id),
 *     revert: () => restoreCard(card),
 *   });
 */
export function undoable({ label, description, apply, revert, durationMs = 8000 }: UndoableAction) {
  apply();
  let undone = false;
  return toast(label, {
    description,
    duration: durationMs,
    action: {
      label: "Undo",
      onClick: () => {
        if (undone) return;
        undone = true;
        revert();
      },
    },
  });
}
