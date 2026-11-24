import { describe, expect, it } from "vitest";
import { noticeAction } from "@/lib/agent/notice-actions";
import type { ChatNoticeKind } from "@/lib/agent/client";
import type { ChatProfile } from "@/lib/agent/store";

/**
 * Which button each notice kind offers in the chat: "Go on" after an answer
 * that stops short, "Try again" after a failure a second try may get past,
 * and nothing where asking the same thing again can't help.
 */

const note = (kind: ChatNoticeKind, tone: "note" | "error" = "error") => ({
  tone,
  kind,
  text: "Amr says nothing here.",
});

const BOTH: ChatProfile[] = ["owner", "visitor"];

describe("noticeAction", () => {
  it("offers nothing without a notice", () => {
    for (const p of BOTH) expect(noticeAction(null, p)).toBeNull();
  });

  it("offers Go on after an answer cut short, in both chats", () => {
    for (const p of BOTH) expect(noticeAction(note("cut_off", "note"), p)).toBe("go_on");
  });

  it("offers Go on after the owner's tool rounds ran out, and nothing to a visitor", () => {
    expect(noticeAction(note("round_limit", "note"), "owner")).toBe("go_on");
    expect(noticeAction(note("round_limit", "note"), "visitor")).toBeNull();
  });

  it("offers Try again after a failure a second try may get past", () => {
    const kinds: ChatNoticeKind[] = [
      "no_answer",
      "stream_failed",
      "upstream_busy",
      "upstream_error",
      "timeout",
      "request_failed",
      "unreachable",
      "slow_down",
    ];
    for (const kind of kinds) {
      for (const p of BOTH) expect(noticeAction(note(kind), p), kind).toBe("retry");
    }
  });

  it("offers nothing where asking the same thing again can't help", () => {
    const kinds: ChatNoticeKind[] = [
      "repeated_failure",
      "cant_do_here",
      "live_room",
      "too_large",
      "signed_out",
      "key_refused",
      "usage_limit",
      "no_key",
      "disabled",
      "forbidden",
      "bad_request",
      "meter_unavailable",
      "visitor_limit",
      "visitor_peak_limit",
      "site_limit",
      "site_peak_limit",
      "site_busy",
    ];
    for (const kind of kinds) {
      for (const p of BOTH) expect(noticeAction(note(kind), p), kind).toBeNull();
    }
    // A plain error of the chat's own (setError) offers nothing either.
    expect(noticeAction({ tone: "error", kind: "error", text: "x" }, "visitor")).toBeNull();
  });
});
