import { describe, expect, it } from "vitest";
import {
  decide,
  dedupeKeyFor,
  DIALOG_DEFER_MAX_MS,
  INFO_HOLD_MAX_MS,
  TYPING_DEFER_MAX_MS,
} from "@/lib/notify/policy";
import type { NotifyKind, NotifyRequest, PolicyContext } from "@/lib/notify/types";

/**
 * The toast policy as a table: each kind × moment (calm, quiet, dialog open,
 * typing on a phone) → channel, duration, close button, sound, haptic.
 */

const CALM: PolicyContext = {
  quiet: { quiet: false, reason: null },
  dialogOpen: false,
  typing: false,
  phone: false,
  touch: false,
  confirmationsAsToasts: false,
  mutedKeys: [],
};
const QUIET: Partial<PolicyContext> = { quiet: { quiet: true, reason: "ceremony" } };
const DIALOG: Partial<PolicyContext> = { dialogOpen: true };
const TYPING_PHONE: Partial<PolicyContext> = { typing: true, phone: true };
const TYPING_DESKTOP: Partial<PolicyContext> = { typing: true, phone: false };

function req(kind: NotifyKind, patch: Partial<NotifyRequest> = {}): NotifyRequest {
  return { kind, title: "Hello", hasAction: false, ...patch };
}

function d(kind: NotifyKind, ctx: Partial<PolicyContext> = {}, patch: Partial<NotifyRequest> = {}) {
  return decide(req(kind, patch), { ...CALM, ...ctx });
}

describe("decide: calm", () => {
  it.each([
    // kind, duration, close, sound, haptic
    ["error", 7000, true, "toast-error", true],
    ["warning", 5000, true, "toast-warning", true],
    ["undo", 8000, true, null, false],
    ["progress", Number.POSITIVE_INFINITY, false, null, false],
    ["success", 2500, false, "toast-success", false],
    ["info", 4000, false, null, false],
    ["system", 10_000, true, null, false],
  ] as const)(
    "%s → toast %s ms, close %s, sound %s, haptic %s",
    (kind, ms, close, sound, haptic) => {
      const r = d(kind);
      expect(r).toMatchObject({
        channel: "toast",
        durationMs: ms,
        closeButton: close,
        sound,
        haptic,
      });
    }
  );

  it("an error with an action stays 9 s", () => {
    expect(d("error", {}, { hasAction: true }).durationMs).toBe(9000);
  });

  it("success sound plays in Full sound mode only", () => {
    expect(d("success").soundFullModeOnly).toBe(true);
    expect(d("error").soundFullModeOnly).toBe(false);
  });

  it("success and info get a close button on touch screens only", () => {
    expect(d("success", { touch: true }).closeButton).toBe(true);
    expect(d("info", { touch: true }).closeButton).toBe(true);
    expect(d("success").closeButton).toBe(false);
  });

  it("the caller's duration wins", () => {
    expect(d("success", {}, { duration: 6000 }).durationMs).toBe(6000);
    expect(d("undo", {}, { duration: 12_000 }).durationMs).toBe(12_000);
  });

  it("echo is confirmed inline unless confirmations-as-pop-ups is on", () => {
    expect(d("echo").channel).toBe("inline");
    expect(d("echo", { confirmationsAsToasts: true })).toMatchObject({
      channel: "toast",
      durationMs: 2000,
      closeButton: false,
      sound: null,
    });
  });

  it("celebrations never become a toast", () => {
    expect(d("celebration").channel).toBe("inbox");
    expect(d("celebration", QUIET).channel).toBe("inbox");
  });
});

describe("decide: quiet (ceremony, presenting, Focus, quiet hours, intro)", () => {
  it.each([
    ["error", "toast"],
    ["warning", "toast"],
    ["undo", "toast"],
    ["progress", "toast"],
    ["success", "drop"],
    ["echo", "drop"],
    ["info", "defer"],
    ["system", "defer"],
  ] as const)("%s → %s", (kind, channel) => {
    expect(d(kind, { ...QUIET, confirmationsAsToasts: true }).channel).toBe(channel);
  });

  it("errors and warnings show silently", () => {
    expect(d("error", QUIET)).toMatchObject({ channel: "toast", sound: null, haptic: false });
    expect(d("warning", QUIET)).toMatchObject({ channel: "toast", sound: null, haptic: false });
  });

  it("a success with an action still shows, silently", () => {
    expect(d("success", QUIET, { hasAction: true })).toMatchObject({
      channel: "toast",
      sound: null,
    });
  });

  it("info is held for 30 min, then dropped unless it has an action", () => {
    expect(d("info", QUIET, { waitedMs: INFO_HOLD_MAX_MS - 1 }).channel).toBe("defer");
    expect(d("info", QUIET, { waitedMs: INFO_HOLD_MAX_MS })).toMatchObject({
      channel: "drop",
      reason: "expired",
    });
    expect(d("info", QUIET, { waitedMs: INFO_HOLD_MAX_MS, hasAction: true }).channel).toBe("defer");
  });

  it("says why", () => {
    expect(d("success", QUIET).reason).toBe("quiet:ceremony");
  });
});

describe("decide: a dialog is open", () => {
  it.each([
    ["error", "toast"],
    ["warning", "toast"],
    ["undo", "toast"],
    ["progress", "toast"],
    ["success", "defer"],
    ["echo", "drop"],
    ["info", "defer"],
    ["system", "defer"],
  ] as const)("%s → %s", (kind, channel) => {
    expect(d(kind, { ...DIALOG, confirmationsAsToasts: true }).channel).toBe(channel);
  });

  it("a success waits at most 5 s for the dialog", () => {
    expect(d("success", DIALOG, { waitedMs: DIALOG_DEFER_MAX_MS - 1 }).channel).toBe("defer");
    expect(d("success", DIALOG, { waitedMs: DIALOG_DEFER_MAX_MS }).channel).toBe("toast");
  });
});

describe("decide: typing", () => {
  it.each([
    ["error", "toast"],
    ["warning", "defer"],
    ["undo", "toast"],
    ["progress", "toast"],
    ["success", "defer"],
    ["info", "defer"],
    ["system", "defer"],
    ["echo", "inline"],
  ] as const)("on a phone, %s → %s", (kind, channel) => {
    expect(d(kind, TYPING_PHONE).channel).toBe(channel);
  });

  it("echo on a phone shows as a toast when confirmations-as-pop-ups is on", () => {
    expect(d("echo", { ...TYPING_PHONE, confirmationsAsToasts: true }).channel).toBe("toast");
  });

  it("warning and success wait at most 3 s", () => {
    for (const kind of ["warning", "success", "info"] as const) {
      expect(d(kind, TYPING_PHONE, { waitedMs: TYPING_DEFER_MAX_MS - 1 }).channel).toBe("defer");
      expect(d(kind, TYPING_PHONE, { waitedMs: TYPING_DEFER_MAX_MS }).channel).toBe("toast");
    }
  });

  it("typing on a larger screen defers nothing", () => {
    for (const kind of ["warning", "success", "info", "system"] as const) {
      expect(d(kind, TYPING_DESKTOP).channel).toBe("toast");
    }
  });
});

describe("decide: learned muting", () => {
  it("drops a muted info or success key", () => {
    expect(d("info", { mutedKeys: ["info:Hello"] })).toMatchObject({
      channel: "drop",
      reason: "muted",
    });
    expect(d("success", { mutedKeys: ["tip-1"] }, { id: "tip-1" }).channel).toBe("drop");
  });

  it("never mutes error, undo or warning", () => {
    for (const kind of ["error", "undo", "warning"] as const) {
      expect(d(kind, { mutedKeys: [`${kind}:Hello`] }).channel).toBe("toast");
    }
  });
});

describe("dedupeKeyFor", () => {
  it("is the caller's id, else kind:title", () => {
    expect(dedupeKeyFor({ kind: "error", title: "x", id: "net" })).toBe("net");
    expect(dedupeKeyFor({ kind: "error", title: "x", id: 7 })).toBe("7");
    expect(dedupeKeyFor({ kind: "error", title: "x" })).toBe("error:x");
    expect(dedupeKeyFor({ kind: "info", title: null })).toBe("info:");
  });

  it("is on every decision", () => {
    expect(d("error").dedupeKey).toBe("error:Hello");
  });
});
