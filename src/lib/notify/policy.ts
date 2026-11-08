/**
 * The toast policy: one pure function that decides where a notification
 * goes and how loud it is, from its kind and the moment it arrives.
 *
 * | kind        | duration          | close      | sound            | haptic | quiet              | dialog open  | typing (phone) |
 * |-------------|-------------------|------------|------------------|--------|--------------------|--------------|----------------|
 * | error       | 7 s (9 s + action)| yes        | dissonant        | yes    | shown, silent      | shown        | shown          |
 * | warning     | 5 s               | yes        | pluck            | yes    | shown, silent      | shown        | deferred ≤3 s  |
 * | undo        | 8 s               | yes        | —                | —      | shown              | shown        | shown          |
 * | progress    | until settled     | —          | —                | —      | shown              | shown        | shown          |
 * | success     | 2.5 s             | touch only | chord (Full)     | —      | dropped unless action | deferred ≤5 s | deferred ≤3 s |
 * | echo        | 2 s               | —          | —                | —      | dropped            | dropped      | inline         |
 * | info        | 4 s               | touch only | —                | —      | held ≤30 min       | held         | deferred ≤3 s  |
 * | system      | 10 s              | yes        | —                | —      | held               | held         | held           |
 * | celebration | never a toast: the Activity inbox                                                                    |
 *
 * Echo ("Copied", "Exported") is confirmed inline by the control itself
 * unless the user turned on "Show confirmations as pop-ups". Haptics are
 * still gated by the haptics prefs: a warning only vibrates in Full mode
 * (patterns.ts), and nothing but timer-end vibrates under reduced motion,
 * quiet hours or Focus (gate.ts). A caller's own `duration` wins over the
 * default. Learned muting only ever applies to info and success.
 *
 * Pure: everything comes in through `req` and `ctx`, so it is tested as a
 * table (test/notify/policy.test.ts). The executor (notify.ts) does the
 * dedupe, the burst cap and the deferred queue.
 */

import type { NotifyDecision, NotifyKind, NotifyRequest, PolicyContext } from "./types";

export const DURATION_MS = {
  error: 7000,
  errorWithAction: 9000,
  warning: 5000,
  undo: 8000,
  progress: Number.POSITIVE_INFINITY,
  success: 2500,
  echo: 2000,
  info: 4000,
  system: 10_000,
} as const;

/** A success or warning waits at most this long for typing to stop (phones). */
export const TYPING_DEFER_MAX_MS = 3000;
/** A success waits at most this long for a dialog to close. */
export const DIALOG_DEFER_MAX_MS = 5000;
/** An info toast held by the quiet state is dropped after this, unless it has an action. */
export const INFO_HOLD_MAX_MS = 30 * 60_000;
/** How often a held toast asks again while nothing else wakes the queue. */
export const HOLD_RETRY_MS = 1000;

/** Kinds learned muting may silence. Never error, undo or warning. */
export const MUTABLE_KINDS: ReadonlySet<NotifyKind> = new Set<NotifyKind>(["info", "success"]);

/** `opts.id ?? kind:title`. */
export function dedupeKeyFor(req: Pick<NotifyRequest, "id" | "kind" | "title">): string {
  if (req.id !== undefined && req.id !== null && req.id !== "") return String(req.id);
  return `${req.kind}:${req.title ?? ""}`;
}

function base(req: NotifyRequest, durationMs: number): NotifyDecision {
  return {
    channel: "toast",
    durationMs: req.duration ?? durationMs,
    closeButton: false,
    sound: null,
    soundFullModeOnly: false,
    haptic: false,
    dedupeKey: dedupeKeyFor(req),
  };
}

function defer(d: NotifyDecision, retryInMs: number, reason: string): NotifyDecision {
  return { ...d, channel: "defer", retryInMs: Math.max(50, retryInMs), reason };
}

function drop(d: NotifyDecision, reason: string): NotifyDecision {
  return { ...d, channel: "drop", sound: null, haptic: false, reason };
}

/** Wait for typing to stop, up to `max` ms in all. */
function typingDefer(d: NotifyDecision, waited: number, max: number): NotifyDecision | null {
  return waited < max ? defer(d, Math.min(500, max - waited), "typing") : null;
}

export function decide(req: NotifyRequest, ctx: PolicyContext): NotifyDecision {
  const waited = req.waitedMs ?? 0;
  const quiet = ctx.quiet.quiet;
  const typingOnPhone = ctx.typing && ctx.phone;

  switch (req.kind) {
    case "celebration":
      return { ...base(req, 0), channel: "inbox", reason: "celebration" };

    case "error": {
      const d = base(req, req.hasAction ? DURATION_MS.errorWithAction : DURATION_MS.error);
      d.closeButton = true;
      if (quiet) return { ...d, reason: `quiet:${ctx.quiet.reason}` };
      return { ...d, sound: "toast-error", haptic: true };
    }

    case "warning": {
      const d = base(req, DURATION_MS.warning);
      d.closeButton = true;
      if (quiet) return { ...d, reason: `quiet:${ctx.quiet.reason}` };
      if (typingOnPhone) {
        const held = typingDefer(d, waited, TYPING_DEFER_MAX_MS);
        if (held) return held;
      }
      return { ...d, sound: "toast-warning", haptic: true };
    }

    case "undo": {
      const d = base(req, DURATION_MS.undo);
      d.closeButton = true;
      return d;
    }

    case "progress":
      return base(req, DURATION_MS.progress);

    case "success": {
      const d = base(req, DURATION_MS.success);
      d.closeButton = ctx.touch;
      if (ctx.mutedKeys.includes(d.dedupeKey)) return drop(d, "muted");
      if (quiet) {
        return req.hasAction
          ? { ...d, reason: `quiet:${ctx.quiet.reason}` }
          : drop(d, `quiet:${ctx.quiet.reason}`);
      }
      if (ctx.dialogOpen && waited < DIALOG_DEFER_MAX_MS) {
        return defer(d, Math.min(500, DIALOG_DEFER_MAX_MS - waited), "dialog");
      }
      if (typingOnPhone) {
        const held = typingDefer(d, waited, TYPING_DEFER_MAX_MS);
        if (held) return held;
      }
      return { ...d, sound: "toast-success", soundFullModeOnly: true };
    }

    case "echo": {
      const d = base(req, DURATION_MS.echo);
      if (quiet) return drop(d, `quiet:${ctx.quiet.reason}`);
      if (ctx.dialogOpen) return drop(d, "dialog");
      if (!ctx.confirmationsAsToasts) return { ...d, channel: "inline", reason: "inline" };
      return d;
    }

    case "info": {
      const d = base(req, DURATION_MS.info);
      d.closeButton = ctx.touch;
      if (ctx.mutedKeys.includes(d.dedupeKey)) return drop(d, "muted");
      if (quiet || ctx.dialogOpen) {
        if (!req.hasAction && waited >= INFO_HOLD_MAX_MS) return drop(d, "expired");
        return defer(d, HOLD_RETRY_MS, quiet ? `quiet:${ctx.quiet.reason}` : "dialog");
      }
      if (typingOnPhone) {
        const held = typingDefer(d, waited, TYPING_DEFER_MAX_MS);
        if (held) return held;
      }
      return d;
    }

    case "system": {
      const d = base(req, DURATION_MS.system);
      d.closeButton = true;
      if (quiet) return defer(d, HOLD_RETRY_MS, `quiet:${ctx.quiet.reason}`);
      if (ctx.dialogOpen) return defer(d, HOLD_RETRY_MS, "dialog");
      if (typingOnPhone) return defer(d, HOLD_RETRY_MS, "typing");
      return d;
    }
  }
}
