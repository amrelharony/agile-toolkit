// @vitest-environment node
/**
 * The golden test for pi-planning.roam: a canned answer gives a status per
 * risk, a bad item is dropped (and "resolved" is never taken from the
 * model), the keyword fallback answers every risk, the ask maps short ids
 * back to the board's items, and the byte fit keeps the largest ask (in
 * 3-byte text) under the route's budget.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET, TOOL_AI_VISITOR_MAX_BODY_BYTES } from "@/lib/ai/contract";
import {
  ROAM_NOTE_MAX,
  ROAM_RISKS_MAX,
  ROAM_TEAM_MAX,
  ROAM_TITLE_MAX,
  fitRoamInput,
  roamAskFor,
  roamAskId,
  roamItemId,
  roamTask,
} from "@/lib/ai/tasks/pi-planning";
import { roamTask as roamRef } from "@/lib/ai/tasks/pi-planning.lite";
import { roamPrompt } from "@/lib/ai/tasks/pi-planning.server";
import { jsonBytes } from "@/lib/utils/json-bytes";
import type { PiItem, PiState } from "@/lib/pi-planning/model";

const task = roamTask;

describe("pi-planning.roam", () => {
  it("is a small, quick task with room for 40 answers", () => {
    expect(task).toMatchObject({
      id: "pi-planning.roam",
      toolId: "pi-planning",
      tier: "flash",
      effort: "low",
      maxTokens: 8192,
    });
    expect(roamRef.fallback).toBe(task.fallback);
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '```json\n{"risks":[{"id":"r1","roam":"owned","reason":"Nobody has it yet.","action":"Name an owner today."},{"id":"r3","roam":"mitigated","reason":"The note is a plan.","action":"Check the date holds."}]}\n```',
      task.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        risks: [
          { id: "r1", roam: "owned", reason: "Nobody has it yet.", action: "Name an owner today." },
          {
            id: "r3",
            roam: "mitigated",
            reason: "The note is a plan.",
            action: "Check the date holds.",
          },
        ],
      },
    });
  });

  it("drops a resolved or an unknown status, and cuts a reason past its cap", () => {
    const parsed = parseAnswer(
      JSON.stringify({
        risks: [
          { id: "r1", roam: "resolved", reason: "Gone.", action: "Nothing." },
          { id: "r2", roam: "panic", reason: "x", action: "y" },
          { id: "r3", roam: "accepted", reason: "r".repeat(400), action: "y" },
          { id: "r4", roam: "accepted", reason: "Small.", action: "Live with it." },
          { id: "r5", roam: "owned", action: "No reason given." },
        ],
      }),
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.risks.map((r) => r.id)).toEqual(["r3", "r4"]);
      expect(parsed.data.risks[0].reason.length).toBeLessThanOrEqual(120);
      expect(parsed.data.risks[1]).toEqual({
        id: "r4",
        roam: "accepted",
        reason: "Small.",
        action: "Live with it.",
      });
    }
  });

  it("falls back to keyword rules for every risk", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.risks.map((r) => [r.id, r.roam])).toEqual([
      ["r1", "owned"],
      ["r2", "owned"],
      ["r3", "mitigated"],
    ]);
  });

  it("never answers a refused input with an output the schema refuses", () => {
    const out = roamRef.fallback({ risks: [{ id: "", title: "", team: "" }] });
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.risks).toEqual([]);
  });

  it("builds the prompt on the server, the risks inside the block", () => {
    const system = buildTaskSystem(task, roamPrompt);
    expect(system).toContain('"owned"');
    expect(system).toMatch(/Never answer "resolved"/);
    expect(
      buildTaskUser(roamPrompt, {
        risks: [
          { id: "r1", title: "PCI audit", team: "Checkout" },
          { id: "r2", title: "Store review", team: "", note: "Submit early" },
        ],
      })
    ).toBe(
      "<user_content>\nRisks:\nr1. PCI audit (team: Checkout)\nr2. Store review. Note: Submit early\n</user_content>"
    );
  });

  it("caps its input", () => {
    expect(task.input.safeParse({ risks: [] }).success).toBe(false);
    const many = Array.from({ length: ROAM_RISKS_MAX + 1 }, (_, i) => ({
      id: roamAskId(i).slice(0, 8),
      title: "x",
      team: "A",
    }));
    expect(task.input.safeParse({ risks: many }).success).toBe(false);
  });
});

describe("the ask", () => {
  const risk = (id: string, over: Partial<PiItem> = {}): PiItem => ({
    id,
    title: `Risk ${id}`,
    teamId: "t1",
    iteration: 0,
    kind: "risk",
    ...over,
  });
  const state: PiState = {
    teams: [{ id: "t1", name: "Checkout" }],
    items: [],
    iterations: 3,
  };

  it("sends short ids, the team's name and a note (or the description), and maps them back", () => {
    const ask = roamAskFor(state, [
      risk("abc", { roamNote: "We'll book the auditor" }),
      risk("blank", { title: "   " }), // nothing to ask about
      risk("def", { description: "Line one\nline two" }),
    ]);
    expect(ask.itemIds).toEqual(["abc", "def"]);
    expect(ask.input.risks).toEqual([
      { id: "r1", title: "Risk abc", team: "Checkout", note: "We'll book the auditor" },
      { id: "r2", title: "Risk def", team: "Checkout", note: "Line one line two" },
    ]);
    expect(task.input.safeParse(ask.input).success).toBe(true);
    expect(roamItemId(ask.itemIds, "r2")).toBe("def");
    expect(roamItemId(ask.itemIds, "r9")).toBeUndefined();
    expect(roamItemId(ask.itemIds, "abc")).toBeUndefined();
  });

  it("cuts long text to the task's caps and asks about 40 risks at most", () => {
    const long = Array.from({ length: 45 }, (_, i) =>
      risk(`i${i}`, { title: "t".repeat(300), roamNote: "n".repeat(900) })
    );
    const ask = roamAskFor({ ...state, teams: [{ id: "t1", name: "T".repeat(150) }] }, long);
    expect(ask.input.risks).toHaveLength(ROAM_RISKS_MAX);
    expect(ask.input.risks[0].title).toHaveLength(ROAM_TITLE_MAX);
    expect(ask.input.risks[0].team).toHaveLength(ROAM_TEAM_MAX);
    expect(ask.input.risks[0].note).toHaveLength(ROAM_NOTE_MAX);
    expect(task.input.safeParse(ask.input).success).toBe(true);
  });
});

describe("the byte fit", () => {
  // Every field at its cap in a script of three bytes a character.
  const wide = (n: number) => "字".repeat(n);
  const largest = () =>
    task.input.parse({
      risks: Array.from({ length: ROAM_RISKS_MAX }, (_, i) => ({
        id: roamAskId(i),
        title: wide(ROAM_TITLE_MAX),
        team: wide(ROAM_TEAM_MAX),
        note: wide(ROAM_NOTE_MAX),
      })),
    });

  it("trims the largest input to fit, notes first from the end", () => {
    const input = largest();
    expect(jsonBytes({ task: task.id, input })).toBeGreaterThan(TOOL_AI_VISITOR_MAX_BODY_BYTES);
    const fitted = fitRoamInput(input);
    expect(task.input.safeParse(fitted).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: fitted })).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
    // Dropping notes from the end is enough: every risk stays, the first keep theirs.
    expect(fitted.risks).toHaveLength(ROAM_RISKS_MAX);
    expect(fitted.risks[0].note).toBe(input.risks[0].note);
    expect(fitted.risks[ROAM_RISKS_MAX - 1].note).toBeUndefined();
  });

  it("drops whole risks from the end once the notes are gone", () => {
    const input = largest();
    const tight = fitRoamInput(input, 20_000);
    expect(jsonBytes({ task: task.id, input: tight })).toBeLessThanOrEqual(20_000);
    expect(tight.risks.length).toBeLessThan(ROAM_RISKS_MAX);
    expect(tight.risks.every((r) => r.note === undefined)).toBe(true);
    expect(tight.risks[0].id).toBe("r1");
  });

  it("leaves an input that already fits as it is", () => {
    const small = task.input.parse(task.sample);
    expect(fitRoamInput(small)).toBe(small);
  });
});
