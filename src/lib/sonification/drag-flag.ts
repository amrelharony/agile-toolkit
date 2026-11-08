/**
 * Whether a drag (dnd-kit, through <SonifiedDndContext>) is in progress.
 * The moment scheduler (lib/notify/moment-scheduler.ts) waits while one is,
 * so Amr never cheers in the middle of moving a card.
 *
 * Counted, not a boolean, so two boards on one page can't clear each other's
 * flag. A drag whose end never arrived (its board unmounted mid-drag) stops
 * counting after `DRAG_STALE_MS`. No "use client": nothing here touches React.
 */

/** A drag older than this without an end is treated as over. */
export const DRAG_STALE_MS = 60_000;

let active = 0;
let lastStartAt = 0;

export function markDragStart(now: number = Date.now()): void {
  active++;
  lastStartAt = now;
}

export function markDragEnd(): void {
  if (active > 0) active--;
}

export function isDragInProgress(now: number = Date.now()): boolean {
  if (active <= 0) return false;
  if (now - lastStartAt > DRAG_STALE_MS) {
    active = 0;
    return false;
  }
  return true;
}

/** Test-only. */
export function __resetDragFlagForTests(): void {
  active = 0;
  lastStartAt = 0;
}
