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
  const id = toast(label, {
    description,
    duration: durationMs,
    onDismiss: () => openUndoToasts.delete(id),
    onAutoClose: () => openUndoToasts.delete(id),
    action: {
      label: "Undo",
      onClick: () => {
        if (undone) return;
        undone = true;
        revert();
      },
    },
  });
  if (id !== undefined) openUndoToasts.add(id);
  return id;
}

/**
 * Remove the items `match` picks from a list held in state, with Undo.
 *
 * `update` is a functional setter (a useState / usePersisted setter, or a
 * wrapper around a store action). Undo puts each removed item back at its
 * old position in the list as it is then, so an edit made to another item
 * in the meantime survives — restoring a snapshot of the whole list would
 * silently throw that edit away.
 *
 *   removeWithUndo({
 *     label: `Deleted “${step.title}”`,
 *     update: setSteps,
 *     match: (s) => s.id === step.id,
 *   });
 */
export function removeWithUndo<T>({
  label,
  description,
  update,
  match,
  durationMs,
}: {
  label: string;
  description?: string;
  update: (fn: (list: readonly T[]) => T[]) => void;
  match: (item: T) => boolean;
  durationMs?: number;
}) {
  let removed: { item: T; index: number }[] = [];
  return undoable({
    label,
    description,
    durationMs,
    apply: () =>
      update((list) => {
        // Reset first: React may run an updater twice (StrictMode).
        removed = [];
        const kept: T[] = [];
        list.forEach((item, index) => {
          if (match(item)) removed.push({ item, index });
          else kept.push(item);
        });
        return kept;
      }),
    revert: () =>
      update((list) => {
        const next = [...list];
        for (const { item, index } of removed) next.splice(Math.min(index, next.length), 0, item);
        return next;
      }),
  });
}

/** Undo toasts still on screen. */
const openUndoToasts = new Set<string | number>();

/**
 * Close every open Undo toast. The app shell calls this on navigation: a
 * revert that restores a page's local state can't work once that page has
 * unmounted, and an Undo that silently does nothing is worse than none.
 */
export function dismissUndoToasts(): void {
  openUndoToasts.forEach((id) => toast.dismiss(id));
  openUndoToasts.clear();
}
