// @vitest-environment node
/**
 * The golden test for sprint.risk_note: a canned answer gives the note, a
 * note past the cap or empty is refused (the runner then answers without
 * AI), and the fallback is the rule's own sentences, inside the cap.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { RISK_NOTE_MAX, sprintRiskNoteTask } from "@/lib/ai/tasks/sprint";
import { sprintRiskNotePrompt } from "@/lib/ai/tasks/sprint.server";

const task = sprintRiskNoteTask;

describe("sprint.risk_note", () => {
  it("is a small, quick task with a single answer", () => {
    expect(task).toMatchObject({ toolId: "sprint", tier: "flash", effort: "low", maxTokens: 2048 });
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '```json\n{"note":"The goal is at risk because the pace points to day 13. Agree what to drop with the Product Owner today, and unblock the two stuck stories first."}\n```',
      task.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        note: "The goal is at risk because the pace points to day 13. Agree what to drop with the Product Owner today, and unblock the two stuck stories first.",
      },
    });
  });

  it("refuses an empty note and shortens one past the cap", () => {
    expect(parseAnswer('{"note":"  "}', task.output).ok).toBe(false);
    const long = parseAnswer(JSON.stringify({ note: "x".repeat(RISK_NOTE_MAX + 50) }), task.output);
    expect(long.ok).toBe(true);
    if (long.ok) {
      expect(long.data.note).toHaveLength(RISK_NOTE_MAX);
      expect(long.data.note.endsWith("…")).toBe(true);
    }
  });

  it("answers without AI from the rule's reasons", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    expect(out.note).toBe(
      "The sprint goal is at risk. At this pace the work left finishes around day 13, after the last day (day 10). 2 stories are blocked on the board. Try this: agree with the Product Owner what to drop or split, so the part that meets the goal lands."
    );
  });

  it("keeps the fallback inside the cap however long the reasons are", () => {
    const long = "A very long reason that keeps going. ".repeat(7).trim().slice(0, 300);
    const out = task.fallback(
      task.input.parse({
        ...task.sample,
        reasons: [
          { level: "at_risk", text: long, tryThis: long },
          { level: "watch", text: long, tryThis: long },
        ],
      })
    );
    expect(out.note.length).toBeLessThanOrEqual(RISK_NOTE_MAX);
    expect(task.output.safeParse(out).success).toBe(true);
  });

  it("says on track in one sentence without reasons", () => {
    const out = task.fallback(
      task.input.parse({
        ...task.sample,
        level: "none",
        headline: "The sprint goal looks on track: nothing puts it at risk today.",
        reasons: [],
      })
    );
    expect(out.note).toBe("The sprint goal looks on track: nothing puts it at risk today.");
  });

  it("builds the prompt on the server, the facts inside the block", () => {
    expect(buildTaskSystem(task, sprintRiskNotePrompt)).toContain("2 or 3 plain sentences");
    const user = buildTaskUser(sprintRiskNotePrompt, task.input.parse(task.sample));
    expect(user).toContain("Sprint goal: Customers can pay with a saved card");
    expect(user).toContain("Day 6 of 10");
    expect(user).toContain("1. (at risk) At this pace");
    expect(user.startsWith("<user_content>\n")).toBe(true);
  });

  it("caps its input", () => {
    const reasons = Array.from({ length: 10 }, () => task.sample.reasons[0]);
    expect(task.input.safeParse({ ...task.sample, reasons }).success).toBe(false);
    expect(task.input.safeParse({ ...task.sample, sprint: "x".repeat(121) }).success).toBe(false);
  });
});
