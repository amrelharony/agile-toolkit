/**
 * The owner's Details on a tool step, in words (src/lib/agent/tool-details.ts):
 * the arguments and the result as `Name: value` fields, or a sentence, never
 * JSON, a key as written in code or a record's id.
 */

import { describe, expect, it } from "vitest";
import { DETAIL_LINES, inputDetail, resultDetail } from "@/lib/agent/tool-details";
import type { ToolResultBlock } from "@/lib/agent/types";

const result = (content: string, isError = false): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "c1",
  content,
  ...(isError && { is_error: true }),
});

const said = (d: ReturnType<typeof inputDetail>) =>
  d.note ?? d.lines.map((l) => `${l.name}: ${l.value}`).join(" · ");

describe("inputDetail", () => {
  it("says each argument in words, with code words as words and ids left out", () => {
    const d = inputDetail({
      text: "flaky CI",
      columnKey: "went-well",
      sprintId: "s-12",
      votes: 3,
      anonymous: false,
      tags: ["ci", "build"],
    });
    expect(said(d)).toBe(
      "Text: “flaky CI” · Column: Went well · Votes: 3 · Anonymous: no · Tags: “ci”, “build”"
    );
    expect(d.more).toBe(0);
  });

  it("stands an object's fields in for it one level down, and counts a list of ids", () => {
    const d = inputDetail({ patch: { title: "Sprint 12", goal: { text: "deep" } }, ids: [1, 2] });
    expect(said(d)).toBe("Title: “Sprint 12” · Items: 2");
  });

  it("drops a UUID under any key, and cuts a long value", () => {
    const d = inputDetail({
      chosen: "0b5c1f0e-1234-4abc-9def-1234567890ab",
      text: "x".repeat(200),
    });
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0].value.length).toBeLessThanOrEqual(82);
    expect(d.lines[0].value).toMatch(/…”$/);
  });

  it("lists at most DETAIL_LINES fields and counts the rest", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`field${n}`, n]));
    const d = inputDetail(many);
    expect(d.lines).toHaveLength(DETAIL_LINES);
    expect(d.more).toBe(12 - DETAIL_LINES);
  });

  it("says in a sentence when there is nothing to list", () => {
    expect(inputDetail({}).note).toBe("It took no arguments.");
    expect(inputDetail({ _partial: true }).note).toBe("Its arguments never arrived whole.");
    expect(inputDetail({ _truncated: '{"text":"…' }).note).toMatch(/too long to keep/);
    expect(inputDetail({ id: "k1" }).note).toBe("Only record ids, left out here.");
  });
});

describe("resultDetail", () => {
  it("says a handler's JSON in words", () => {
    expect(said(resultDetail(result('{"added":true,"id":"k1"}')))).toBe("Added: yes");
    expect(said(resultDetail(result('{"cards":[{"a":1},{"a":2}],"retro":{"title":"R1"}}')))).toBe(
      "Cards: 2 items · Title: “R1”"
    );
    expect(said(resultDetail(result('{"added":false,"reason":"no_retro"}')))).toBe(
      "Added: no · Reason: No retro"
    );
    expect(resultDetail(result("null")).note).toBe("Nothing came back.");
    expect(resultDetail(result("[1,2,3,4]")).note).toBe("It came back with 4 items.");
  });

  it("says why a call didn't run or didn't work, never the string written for the model", () => {
    const cases: Array<[string, string]> = [
      ["User denied execution of tool.retro.add_card.", "It didn't run."],
      ["Tool not available: tool_retro_add_card", "It isn't available here, so it didn't run."],
      ["Cancelled.", "It was stopped before it finished."],
      ["Handler error: Handler timeout after 30000ms", "It took too long, so it was stopped."],
      ["Handler error: Retro not found", "Retro not found"],
      [
        "Invalid input for tool.retro.add_card: [bad]",
        "Its arguments didn't fit what the tool takes.",
      ],
    ];
    for (const [content, words] of cases) {
      const d = resultDetail(result(content, true));
      expect(d.note, content).toBe(words);
      expect(d.note, content).not.toMatch(/tool[._]retro/);
    }
  });

  it("never writes a brace, a key as written in code or an id", () => {
    const d = resultDetail(
      result('{"ok":true,"item":{"id":"k9","sprintId":"s1","storyPoints":5},"itemIds":["a","b"]}')
    );
    const words = said(d);
    expect(words).toBe("Ok: yes · Story points: 5 · Items: 2");
    expect(words).not.toMatch(/[{}]|k9|sprintId/);
  });
});
