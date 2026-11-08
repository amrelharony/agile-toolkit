"use client";

/**
 * Rare, short moments with Amr at a calm time.
 *
 * Every celebration already lands in the Activity inbox (celebrations.ts).
 * On top of that, a rare item (Balanced) or any unlock (Lively) may get a
 * moment: Amr cheers once and a chip beside him reads "Level 8 · tap to see"
 * for about 4 s. Quiet gets none.
 *
 * **Calm** means all of: not quiet (ceremony route, presenting, the intro,
 * Focus, quiet hours) and celebrations not paused; the page is visible; not
 * typing and 1.5 s since the last input; no dialog open; no toast showing;
 * Amr idle (nothing queued, not carried, not talking); no drag in progress;
 * 10 min since the last moment (2 min in Lively); fewer than 3 moments today
 * (10 in Lively).
 *
 * **How it runs.** One setTimeout, 2 s backing off to 15 s, runs only while
 * a playable item waits. Waiting on something that ends at a known time
 * (the gap, Focus, a pause, quiet hours) sleeps until then instead; waiting
 * on something that announces its end (route, presenting, the intro,
 * visibility, Settings) sleeps until that event kicks it.
 *
 * **When it fires** the rarest fresh item plays. Everything else that was
 * held becomes one recap row named after what it waited through ("While you
 * were in Retro Board: Retro Regular, +1 challenge"). A hold that ends with
 * nothing to play still writes that recap at the first calm check, and the
 * moment limits (gap, per day) never hold a recap back. Items older than 12 h
 * only go to the recap. What waits survives a reload; the first calm check of
 * a new browser session, or of a new day, turns what's left from before into
 * one "Since last time…" row.
 *
 * Nothing is dropped: the rows are in the inbox whether or not a moment plays.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { mergePersisted } from "@/lib/stores/persist-migrate";
import {
  getNotificationPrefsSnapshot,
  useNotificationPrefsStore,
} from "@/lib/stores/notification-prefs-store";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { isDragInProgress } from "@/lib/sonification/drag-flag";
import { emitFeedback } from "@/lib/sonification/emit";
import { subscribeCelebrations } from "@/lib/gamification/celebrations";
import { getToolByPath } from "@/lib/constants/tools";
import { isTyping, msSinceInput } from "./attention";
import { isDialogOpen } from "./dialog-open";
import { useInboxStore, withInbox } from "./inbox-store";
import { maxRarity, rarityRank, type InboxItem, type Rarity } from "./inbox";
import {
  FOCUS_UNTIL_OFF,
  areCelebrationsPaused,
  effectiveCelebrationLevel,
  effectiveQuietHours,
  parseTime,
  type CelebrationLevel,
  type NotificationPrefs,
} from "./prefs";
import { defaultQuietDom, getQuietState, type QuietReason, type QuietState } from "./quiet-state";
import { SINCE_LAST_TIME_TITLE, recapBody, recapTitle, type RecapContext } from "./copy";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const MOMENTS_STORAGE_KEY = "agile-toolkit:moments";
export const MOMENTS_VERSION = 1;
const SESSION_KEY = "agile-toolkit:moments-session";

export const RETRY_MIN_MS = 2_000;
export const RETRY_MAX_MS = 15_000;
/** Since the last pointer, key or scroll. */
export const INPUT_QUIET_MS = 1_500;
export const MOMENT_GAP_MS: Record<CelebrationLevel, number> = {
  quiet: Number.POSITIVE_INFINITY,
  balanced: 10 * 60_000,
  lively: 2 * 60_000,
};
export const MOMENTS_PER_DAY: Record<CelebrationLevel, number> = {
  quiet: 0,
  balanced: 3,
  lively: 10,
};
/** Older items only appear in a recap. */
export const MOMENT_FRESH_MS = 12 * 60 * 60_000;
/** Waiting items are forgotten after a week (they're in the inbox anyway). */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const PENDING_CAP = 30;
/** How long the chip stays up. */
export const CHIP_MS = 4_000;
/** Longest single sleep for a wait with a known end (re-checked after). */
const LONG_SLEEP_MS = 30 * 60_000;

/** Kinds that count as an unlock (Lively plays all of them). */
const UNLOCK_KINDS: ReadonlySet<string> = new Set([
  "level-up",
  "achievement",
  "prestige",
  "challenge",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What a held item waited through. */
export type HoldReason = QuietReason | "paused" | "busy";

export interface MomentContext extends RecapContext {
  reason: HoldReason;
}

/** An inbox row waiting for a moment or a recap. */
export interface PendingMoment {
  /** The inbox row's id. */
  id: string;
  title: string;
  kind: string;
  rarity: Rarity;
  icon: string;
  /** Epoch ms it (last) arrived. */
  at: number;
  /** Items the row stands for (a grouped challenge row). */
  count: number;
  /** What it was held by, or null when it arrived at a calm time. */
  context: MomentContext | null;
}

/** The moment on screen (the chip reads it; Amr hears it). */
export interface MomentShown {
  id: string;
  title: string;
  kind: string;
  rarity: Rarity;
  icon: string;
  at: number;
  /** "Preview a moment" from Settings: not counted, not marked. */
  preview?: boolean;
}

interface MomentPersisted {
  pending: PendingMoment[];
  lastMomentAt: number | null;
  /** Moments played on `date` (local YYYY-MM-DD). */
  day: { date: string; count: number };
}

interface MomentState extends MomentPersisted {
  current: MomentShown | null;
  dismiss: () => void;
}

const RARITIES: readonly Rarity[] = ["common", "rare", "epic", "legendary"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function localDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cleanPending(raw: unknown): PendingMoment | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id || typeof raw.title !== "string") return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  const ctx =
    isPlainObject(raw.context) && typeof raw.context.reason === "string" ? raw.context : null;
  return {
    ...raw,
    id: raw.id,
    title: raw.title,
    kind: typeof raw.kind === "string" && raw.kind ? raw.kind : "note",
    rarity: RARITIES.includes(raw.rarity as Rarity) ? (raw.rarity as Rarity) : "common",
    icon: typeof raw.icon === "string" && raw.icon ? raw.icon : "Sparkles",
    at: raw.at,
    count: typeof raw.count === "number" && raw.count > 0 ? raw.count : 1,
    context: ctx as MomentContext | null,
  } as PendingMoment;
}

/**
 * Bring any stored payload to the current shape. Idempotent; keeps unknown
 * fields; drops entries it can't read. A non-object yields the empty state.
 */
export function migrateMoments(persisted: unknown): MomentPersisted {
  if (!isPlainObject(persisted))
    return { pending: [], lastMomentAt: null, day: { date: "", count: 0 } };
  const pending: PendingMoment[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(persisted.pending) ? persisted.pending : []) {
    const p = cleanPending(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    pending.push(p);
  }
  const day = isPlainObject(persisted.day) ? persisted.day : {};
  return {
    ...persisted,
    pending: pending.slice(-PENDING_CAP),
    lastMomentAt:
      typeof persisted.lastMomentAt === "number" && Number.isFinite(persisted.lastMomentAt)
        ? persisted.lastMomentAt
        : null,
    day: {
      ...day,
      date: typeof day.date === "string" ? day.date : "",
      count: typeof day.count === "number" && day.count >= 0 ? day.count : 0,
    },
  };
}

export const useMomentStore = create<MomentState>()(
  persist(
    (set) => ({
      pending: [],
      lastMomentAt: null,
      day: { date: "", count: 0 },
      current: null,
      dismiss: () => set((s) => (s.current ? { current: null } : s)),
    }),
    {
      name: MOMENTS_STORAGE_KEY,
      storage: safeJSONStorage("moments"),
      skipHydration: true,
      version: MOMENTS_VERSION,
      partialize: (s) => ({ pending: s.pending, lastMomentAt: s.lastMomentAt, day: s.day }),
      migrate: (persisted) => migrateMoments(persisted) as unknown as MomentState,
      merge: (persisted, current) =>
        mergePersisted(isPlainObject(persisted) ? migrateMoments(persisted) : persisted, current),
    }
  )
);

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

/** Whether a row may get a moment at this celebration level. */
export function isMomentWorthy(
  level: CelebrationLevel,
  item: Pick<InboxItem, "kind" | "rarity">
): boolean {
  if (level === "quiet") return false;
  if (!UNLOCK_KINDS.has(item.kind)) return false;
  if (level === "lively") return true;
  return rarityRank(item.rarity) >= rarityRank("rare");
}

/** Everything the calm check looks at, read once per check. */
export interface CalmInputs {
  now: number;
  level: CelebrationLevel;
  quiet: QuietState;
  paused: boolean;
  visible: boolean;
  typing: boolean;
  msSinceInput: number;
  dialogOpen: boolean;
  toastShowing: boolean;
  amrBusy: boolean;
  dragging: boolean;
  lastMomentAt: number | null;
  momentsToday: number;
}

export type CalmBlockReason =
  | HoldReason
  | "off"
  | "hidden"
  | "typing"
  | "input"
  | "dialog"
  | "toast"
  | "amr"
  | "drag"
  | "gap"
  | "daily";

/** Why it isn't calm, or null when it is. */
export function calmBlocker(i: CalmInputs): CalmBlockReason | null {
  if (i.level === "quiet") return "off";
  if (i.quiet.quiet) return i.quiet.reason;
  if (i.paused) return "paused";
  if (!i.visible) return "hidden";
  if (i.typing) return "typing";
  if (i.msSinceInput < INPUT_QUIET_MS) return "input";
  if (i.dialogOpen) return "dialog";
  if (i.toastShowing) return "toast";
  if (i.amrBusy) return "amr";
  if (i.dragging) return "drag";
  if (i.momentsToday >= MOMENTS_PER_DAY[i.level]) return "daily";
  if (i.lastMomentAt !== null && i.now - i.lastMomentAt < MOMENT_GAP_MS[i.level]) return "gap";
  return null;
}

/** Milliseconds until quiet hours end (from inside them). */
export function msUntilQuietHoursEnd(
  prefs: Pick<NotificationPrefs, "quietHours">,
  now: Date
): number {
  const end = parseTime(effectiveQuietHours(prefs.quietHours).end) ?? 0;
  const target = new Date(now);
  target.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

/** The rarest fresh playable item (the newest of equals), or null. */
export function pickHead(
  pending: readonly PendingMoment[],
  level: CelebrationLevel,
  now: number
): PendingMoment | null {
  let head: PendingMoment | null = null;
  for (const p of pending) {
    if (!isMomentWorthy(level, p) || now - p.at >= MOMENT_FRESH_MS) continue;
    if (!head || rarityRank(p.rarity) > rarityRank(head.rarity)) head = p;
    else if (rarityRank(p.rarity) === rarityRank(head.rarity) && p.at >= head.at) head = p;
  }
  return head;
}

// ---------------------------------------------------------------------------
// Environment (the live page; tests swap pieces)
// ---------------------------------------------------------------------------

export interface MomentEnv {
  now: () => number;
  visible: () => boolean;
  typing: () => boolean;
  msSinceInput: () => number;
  dialogOpen: () => boolean;
  toastShowing: () => boolean;
  amrBusy: () => boolean;
  dragging: () => boolean;
  dom: () => { dataset: { intro?: string; presenting?: string } } | null;
}

const LIVE_ENV: MomentEnv = {
  now: () => Date.now(),
  visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
  typing: () => isTyping(),
  msSinceInput: () => msSinceInput(),
  dialogOpen: () => isDialogOpen(),
  toastShowing: () =>
    typeof document !== "undefined" && document.querySelector("[data-sonner-toast]") !== null,
  amrBusy: () => {
    const m = useMascotStore.getState();
    return m.reactionQueue.length > 0 || m.drag !== null || m.talking;
  },
  dragging: () => isDragInProgress(),
  dom: () => defaultQuietDom(),
};

let env: MomentEnv = LIVE_ENV;

/** Test-only: override parts of the environment (null restores the page). */
export function __setMomentEnvForTests(patch: Partial<MomentEnv> | null): void {
  env = patch ? { ...LIVE_ENV, ...patch } : LIVE_ENV;
}

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

let pathname: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
/** This page load started a new browser session with items left from before. */
let sinceLastTimeArmed = false;

type MomentListener = (moment: MomentShown) => void;
const listeners = new Set<MomentListener>();

/** Hear every moment that plays (Amr's cheer). */
export function subscribeMoments(fn: MomentListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function prefsNow(): NotificationPrefs {
  return getNotificationPrefsSnapshot();
}

function contextLabel(reason: QuietReason): string | undefined {
  if (reason !== "ceremony" || !pathname) return undefined;
  const root = `/${pathname.split("/")[1] ?? ""}`;
  return getToolByPath(root)?.name;
}

/** What would hold a celebration that arrives right now, if anything. */
function holdContext(now: number, prefs: NotificationPrefs): MomentContext | null {
  const quiet = getQuietState(now, pathname, env.dom(), prefs);
  if (quiet.quiet) {
    const label = contextLabel(quiet.reason);
    return { reason: quiet.reason, ...(label ? { label } : {}) };
  }
  if (areCelebrationsPaused(prefs, now)) return { reason: "paused" };
  return null;
}

function readCalm(now: number, prefs: NotificationPrefs): CalmInputs {
  const s = useMomentStore.getState();
  return {
    now,
    level: effectiveCelebrationLevel(prefs),
    quiet: getQuietState(now, pathname, env.dom(), prefs),
    paused: areCelebrationsPaused(prefs, now),
    visible: env.visible(),
    typing: env.typing(),
    msSinceInput: env.msSinceInput(),
    dialogOpen: env.dialogOpen(),
    toastShowing: env.toastShowing(),
    amrBusy: env.amrBusy(),
    dragging: env.dragging(),
    lastMomentAt: s.lastMomentAt,
    momentsToday: s.day.date === localDate(now) ? s.day.count : 0,
  };
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function arm(delayMs: number): void {
  clearTimer();
  timer = setTimeout(runMomentCheck, Math.max(0, Math.min(delayMs, 2_147_000_000)));
}

/**
 * Something waits that a moment or a recap could use. Every pending item
 * does: a fresh worthy one plays, and a held or stale one goes to a recap.
 */
function hasWork(): boolean {
  return useMomentStore.getState().pending.length > 0;
}

/** Some waiting item arrived on an earlier local day. */
function leftFromEarlierDay(pending: readonly PendingMoment[], now: number): boolean {
  const today = localDate(now);
  return pending.some((p) => localDate(p.at) !== today);
}

/**
 * Keep at most PENDING_CAP items. Over the cap, the ones least worth keeping
 * go first: anything that can't get a moment (or is past fresh), then the
 * least rare, then the oldest. A moment-worthy item is never pushed out by
 * a pile of common rows (they're all in the inbox anyway).
 */
export function capPending(
  pending: readonly PendingMoment[],
  level: CelebrationLevel,
  now: number
): PendingMoment[] {
  if (pending.length <= PENDING_CAP) return [...pending];
  const playable = (p: PendingMoment) =>
    isMomentWorthy(level, p) && now - p.at < MOMENT_FRESH_MS ? 1 : 0;
  const ranked = [...pending].sort(
    (a, b) =>
      playable(b) - playable(a) || rarityRank(b.rarity) - rarityRank(a.rarity) || b.at - a.at
  );
  const keep = new Set(ranked.slice(0, PENDING_CAP));
  return pending.filter((p) => keep.has(p));
}

/** How long to sleep for a blocker, or null to wait for a kick. */
function retryDelay(
  reason: CalmBlockReason,
  i: CalmInputs,
  prefs: NotificationPrefs
): number | null {
  switch (reason) {
    case "off":
    case "hidden":
    case "ceremony":
    case "presenting":
    case "intro":
    case "daily":
      // Route, visibility, <html> data attributes and Settings all kick.
      return null;
    case "focus":
      return prefs.focusUntil === null || prefs.focusUntil >= FOCUS_UNTIL_OFF
        ? null
        : Math.min(LONG_SLEEP_MS, prefs.focusUntil - i.now + 50);
    case "paused":
      return prefs.celebrationsPausedUntil === null
        ? null
        : Math.min(LONG_SLEEP_MS, prefs.celebrationsPausedUntil - i.now + 50);
    case "quiet-hours":
      return Math.min(LONG_SLEEP_MS, msUntilQuietHoursEnd(prefs, new Date(i.now)) + 50);
    case "gap":
      return (i.lastMomentAt ?? i.now) + MOMENT_GAP_MS[i.level] - i.now + 50;
    default: {
      const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempts);
      attempts++;
      return delay;
    }
  }
}

/**
 * Check now: play a moment (and its recap) if it's calm, else sleep. Runs
 * from the timer and from `kickMoments()`; tests call it directly.
 */
export function runMomentCheck(): void {
  timer = null;
  const now = env.now();
  const prefs = prefsNow();
  const level = effectiveCelebrationLevel(prefs);
  prune(now);
  if (!prefs.gamificationEnabled || !hasWork()) return;
  const inputs = readCalm(now, prefs);
  const blocker = calmBlocker(inputs);
  if (blocker === "daily" || blocker === "gap") {
    // Everything else is calm; the limits only bound moments. The recap of
    // what was held goes now, and a moment-worthy head waits out the limit.
    const head = fire(now, level, false);
    if (head) {
      const delay = retryDelay(blocker, inputs, prefs);
      if (delay !== null) arm(delay);
    }
    return;
  }
  if (blocker) {
    const delay = retryDelay(blocker, inputs, prefs);
    if (delay !== null) arm(delay);
    return;
  }
  fire(now, level, true);
}

function prune(now: number): void {
  const { pending } = useMomentStore.getState();
  const kept = pending.filter((p) => now - p.at < PENDING_MAX_AGE_MS);
  if (kept.length !== pending.length) useMomentStore.setState({ pending: kept });
}

/**
 * Write the recap of everything but the head and, when `playHead`, play the
 * head. Without `playHead` the head (if any) stays pending and is returned.
 */
function fire(now: number, level: CelebrationLevel, playHead: boolean): PendingMoment | null {
  attempts = 0;
  const { pending, day } = useMomentStore.getState();
  const head = pickHead(pending, level, now);
  const rest = pending.filter((p) => p !== head);
  const sinceLastTime = sinceLastTimeArmed || leftFromEarlierDay(pending, now);
  if (sinceLastTimeArmed) {
    sinceLastTimeArmed = false;
    markSessionSeen();
  }
  // What the recap stands for: whatever was held, or waited for a moment it
  // didn't get. A common row that arrived at a calm time is only an inbox row
  // (it can be pending only after a level change), unless it's left from
  // before.
  const recapped = sinceLastTime
    ? rest
    : rest.filter((p) => p.context !== null || isMomentWorthy(level, p));

  if (recapped.length > 0) {
    // Named after the most recent hold.
    const context = [...recapped].reverse().find((p) => p.context)?.context ?? null;
    const title = sinceLastTime ? SINCE_LAST_TIME_TITLE : recapTitle(context);
    const children = recapped.map((p) => ({ title: p.title, icon: p.icon, kind: p.kind }));
    withInbox(() => {
      useInboxStore.getState().add({
        kind: "recap",
        title,
        body: recapBody(recapped),
        icon: "History",
        // A recap never earns a moment of its own.
        rarity: "common",
        gamification: true,
        children,
      });
    });
  }

  if (!playHead) {
    useMomentStore.setState({ pending: head ? [head] : [] });
    return head;
  }

  const today = localDate(now);
  useMomentStore.setState({
    pending: [],
    ...(head
      ? {
          lastMomentAt: now,
          day: { date: today, count: (day.date === today ? day.count : 0) + 1 },
        }
      : {}),
  });
  if (head) {
    withInbox(() => useInboxStore.getState().markMomentShown(head.id));
    play({
      id: head.id,
      title: head.title,
      kind: head.kind,
      rarity: head.rarity,
      icon: head.icon,
      at: now,
    });
  }
  return null;
}

/** Show the chip, tell Amr, play the chime and (Full haptics only) a buzz. */
function play(moment: MomentShown): void {
  useMomentStore.setState({ current: moment });
  listeners.forEach((fn) => {
    try {
      fn(moment);
    } catch {
      /* a listener never breaks the moment */
    }
  });
  const event = moment.kind === "level-up" ? "level-up" : "trophy-unlock";
  let fullHaptics = false;
  try {
    const h = useHapticsStore.getState();
    fullHaptics = h.enabled && h.mode === "full";
  } catch {
    fullHaptics = false;
  }
  try {
    // The sound is gated by the sound prefs (Full mode only for this
    // surface); the dormant gamification haptics wake for moments only.
    emitFeedback("gamification", event, null, { haptics: fullHaptics });
  } catch {
    /* feedback is optional */
  }
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** A celebration row was added or updated (celebrations.ts). */
export function onCelebration(item: InboxItem): void {
  const now = env.now();
  const prefs = prefsNow();
  const level = effectiveCelebrationLevel(prefs);
  if (level === "quiet" || !prefs.gamificationEnabled) return;
  // A row whose moment already played (an update that isn't rarer) gets no
  // second one; it can still join a recap.
  const worthy = !item.momentShown && isMomentWorthy(level, item);
  const context = holdContext(now, prefs);
  const { pending } = useMomentStore.getState();
  const existing = pending.find((p) => p.id === item.id);
  // A common row at a calm time is just an inbox row. Held, it joins the recap.
  if (!worthy && !context && !existing) return;
  const entry: PendingMoment = {
    id: item.id,
    title: item.title,
    kind: item.kind,
    rarity: existing ? maxRarity(existing.rarity, item.rarity) : item.rarity,
    icon: item.icon,
    at: now,
    count: item.children && item.children.length > 0 ? item.children.length : 1,
    context: existing?.context ?? context,
  };
  const next = capPending([...pending.filter((p) => p.id !== item.id), entry], level, now);
  useMomentStore.setState({ pending: next });
  kickMoments();
}

/**
 * Something that could end a wait happened (route, visibility, presenting,
 * Focus or a pause ended, a new item): check again soon.
 */
export function kickMoments(): void {
  attempts = 0;
  if (!hasWork()) {
    clearTimer();
    return;
  }
  arm(RETRY_MIN_MS);
}

/** The router's pathname (the provider reports it). Kicks the scheduler. */
export function setMomentPathname(next: string | null): void {
  if (next === pathname) return;
  pathname = next;
  kickMoments();
}

/** "Preview a moment" (Settings › Notifications): shows the chip now, uncounted. */
export function previewMoment(title = "Level 8"): void {
  play({
    id: `preview-${env.now()}`,
    title,
    kind: "level-up",
    rarity: "rare",
    icon: "TrendingUp",
    at: env.now(),
    preview: true,
  });
}

/** Close the chip. */
export function dismissMoment(): void {
  useMomentStore.getState().dismiss();
}

/** No "since last time" has been spent in this browser session yet. */
function isNewSession(): boolean {
  try {
    return !sessionStorage.getItem(SESSION_KEY);
  } catch {
    return false;
  }
}

/**
 * This session's "since last time" is spent (its recap was written, or
 * nothing was left from before). Until then a same-tab reload keeps it.
 */
function markSessionSeen(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* storage blocked: the next load counts as new, which only re-titles a recap */
  }
}

/**
 * Start listening for celebrations and for the events that end a wait.
 * Returns a detach function. Call once the inbox and prefs are loading.
 */
export function installMomentScheduler(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const newSession = isNewSession();
  let detached = false;
  void Promise.resolve(useMomentStore.persist.rehydrate())
    .catch(() => {})
    .then(() => {
      if (detached) return;
      if (newSession) {
        if (useMomentStore.getState().pending.length > 0) sinceLastTimeArmed = true;
        else markSessionSeen();
      }
      kickMoments();
    });

  const offCelebrations = subscribeCelebrations(onCelebration);

  const onVisibility = () => {
    if (document.visibilityState === "visible") kickMoments();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const observer =
    typeof MutationObserver === "undefined" ? null : new MutationObserver(() => kickMoments());
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-presenting", "data-intro"],
  });

  const offPrefs = useNotificationPrefsStore.subscribe((s, prev) => {
    if (
      s.focusUntil !== prev.focusUntil ||
      s.quietHours !== prev.quietHours ||
      s.celebrationsPausedUntil !== prev.celebrationsPausedUntil ||
      s.celebrationLevel !== prev.celebrationLevel ||
      s.gamificationEnabled !== prev.gamificationEnabled
    ) {
      kickMoments();
    }
  });

  return () => {
    detached = true;
    offCelebrations();
    document.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
    offPrefs();
    clearTimer();
  };
}

/** Whether the scheduler's timer is armed (tests: nothing runs while idle). */
export function isMomentTimerArmed(): boolean {
  return timer !== null;
}

/** Test-only: forget the timer, listeners, route and session state. */
export function __resetMomentsForTests(): void {
  clearTimer();
  attempts = 0;
  pathname = null;
  sinceLastTimeArmed = false;
  listeners.clear();
  env = LIVE_ENV;
  useMomentStore.setState({
    pending: [],
    lastMomentAt: null,
    day: { date: "", count: 0 },
    current: null,
  });
}

/** Test-only: pretend this page load began a new browser session. */
export function __armSinceLastTimeForTests(on = true): void {
  sinceLastTimeArmed = on;
}
