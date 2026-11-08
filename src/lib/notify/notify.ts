"use client";

/**
 * The notification executor: asks the policy (policy.ts) what to do with a
 * toast and does it through sonner.
 *
 * - **Dedupe.** A repeat of the same key (`opts.id ?? kind:title`) within
 *   10 s, while the first is still on screen, updates that toast in place as
 *   "Title (×N)" and plays no second sound or haptic. Undo and progress
 *   toasts are never merged: two Undo toasts are two different changes.
 * - **Burst cap.** At most 2 success/info toasts per 10 s; a third replaces
 *   the newest one in place. Error, undo and warning are never limited.
 * - **Deferred queue.** A toast the policy holds (typing, a dialog, the quiet
 *   state) keeps its id and is asked about again on a timer that runs only
 *   while something waits, and whenever `flushPending()` is called (route,
 *   presenting or intro changes; see provider.tsx).
 * - **Learned muting.** Dismissing the same info/success key 3 times adds it
 *   to `prefs.mutedKeys`; Settings can show them again.
 *
 * Sound and haptics go through `emitFeedback` only: nothing here reaches the
 * gamification engine. A toast the policy drops, sends inline or holds still
 * returns an id, so callers can always `toast.dismiss(id)`.
 *
 * `NEXT_PUBLIC_NOTIFY_POLICY=legacy` (build-time) switches back to the old
 * behaviour: every toast shown at once with its sound (see toast.ts).
 */

import { toast as sonnerToast, type ExternalToast, type ToastT } from "sonner";
import { emitFeedback } from "@/lib/sonification/emit";
import {
  getNotificationPrefsSnapshot,
  useNotificationPrefsStore,
} from "@/lib/stores/notification-prefs-store";
import { isPhoneViewport } from "@/lib/layout/breakpoints";
import { isTyping } from "./attention";
import { isDialogOpen } from "./dialog-open";
import { MUTABLE_KINDS, decide } from "./policy";
import { defaultQuietDom, getQuietState } from "./quiet-state";
import type { NotifyDecision, NotifyKind, NotifyRequest, PolicyContext } from "./types";

export type ToastInput = Parameters<typeof sonnerToast>[0];

/** sonner's options, plus the notification kind when the caller knows it. */
export type NotifyOptions = ExternalToast & {
  /** Overrides the kind the helper implies (`toast.success` → success, …). */
  kind?: NotifyKind;
};

/** Which sonner helper renders the toast (its icon and style). */
export type ToastMethod =
  | "plain"
  | "success"
  | "error"
  | "info"
  | "warning"
  | "message"
  | "loading";

/** The kind each helper implies when the caller gives none. */
export const METHOD_KIND: Record<ToastMethod, NotifyKind> = {
  plain: "info",
  success: "success",
  error: "error",
  info: "info",
  warning: "warning",
  message: "info",
  loading: "progress",
};

/** The sound/haptic event the legacy wrapper played for each helper. */
const LEGACY_FEEDBACK: Record<ToastMethod, string> = {
  plain: "toast-info",
  success: "toast-success",
  error: "toast-error",
  info: "toast-info",
  warning: "toast-warning",
  message: "toast-info",
  loading: "toast-info",
};

export const DEDUPE_WINDOW_MS = 10_000;
export const DEDUPE_CAP = 50;
export const BURST_WINDOW_MS = 10_000;
export const BURST_MAX = 2;
export const MUTE_AFTER_DISMISSALS = 3;
export const PENDING_CAP = 50;

const DEDUPED_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>([
  "error",
  "warning",
  "success",
  "info",
  "echo",
  "system",
]);
const BURST_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["success", "info"]);

/** Whether the build-time kill switch restores the old toast behaviour. */
export function isLegacyNotifyPolicy(): boolean {
  return process.env.NEXT_PUBLIC_NOTIFY_POLICY === "legacy";
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/**
 * Play a toast's sound/haptic without ever letting an audio or haptics
 * failure (sync throw or async rejection) escape the toast helpers.
 */
export function safeFeedback(
  event: string,
  opts?: { sound?: boolean; haptics?: boolean; soundFullModeOnly?: boolean }
): void {
  try {
    // emitFeedback returns `void` today; cast through unknown so a future
    // promise-returning version is still `.catch`ed.
    const result = (
      opts ? emitFeedback("ui", event, undefined, opts) : emitFeedback("ui", event)
    ) as unknown;
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).catch(() => {
        /* swallow async feedback failures */
      });
    }
  } catch {
    /* swallow sync feedback failures */
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

let currentPathname: string | null = null;

/** The provider reports the route here (usePathname) so the quiet state can read it. */
export function setNotifyPathname(pathname: string | null): void {
  currentPathname = pathname;
}

function readPathname(): string | null {
  if (currentPathname !== null) return currentPathname;
  return typeof window === "undefined" ? null : window.location.pathname;
}

function isTouchScreen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia?.("(pointer: coarse)").matches === true;
  } catch {
    return false;
  }
}

let contextOverride: Partial<PolicyContext> | null = null;

/** Test-only: pin parts of the policy context. `null` clears it. */
export function __setPolicyContextForTests(patch: Partial<PolicyContext> | null): void {
  contextOverride = patch;
}

export function readPolicyContext(): PolicyContext {
  const prefs = getNotificationPrefsSnapshot();
  const ctx: PolicyContext = {
    quiet: getQuietState(Date.now(), readPathname(), defaultQuietDom(), prefs),
    dialogOpen: isDialogOpen(),
    typing: isTyping(),
    phone: isPhoneViewport(),
    touch: isTouchScreen(),
    confirmationsAsToasts: prefs.confirmationsAsToasts,
    mutedKeys: prefs.mutedKeys,
  };
  return contextOverride ? { ...ctx, ...contextOverride } : ctx;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface Shown {
  key: string;
  kind: NotifyKind;
}
interface DedupeRecord {
  id: string | number;
  kind: NotifyKind;
  title: string | null;
  count: number;
  lastAt: number;
}
interface PendingToast {
  id: string | number;
  method: ToastMethod;
  kind: NotifyKind;
  message: ToastInput;
  opts: ExternalToast;
  firstAt: number;
  retryAt: number;
}

let seq = 0;
/** Toasts on screen, by id. */
const active = new Map<string | number, Shown>();
/** Most recent toast per dedupe key (insertion order = age; capped). */
const dedupe = new Map<string, DedupeRecord>();
/** Recently shown success/info toasts, oldest first. */
let burst: { id: string | number; at: number }[] = [];
/** User dismissals per mutable key. */
const dismissals = new Map<string, number>();
/** Ids we dismissed ourselves (their onDismiss is not the user's). */
const programmatic = new Set<string | number>();
let pending: PendingToast[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function nowMs(): number {
  return Date.now();
}

function titleText(message: ToastInput): string | null {
  if (typeof message === "string") return message;
  if (typeof message === "number") return String(message);
  return null;
}

function rememberDedupe(key: string, rec: DedupeRecord): void {
  dedupe.delete(key);
  dedupe.set(key, rec);
  while (dedupe.size > DEDUPE_CAP) {
    const oldest = dedupe.keys().next().value;
    if (oldest === undefined) break;
    dedupe.delete(oldest);
  }
}

function learnDismissal(key: string, kind: NotifyKind): void {
  if (!MUTABLE_KINDS.has(kind)) return;
  const n = (dismissals.get(key) ?? 0) + 1;
  dismissals.set(key, n);
  if (n >= MUTE_AFTER_DISMISSALS) {
    dismissals.delete(key);
    try {
      useNotificationPrefsStore.getState().muteKey(key);
    } catch {
      /* prefs store unavailable — muting is best effort */
    }
  }
}

function render(
  method: ToastMethod,
  message: ToastInput,
  opts: ExternalToast,
  id: string | number
): void {
  const fn =
    method === "plain"
      ? sonnerToast
      : (sonnerToast[method] as (m: ToastInput, o?: ExternalToast) => string | number);
  fn(message, { ...opts, id });
}

function withTracking(
  opts: ExternalToast,
  id: string | number,
  key: string,
  kind: NotifyKind
): ExternalToast {
  const callerDismiss = opts.onDismiss;
  const callerAutoClose = opts.onAutoClose;
  return {
    ...opts,
    onDismiss: (t: ToastT) => {
      active.delete(id);
      if (programmatic.has(id)) programmatic.delete(id);
      else learnDismissal(key, kind);
      callerDismiss?.(t);
    },
    onAutoClose: (t: ToastT) => {
      active.delete(id);
      programmatic.delete(id);
      callerAutoClose?.(t);
    },
  };
}

function feedbackEvent(kind: NotifyKind, d: NotifyDecision): string | null {
  if (d.sound) return d.sound;
  if (!d.haptic) return null;
  if (kind === "error") return "toast-error";
  if (kind === "warning") return "toast-warning";
  return null;
}

/** Show a toast the policy let through: dedupe, burst cap, then sonner. */
function show(
  method: ToastMethod,
  kind: NotifyKind,
  message: ToastInput,
  opts: ExternalToast,
  id: string | number,
  d: NotifyDecision,
  callerGaveId: boolean
): string | number {
  const now = nowMs();
  const title = titleText(message);
  const key = d.dedupeKey;
  const sized: ExternalToast = {
    ...opts,
    duration: d.durationMs,
    closeButton: opts.closeButton ?? d.closeButton,
  };

  // 1. A repeat within the window updates the toast on screen as "(×N)".
  const rec = dedupe.get(key);
  if (
    DEDUPED_KINDS.has(kind) &&
    rec &&
    rec.kind === kind &&
    rec.title === title &&
    active.has(rec.id) &&
    now - rec.lastAt < DEDUPE_WINDOW_MS
  ) {
    rec.count += 1;
    rec.lastAt = now;
    rememberDedupe(key, rec);
    const counted = title !== null ? `${title} (×${rec.count})` : message;
    render(method, counted, withTracking(sized, rec.id, key, kind), rec.id);
    return rec.id;
  }

  // 2. Burst cap: a third success/info within 10 s replaces the newest.
  if (BURST_KINDS.has(kind) && !callerGaveId) {
    burst = burst.filter((b) => now - b.at < BURST_WINDOW_MS && active.has(b.id));
    if (burst.length >= BURST_MAX) {
      const newest = burst[burst.length - 1];
      newest.at = now;
      active.set(newest.id, { key, kind });
      rememberDedupe(key, { id: newest.id, kind, title, count: 1, lastAt: now });
      render(method, message, withTracking(sized, newest.id, key, kind), newest.id);
      return newest.id;
    }
    burst.push({ id, at: now });
  }

  // 3. A fresh toast (or the caller's own id updated in place).
  active.set(id, { key, kind });
  rememberDedupe(key, { id, kind, title, count: 1, lastAt: now });
  render(method, message, withTracking(sized, id, key, kind), id);
  const event = feedbackEvent(kind, d);
  if (event) {
    safeFeedback(event, {
      sound: d.sound !== null,
      haptics: d.haptic,
      soundFullModeOnly: d.soundFullModeOnly,
    });
  }
  return id;
}

function requestFor(
  kind: NotifyKind,
  message: ToastInput,
  opts: ExternalToast,
  waitedMs: number
): NotifyRequest {
  return {
    kind,
    title: titleText(message),
    id: opts.id,
    duration: opts.duration,
    hasAction: opts.action !== undefined && opts.action !== null,
    waitedMs,
  };
}

function scheduleFlush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.length === 0 || typeof setTimeout === "undefined") return;
  const next = Math.min(...pending.map((p) => p.retryAt));
  timer = setTimeout(
    () => {
      timer = null;
      flushPending();
    },
    Math.max(50, next - nowMs())
  );
}

/**
 * Ask the policy again about every held toast. Called on a timer while
 * something waits, and by the provider when the route, presenting mode or
 * the intro changes.
 */
export function flushPending(): void {
  if (pending.length === 0) return;
  const ctx = readPolicyContext();
  const now = nowMs();
  const still: PendingToast[] = [];
  for (const p of pending) {
    const d = decide(requestFor(p.kind, p.message, p.opts, now - p.firstAt), ctx);
    if (d.channel === "toast") {
      show(p.method, p.kind, p.message, p.opts, p.id, d, p.opts.id !== undefined);
    } else if (d.channel === "defer") {
      still.push({ ...p, retryAt: now + (d.retryInMs ?? 1000) });
    }
    // inline / inbox / drop: nothing more to do.
  }
  pending = still;
  scheduleFlush();
}

/**
 * Show (or hold, or drop) a toast according to the policy. Returns the id
 * the toast has or will have.
 */
export function notify(
  method: ToastMethod,
  message: ToastInput,
  options?: NotifyOptions
): string | number {
  const { kind: explicitKind, ...rest } = options ?? {};
  const kind = explicitKind ?? METHOD_KIND[method];
  const callerGaveId = rest.id !== undefined;
  const id = callerGaveId ? (rest.id as string | number) : `n${++seq}`;
  const opts: ExternalToast = rest;

  // A newer request for the same caller id replaces a held one.
  if (callerGaveId) pending = pending.filter((p) => p.id !== id);

  const d = decide(requestFor(kind, message, opts, 0), readPolicyContext());
  switch (d.channel) {
    case "toast":
      return show(method, kind, message, opts, id, d, callerGaveId);
    case "defer": {
      const now = nowMs();
      pending.push({
        id,
        method,
        kind,
        message,
        opts,
        firstAt: now,
        retryAt: now + (d.retryInMs ?? 1000),
      });
      if (pending.length > PENDING_CAP) pending = pending.slice(-PENDING_CAP);
      scheduleFlush();
      return id;
    }
    default:
      // inline: the control confirms it itself; inbox: celebrations (Activity);
      // drop: not shown. The caller still gets an id it may dismiss.
      return id;
  }
}

/** Close a toast (or all), including one still held in the queue. */
export function dismissNotification(id?: string | number): void {
  if (id === undefined) {
    pending = [];
    active.forEach((_v, k) => programmatic.add(k));
  } else {
    pending = pending.filter((p) => p.id !== id);
    if (active.has(id)) programmatic.add(id);
  }
  scheduleFlush();
  sonnerToast.dismiss(id);
}

/** The old wrapper's behaviour: show at once and play the helper's sound. */
export function notifyLegacy(
  method: ToastMethod,
  message: ToastInput,
  options?: NotifyOptions
): string | number {
  const { kind: _kind, ...opts } = options ?? {};
  void _kind;
  safeFeedback(LEGACY_FEEDBACK[method]);
  if (method === "plain") return sonnerToast(message, opts);
  return (sonnerToast[method] as (m: ToastInput, o?: ExternalToast) => string | number)(
    message,
    opts
  );
}

export const sonnerPromise: typeof sonnerToast.promise = (...args) => sonnerToast.promise(...args);
export const sonnerDismiss = (id?: string | number) => sonnerToast.dismiss(id);

/** Number of toasts held in the deferred queue (tests, diagnostics). */
export function pendingCount(): number {
  return pending.length;
}

/** Test-only: forget every toast, record and held item. */
export function __resetNotifyForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  seq = 0;
  active.clear();
  dedupe.clear();
  burst = [];
  dismissals.clear();
  programmatic.clear();
  pending = [];
  currentPathname = null;
  contextOverride = null;
}
