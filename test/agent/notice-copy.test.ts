/**
 * Every notice the agent client can show is narration about Amr, in the third
 * person, never words of his own: none says I, me or my (one Amr voice, DNA
 * §6), and none uses an em or en dash. The strings are collected from the
 * client's exported constants and by calling every builder over the cases it
 * knows, including the round-limit note that stands in for a wrap-up.
 */

import { describe, expect, it } from "vitest";
import {
  NOTICE_TEXT,
  VISITOR_ERROR_TEXT,
  endNoteFor,
  ownerRefusalNotice,
  roundLimitNote,
  roundLimitNotice,
  visitorRefusalNotice,
} from "@/lib/agent/client";
import type { ChatMessage } from "@/lib/agent/types";
import { VISITOR_LIMITS, VISITOR_TIME_LIMIT_FINISH } from "@/lib/visitor-ai/contract";
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
    }
  }
  return out;
}

describe("the client's notices", () => {
  const notices = everyNotice();

  it("are collected from every builder", () => {
    // The constants, the end notes, the refusals and the round-limit lines.
    expect(notices.length).toBeGreaterThan(100);
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
  });

  it("put no status code in what the reader sees", () => {
    for (const status of [400, 401, 403, 404, 413, 429, 500, 502, 503, 504]) {
      expect(ownerRefusalNotice(status, false).text).not.toMatch(/\d/);
      expect(ownerRefusalNotice(status, true).text).not.toMatch(/\d/);
      expect(visitorRefusalNotice(null, status).text).not.toMatch(/\d/);
    }
  });
});
