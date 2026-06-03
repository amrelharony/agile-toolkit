/**
 * Tool-selection helpers that keep per-turn trimming correct: ranking against
 * the recent user context (so follow-ups keep their referents) and keeping every
 * tool the transcript already references (so the request body stays valid).
 */

import { describe, it, expect } from "vitest";
import { recentUserText, toolNamesInHistory } from "@/lib/agent/tool-selection";
import type {
  ChatMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
} from "@/lib/agent/types";

const text = (t: string): TextBlock => ({ type: "text", text: t });
const toolUse = (name: string): ToolUseBlock => ({
  type: "tool_use",
  id: `t_${name}`,
  name,
  input: {},
});
const toolResult = (): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "x",
  content: "{}",
});

let n = 0;
function msg(role: ChatMessage["role"], content: ContentBlock[]): ChatMessage {
  return { id: `m${n++}`, role, content, createdAt: new Date().toISOString() };
}

describe("recentUserText", () => {
  it("concatenates the last 2 user messages oldest-first, skipping non-user roles", () => {
    const msgs = [
      msg("user", [text("create a sprint called Sprint 47")]),
      msg("assistant", [toolUse("workspace_sprint_create")]),
      msg("tool", [toolResult()]),
      msg("user", [text("rename it")]),
    ];
    expect(recentUserText(msgs)).toBe("create a sprint called Sprint 47 rename it");
  });

  it("honours n", () => {
    const msgs = [
      msg("user", [text("one")]),
      msg("user", [text("two")]),
      msg("user", [text("three")]),
    ];
    expect(recentUserText(msgs, 2)).toBe("two three");
    expect(recentUserText(msgs, 1)).toBe("three");
  });

  it("returns '' when there are no user-text messages", () => {
    expect(recentUserText([])).toBe("");
    expect(recentUserText([msg("assistant", [text("hi")])])).toBe("");
  });
});

describe("toolNamesInHistory", () => {
  it("collects assistant tool_use names, deduped across turns", () => {
    const msgs = [
      msg("user", [text("go")]),
      msg("assistant", [text("ok"), toolUse("workspace_sprint_create")]),
      msg("tool", [toolResult()]),
      msg("assistant", [toolUse("workspace_sprint_create"), toolUse("workspace_story_create")]),
    ];
    expect(new Set(toolNamesInHistory(msgs))).toEqual(
      new Set(["workspace_sprint_create", "workspace_story_create"])
    );
  });

  it("returns [] when no tools were called", () => {
    expect(
      toolNamesInHistory([msg("user", [text("hi")]), msg("assistant", [text("hello")])])
    ).toEqual([]);
  });
});
