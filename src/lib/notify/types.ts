/**
 * Shared types for the notification layer: what a caller asks for
 * (`NotifyRequest`), what the policy sees (`PolicyContext`) and what it
 * decides (`NotifyDecision`).
 *
 * No "use client" and no imports with side effects, so pure code (the
 * policy, tests, server code) can import it.
 */

import type { QuietState } from "./quiet-state";

/**
 * What a notification is about. The kind, not the call, decides how loud it
 * is (see lib/notify/policy.ts):
 * - `error`: something failed and the user may need to act.
 * - `warning`: something might go wrong.
 * - `success`: something the user asked for finished.
 * - `info`: worth knowing, never urgent.
 * - `echo`: repeats what the user just did ("Copied", "Exported").
 * - `undo`: a destructive change that can still be taken back.
 * - `progress`: a loading toast that settles later.
 * - `system`: an app nudge nobody asked for (backup reminder, tablet tips).
 * - `celebration`: a reward; never a toast (Activity inbox and moments).
 */
export type NotifyKind =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "echo"
  | "undo"
  | "progress"
  | "system"
  | "celebration";

export const NOTIFY_KINDS: readonly NotifyKind[] = [
  "error",
  "warning",
  "success",
  "info",
  "echo",
  "undo",
  "progress",
  "system",
  "celebration",
];

/** A request to notify, as the policy sees it. */
export interface NotifyRequest {
  kind: NotifyKind;
  /** The title as plain text when it is a string; used for the dedupe key. */
  title: string | null;
  /** The caller's toast id, when it gave one. */
  id?: string | number;
  /** The caller asked for this duration (ms). */
  duration?: number;
  /** The toast carries an action button (Undo, Retry, Download…). */
  hasAction: boolean;
  /** How long this request has already waited in the deferred queue (ms). */
  waitedMs?: number;
}

/** Everything around the request the policy needs. All plain values. */
export interface PolicyContext {
  quiet: QuietState;
  /** A modal dialog or sheet is open. */
  dialogOpen: boolean;
  /** The user typed in an editable field within the last 2.5 s. */
  typing: boolean;
  /** Phone-width viewport. */
  phone: boolean;
  /** A coarse pointer (touch screen). */
  touch: boolean;
  /** Show "Copied / Exported" as pop-ups (Settings › Notifications). */
  confirmationsAsToasts: boolean;
  /** Keys the user has dismissed often enough to stop seeing them. */
  mutedKeys: readonly string[];
}

/**
 * Where a notification goes.
 * - `toast`: shown now.
 * - `inline`: the calling control confirms it in place; no toast.
 * - `inbox`: the Activity inbox (celebrations).
 * - `drop`: not shown at all.
 * - `defer`: held; ask again in `retryInMs`.
 */
export type NotifyChannel = "toast" | "inline" | "inbox" | "drop" | "defer";

/** The sound/haptic event a toast plays (lib/sonification + lib/haptics palettes). */
export type ToastFeedbackEvent = "toast-error" | "toast-warning" | "toast-success";

export interface NotifyDecision {
  channel: NotifyChannel;
  /** Toast duration in ms; `Infinity` stays until settled or dismissed. */
  durationMs: number;
  /** Show the close (X) button. */
  closeButton: boolean;
  /** Sound to play (still gated by the sound prefs), or null. */
  sound: ToastFeedbackEvent | null;
  /** Play the sound only in Full sound mode. */
  soundFullModeOnly: boolean;
  /** Fire the matching haptic (still gated by the haptics prefs and mode). */
  haptic: boolean;
  /** Repeats of this key within the dedupe window update one toast in place. */
  dedupeKey: string;
  /** For `defer`: when to ask again (ms). */
  retryInMs?: number;
  /** Why it was dropped, deferred or sent inline (for tests and debugging). */
  reason?: string;
}
