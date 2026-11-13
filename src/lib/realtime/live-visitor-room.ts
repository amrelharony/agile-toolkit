/**
 * Whether this browser is in a visitor live room right now, in this tab or
 * in another tab of the site.
 *
 * In a live room the board holds other people's words, and a change made in
 * the host's tab is sent to everyone in the room. The people there agreed to
 * the room notice, which lets the host send the room's answers, without
 * names, to an AI service for a summary (a tool's AI, previewed by the host
 * before the room sees it); it doesn't cover Amr's chat reading the board,
 * names and all, or changing what the room sees. So while a room is open,
 * Amr's AI for visitors uses no tools: it reads nothing from the board and
 * changes nothing the room would see (see visitor-tools.ts and the visitor
 * loop in agent/client.ts).
 *
 * The host's board is saved in localStorage, which every tab of the site
 * shares, so the mark is shared the same way. The tab with the room keeps a
 * time stamp in localStorage and renews it; the other tabs read it. A stamp
 * that is no longer renewed (a closed or frozen tab) stops counting after
 * LIVE_ROOM_STALE_MS.
 *
 * The mark covers the open room only. When the room ends, the cards stay on
 * the host's own board, and Amr can read them when the host asks, like the
 * rest of the host's work.
 *
 * No imports, on purpose: the room hook sets this and the visitor chat reads
 * it, and neither should pull the other into its bundle.
 */

/**
 * One localStorage key per tab with a room open: this prefix, then an id for
 * the tab. The value is the time of the last renewal. Left out of backups
 * (data/backup.ts names the prefix too).
 */
export const LIVE_ROOM_KEY_PREFIX = "agile-toolkit:live-room:";
/** How often the tab with the room renews its stamp. */
export const LIVE_ROOM_BEAT_MS = 20_000;
/**
 * A stamp this old no longer counts. Well over a minute, because a hidden
 * tab's timers can run as rarely as once a minute.
 */
export const LIVE_ROOM_STALE_MS = 150_000;

let openRooms = 0;
let beat: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const ownKey = `${LIVE_ROOM_KEY_PREFIX}${Math.random().toString(36).slice(2)}`;

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

/** localStorage, or null on the server and where the browser blocks it. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function writeStamp(): void {
  try {
    storage()?.setItem(ownKey, String(Date.now()));
  } catch {
    // Storage is full or blocked. This tab's own count still holds.
  }
}

function clearStamp(): void {
  try {
    storage()?.removeItem(ownKey);
  } catch {
    // Nothing to remove.
  }
}

/** Tell the other tabs, for as long as this tab has a room open. */
function startStamp(): void {
  if (!storage()) return;
  writeStamp();
  beat = setInterval(writeStamp, LIVE_ROOM_BEAT_MS);
  // A closed or reloaded tab takes its stamp with it.
  window.addEventListener("pagehide", clearStamp);
}

function stopStamp(): void {
  if (beat === null) return;
  clearInterval(beat);
  beat = null;
  window.removeEventListener("pagehide", clearStamp);
  clearStamp();
}

/** True while another tab of this browser holds a fresh stamp. */
function roomOpenInAnotherTab(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const now = Date.now();
    const stale: string[] = [];
    let open = false;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || key === ownKey || !key.startsWith(LIVE_ROOM_KEY_PREFIX)) continue;
      const at = Number(store.getItem(key));
      if (Number.isFinite(at) && Math.abs(now - at) < LIVE_ROOM_STALE_MS) open = true;
      else stale.push(key);
    }
    // A tab that crashed left its stamp behind: tidy it away.
    for (const key of stale) store.removeItem(key);
    return open;
  } catch {
    // Unreadable storage: this tab's own count is all there is.
    return false;
  }
}

/**
 * Call when a visitor room's channel opens; call the function it returns
 * when that channel closes. Calling the returned function twice is safe.
 */
export function enterLiveVisitorRoom(): () => void {
  openRooms += 1;
  if (openRooms === 1) startStamp();
  emit();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    openRooms -= 1;
    if (openRooms === 0) stopStamp();
    emit();
  };
}

/** True while a visitor room is open in this tab or in another tab of this browser. */
export function inLiveVisitorRoom(): boolean {
  return openRooms > 0 || roomOpenInAnotherTab();
}

/**
 * For `useSyncExternalStore`: runs `listener` when a room opens or closes,
 * in this tab or in another one.
 */
export function subscribeLiveVisitorRoom(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab's stamp being written or removed arrives as a storage event.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(LIVE_ROOM_KEY_PREFIX)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
