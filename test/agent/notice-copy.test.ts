/**
 * Every notice the chat shows is narration about Amr, in the third person,
 * never words of his own: none says I, me or my (one Amr voice, DNA §6), and
 * none uses an em or en dash. The strings are collected from the client's
 * exported constants and by calling every builder over the cases it knows,
 * including the round-limit note that stands in for a wrap-up (with and
 * without its follow-up line), and from the visitor's chat: the error when its
 * runtime can't load, the panel's narration notes over the tool finder, the
 * read-only footer's notes, the live-room and Clear chat captions, the busy
 * hours' end and the allowance line.
 */

import { describe, expect, it } from "vitest";
import {
  LIVE_ROOM_LINE,
  VISITOR_RUNTIME_LOAD_ERROR,
} from "@/components/agent/mascot/visitor-agent-panel";
import { BUSY_HOURS_OVER, readOnlyNote } from "@/components/agent/mascot/visitor-chat-footer";
import { CHAT_CLEARED } from "@/components/agent/mascot/visitor-clear-chat";
import { allowanceLine } from "@/lib/visitor-ai/allowance";
import {
  VISITOR_CHAT_ERROR_NOTE,
  VISITOR_CHAT_LOAD_NOTE,
  VISITOR_FALLBACK_NOTE,
  visitorFallbackNote,
} from "@/components/agent/mascot/visitor-panel";
import {
  NOTICE_TEXT,
  VISITOR_ERROR_TEXT,
  endNoteFor,
  ownerRefusalNotice,
  roundLimitNote,
  roundLimitNotice,
  visitorRefusalNotice,
} from "@/lib/agent/client";
import type { VisitorQuota } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import {
  VISITOR_FALLBACK_CODES,
  VISITOR_LIMITS,
  VISITOR_TIME_LIMIT_FINISH,
} from "@/lib/visitor-ai/contract";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";

const FIRST_PERSON = /\b(I|I'm|I'll|I've|me|my)\b/i;
const DASHES = /[–—]/;

const at = (id: string, role: ChatMessage["role"], content: ChatMessage["content"]) =>
  ({ id, role, content, createdAt: "" }) as ChatMessage;

/** A turn that ran `ok` reads and `failed` failures of an unknown action, after one question. */
function turn(ok: number, failed: number): ChatMessage[] {
  const msgs: ChatMessage[] = [at("u", "user", [{ type: "text", text: "go" }])];
  for (let i = 0; i < ok + failed; i++) {
    msgs.push(
      at(`a${i}`, "assistant", [
        {
          type: "tool_use",
          id: `c${i}`,
          name: i < ok ? "tool_any_read" : "tool_any_write",
          input: {},
        },
      ]),
      at(`t${i}`, "tool", [
        {
          type: "tool_result",
          tool_use_id: `c${i}`,
          content: "x",
          ...(i < ok ? {} : { is_error: true }),
        },
      ])
    );
  }
  return msgs;
}

function everyNotice(): string[] {
  const out: string[] = [...Object.values(NOTICE_TEXT), ...Object.values(VISITOR_ERROR_TEXT)];
  const finishes = [
    null,
    "stop",
    "length",
    "tool_calls",
    "content_filter",
    "sensitive",
    "network_error",
    VISITOR_TIME_LIMIT_FINISH,
  ];
  for (const hasText of [true, false]) {
    for (const finishReason of finishes) {
      for (const cut of [true, false]) {
        for (const visitor of [true, false]) {
          const n = endNoteFor({ hasText, finishReason, cut, visitor });
          if (n) out.push(n.text);
        }
      }
    }
  }
  for (const status of [200, 400, 401, 403, 404, 413, 429, 500, 502, 503, 504]) {
    for (const byok of [true, false]) {
      for (const code of [null, "upstream", "rate_limited", "payload_too_large"]) {
        out.push(ownerRefusalNotice(status, byok, code).text);
      }
    }
    out.push(visitorRefusalNotice(null, status).text);
  }
  for (const code of Object.keys(VISITOR_ERROR_TEXT) as VisitorErrorCode[]) {
    out.push(visitorRefusalNotice(code, 429).text);
  }
  for (const rounds of [1, VISITOR_LIMITS.maxToolRounds, 10]) {
    out.push(roundLimitNotice(rounds).text);
    for (const [ok, failed] of [
      [0, 0],
      [1, 0],
      [3, 2],
    ]) {
      out.push(roundLimitNote(turn(ok, failed), rounds));
      out.push(roundLimitNote(turn(ok, failed), rounds, false));
    }
  }
  // The visitor's chat: its runtime-load error (a store notice), and the
  // panel's notes over the tool finder, for every refusal it falls back on
  // (and one it doesn't know), with and without busy hours under way.
  out.push(VISITOR_RUNTIME_LOAD_ERROR);
  out.push(VISITOR_FALLBACK_NOTE, VISITOR_CHAT_LOAD_NOTE, VISITOR_CHAT_ERROR_NOTE);
  const now = new Date("2026-11-09T08:00:00Z");
  const busy: VisitorQuota = {
    remaining: 40,
    limit: 100,
    peak: true,
    peakRemaining: 0,
    peakLimit: 25,
    peakEndsAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  };
  for (const code of [...Array.from(VISITOR_FALLBACK_CODES), "unknown" as VisitorErrorCode]) {
    out.push(visitorFallbackNote(code, null, now), visitorFallbackNote(code, busy, now));
    // The chat's read-only footer says the same, in place of the composer.
    out.push(readOnlyNote(code, null, now), readOnlyNote(code, busy, now));
  }
  out.push(readOnlyNote(null, busy, now), readOnlyNote(null, { ...busy, peak: false }, now));
  out.push(LIVE_ROOM_LINE, CHAT_CLEARED, BUSY_HOURS_OVER);
  for (const live of [false, true]) {
    out.push(allowanceLine(null, now, live), allowanceLine(busy, now, live));
  }
  return out;
}

describe("every notice the chat shows", () => {
  const notices = everyNotice();

  it("are collected from every builder", () => {
    // The constants, the end notes, the refusals, the round-limit lines and
    // the visitor chat's own notes.
    expect(notices.length).toBeGreaterThan(100);
    expect(notices).toContain(VISITOR_RUNTIME_LOAD_ERROR);
    // The busy-hours wording, with the time they end, is among them.
    expect(notices.some((t) => /tool finder until \d/.test(t))).toBe(true);
    expect(notices.every((t) => typeof t === "string" && t.trim().length > 0)).toBe(true);
  });

  it.each(Array.from(new Set(notices)))("never speak as Amr: %s", (text) => {
    expect(text).not.toMatch(FIRST_PERSON);
    expect(text).not.toMatch(DASHES);
  });

  it("name Amr in the round-limit lines, in the third person", () => {
    const text = roundLimitNote(turn(2, 1), 10);
    expect(
      text.startsWith("Amr used all 10 tool rounds for this request before he could sum up.")
    ).toBe(true);
    // The facts it has always reported stay.
    expect(text).toContain("This turn ran 3 tool calls; 1 failed (`tool_any_write`).");
    expect(text.endsWith("Send a follow-up and he'll carry on.")).toBe(true);
    // Without its follow-up line (the owner's notice says that), it ends on the facts.
    expect(roundLimitNote(turn(2, 1), 10, false)).toBe(
      "Amr used all 10 tool rounds for this request before he could sum up. This turn ran 3 tool calls; 1 failed (`tool_any_write`)."
    );
  });

  it("put no status code in what the reader sees", () => {
    for (const status of [400, 401, 403, 404, 413, 429, 500, 502, 503, 504]) {
      expect(ownerRefusalNotice(status, false).text).not.toMatch(/\d/);
      expect(ownerRefusalNotice(status, true).text).not.toMatch(/\d/);
      expect(visitorRefusalNotice(null, status).text).not.toMatch(/\d/);
    }
  });
});
