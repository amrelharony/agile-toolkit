/**
 * The tools a visitor's chat offers the model (visitor AI), on the real
 * registry (~830 actions, via register-all):
 *
 *  - never the whole registry, and never more than VISITOR_LIMITS.maxTools;
 *  - never a canvas action (they broadcast to live room peers), not even one
 *    the visitor's words rank first;
 *  - the open page's actions, even when the words rank something else (or
 *    nothing at all);
 *  - every tool the history already called, even when ranking and the page
 *    fill the list (the request replays those calls);
 *  - nothing new for a plain question.
 */

import { describe, expect, it } from "vitest";
import "@/lib/actions/register-all";
import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { rankActionIds } from "@/lib/agent/mascot/kb";
import {
  RANKED_FIRST,
  buildVisitorTurnTools,
  isPlainQuestion,
  isVisitorAction,
  selectVisitorToolIds,
} from "@/lib/agent/visitor-tools";
import { VISITOR_LIMITS } from "@/lib/visitor-ai/contract";
import type { ChatMessage } from "@/lib/agent/types";

const user = (text: string, id = "u1"): ChatMessage => ({
  id,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: "2026-11-09T08:00:00Z",
});

const assistantCall = (name: string, id = "a1"): ChatMessage => ({
  id,
  role: "assistant",
  content: [{ type: "tool_use", id: `call_${id}`, name, input: {} }],
  createdAt: "2026-11-09T08:00:01Z",
});

const toolResult = (callId: string, id = "t1"): ChatMessage => ({
  id,
  role: "tool",
  content: [{ type: "tool_result", tool_use_id: callId, content: "{}" }],
  createdAt: "2026-11-09T08:00:02Z",
});

const names = (text: string, toolId: string | null, history: ChatMessage[] = []) =>
  buildVisitorTurnTools(text, [...history, user(text, "latest")], toolId).map(
    (t) => t.function.name
  );

describe("isVisitorAction", () => {
  it("is false for every canvas action and true by default", () => {
    const canvas = registry.list().filter((a) => a.toolId === "tool.canvas");
    expect(canvas.length).toBeGreaterThan(0);
    for (const a of canvas) expect(isVisitorAction(a), a.id).toBe(false);
    expect(isVisitorAction(registry.get("tool.retro.add_card")!)).toBe(true);
    expect(isVisitorAction({})).toBe(true);
  });

  it("leaves only the canvas actions closed to visitors", () => {
    const closed = registry
      .list()
      .filter((a) => !isVisitorAction(a))
      .map((a) => a.id);
    expect(closed.every((id) => id.startsWith("tool.canvas."))).toBe(true);
  });
});

describe("isPlainQuestion", () => {
  it.each([
    "How do I run a retro?",
    "What is WSJF?",
    "why do teams estimate in points",
    "Explain the Cynefin framework",
    "Is RICE better than ICE?",
  ])("treats %j as a plain question", (text) => {
    expect(isPlainQuestion(text)).toBe(true);
  });

  it.each([
    "add a card 'flaky CI'",
    "What's in my backlog?",
    "How do I add a card here?",
    "Rename the sprint to Sprint 48",
    "yes please",
    "",
  ])("does not treat %j as a plain question", (text) => {
    expect(isPlainQuestion(text)).toBe(false);
  });
});

describe("buildVisitorTurnTools on the real registry", () => {
  const total = registry.list().length;

  it.each([
    ["add a card 'flaky CI'", "retro"],
    ["add a sticky to my canvas board", "canvas"],
    ["create a sprint and add stories to my backlog", null],
    ["list everything in my workspace: risks, okrs, impediments, decisions", "sprint"],
  ] as const)("offers at most maxTools for %j on %s, never the full set", (text, toolId) => {
    const offered = names(text, toolId);
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThanOrEqual(VISITOR_LIMITS.maxTools);
    expect(offered.length).toBeLessThan(total);
    expect(new Set(offered).size).toBe(offered.length);
  });

  it("never offers a canvas action, even the one the words rank first", () => {
    const text = "add a sticky to my canvas board";
    expect(rankActionIds(text, 1)[0]).toMatch(/^tool\.canvas\./);
    const offered = names(text, "canvas");
    expect(offered.some((n) => n.startsWith("tool_canvas_"))).toBe(false);
    // The page's own (non-canvas) data still gets its actions.
    expect(offered).toContain("workspace_whiteboard_list");
  });

  it("offers the open page's actions", () => {
    const offered = names("add a card 'flaky CI'", "retro");
    expect(offered).toContain("tool_retro_add_card");
    expect(offered).toContain("tool_retro_list_state");
    expect(offered).toContain("workspace_retro_board_list");
  });

  it("falls back to the page's actions when the words rank nothing", () => {
    const offered = names("zzqx", "retro");
    expect(offered).toContain("tool_retro_add_card");
    expect(offered.every((n) => /retro/.test(n))).toBe(true);
    // Off a tool page, nothing to fall back on: no tools.
    expect(names("zzqx", null)).toEqual([]);
  });

  it("accepts the page as a path", () => {
    expect(names("zzqx", "/retro")).toContain("tool_retro_add_card");
  });

  it("offers nothing for a plain question", () => {
    expect(names("How do I run a retro?", "retro")).toEqual([]);
    expect(names("What is WSJF?", null)).toEqual([]);
  });

  it("keeps every tool the history called, even past a full list", () => {
    // An action nothing else this turn would pick.
    const obscure = "tool.token_cost_tracker.list_state";
    expect(registry.get(obscure)).toBeDefined();
    const history = [
      user("how much did we spend on tokens", "u0"),
      assistantCall(claudeNameFromId(obscure)),
      toolResult("call_a1"),
    ];
    const text = "add a card 'flaky CI'";
    const offered = names(text, "retro", history);
    expect(offered).toContain(claudeNameFromId(obscure));
    expect(offered.length).toBeLessThanOrEqual(VISITOR_LIMITS.maxTools);
    // A plain question keeps the history's tools and adds nothing.
    expect(names("What is WSJF?", "retro", history)).toEqual([claudeNameFromId(obscure)]);
  });

  it("drops a canvas call from history instead of offering it", () => {
    const history = [
      user("add a sticky", "u0"),
      assistantCall("tool_canvas_add_sticky"),
      toolResult("call_a1"),
    ];
    expect(names("What is WSJF?", null, history)).toEqual([]);
  });
});

describe("selectVisitorToolIds", () => {
  const actions = Array.from({ length: 60 }, (_, i) => ({
    id: `tool.fake.a${i}`,
    toolId: "tool.fake",
    category: i % 2 ? "write" : "read",
  }));
  const ids = actions.map((a) => a.id);

  it("keeps history slots back, then ranked, then the page, then the rest of the ranked", () => {
    const picked = selectVisitorToolIds({
      actions: [...actions, { id: "tool.page.read", toolId: "tool.page", category: "read" }],
      rankedIds: ids.slice(0, 40),
      toolId: "page",
      historyIds: ["tool.fake.a59", "tool.fake.a58"],
      max: 24,
    });
    expect(picked).toHaveLength(24);
    expect(picked.slice(-2)).toEqual(["tool.fake.a59", "tool.fake.a58"]);
    expect(picked.slice(0, RANKED_FIRST)).toEqual(ids.slice(0, RANKED_FIRST));
    expect(picked[RANKED_FIRST]).toBe("tool.page.read");
  });

  it("never exceeds VISITOR_LIMITS.maxTools, whatever max asks for", () => {
    const picked = selectVisitorToolIds({ actions, rankedIds: ids, max: 500 });
    expect(picked).toHaveLength(VISITOR_LIMITS.maxTools);
  });

  it("skips unknown ids and actions closed to visitors", () => {
    const picked = selectVisitorToolIds({
      actions: [...actions.slice(0, 2), { id: "tool.x.closed", category: "write", visitor: false }],
      rankedIds: ["tool.nope", "tool.x.closed", "tool.fake.a0"],
      historyIds: ["tool.x.closed", "tool.gone"],
    });
    expect(picked).toEqual(["tool.fake.a0"]);
  });
});
