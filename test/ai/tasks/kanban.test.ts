// @vitest-environment node
/**
 * The golden test for kanban.policies: a canned answer gives policies per
 * stage, a bad item is dropped and a policy for a stage the board doesn't
 * have (or Done) never reaches the page, the fallback gives the starter
 * templates, and the largest input fits the route's budget in 3-byte text.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  POLICY_LABEL_MAX,
  POLICY_NOTE_MAX,
  POLICY_STAGE_MAX,
  POLICY_STAGES_MAX,
  POLICY_TEXT_MAX,
  cleanPoliciesAnswer,
  kanbanPoliciesTask,
  type PoliciesInput,
} from "@/lib/ai/tasks/kanban";
import { kanbanPoliciesPrompt } from "@/lib/ai/tasks/kanban.server";
import { kanbanPoliciesTask as liteTask } from "@/lib/ai/tasks/kanban.lite";
import { POLICY_TEMPLATES, START_TEMPLATE, STATIK_QUESTIONS } from "@/lib/kanban/statik";
import { policiesInput } from "@/app/(tools)/kanban/workflow/ai-input";
import { draftFromWorkflow } from "@/app/(tools)/kanban/workflow/form";

const task = kanbanPoliciesTask;
const sample = task.input.parse(task.sample);

describe("kanban.policies", () => {
  it("is a short reasoning task with a list answer", () => {
    expect(task).toMatchObject({ tier: "full", effort: "low", maxTokens: 4096 });
    expect(liteTask.id).toBe(task.id);
  });

  it("reads a typical model answer", () => {
    const parsed = parseAnswer(
      '```json\n{"policies":[{"stage":"ready","enter":"Picked at replenishment","exit":"Pulled when WIP allows"},{"stage":"review","exit":"Checked by someone else"}],"startPoint":"Pulled into In progress","finishPoint":"Meets the DoD","blockerPolicy":"Flag it the same day","questions":["Who replenishes Ready?"]}\n```',
      task.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: {
        policies: [
          { stage: "ready", enter: "Picked at replenishment", exit: "Pulled when WIP allows" },
          { stage: "review", exit: "Checked by someone else" },
        ],
        startPoint: "Pulled into In progress",
        finishPoint: "Meets the DoD",
        blockerPolicy: "Flag it the same day",
        questions: ["Who replenishes Ready?"],
      },
    });
  });

  it("drops a policy with no stage and cuts one that runs long", () => {
    const parsed = parseAnswer(
      `{"policies":[{"stage":"","enter":"x"},{"stage":"review","exit":"${"y".repeat(250)}"},{"stage":"ready","enter":"Picked"}]}`,
      task.output
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.policies.map((p) => p.stage)).toEqual(["review", "ready"]);
    expect(parsed.data.policies[0].exit!.length).toBeLessThanOrEqual(POLICY_TEXT_MAX);
  });

  it("keeps only stages the board sent, never Done, one each, in board order", () => {
    const out = cleanPoliciesAnswer(
      {
        policies: [
          { stage: "review", exit: "Checked" },
          { stage: "done", enter: "Shipped" },
          { stage: "testing", enter: "Not a column" },
          { stage: "ready", enter: "Picked" },
          { stage: "review", exit: "Twice" },
          { stage: "in_progress", enter: "  " },
        ],
        startPoint: "  ",
        questions: [" Who pulls? ", ""],
      },
      sample
    );
    expect(out).toEqual({
      policies: [
        { stage: "ready", enter: "Picked" },
        { stage: "review", exit: "Checked" },
      ],
      questions: ["Who pulls?"],
    });
  });

  it("falls back to the templates for each stage still missing a policy", () => {
    const out = task.fallback(sample);
    expect(task.output.safeParse(out).success).toBe(true);
    // Review already has an exit but no entry, so it still gets a template.
    expect(out.policies.map((p) => p.stage)).toEqual(["backlog", "ready", "in_progress", "review"]);
    expect(out.policies[3]).toEqual({ stage: "review", ...POLICY_TEMPLATES.review });
    expect(out.startPoint).toBe(START_TEMPLATE);
    expect(out.questions).toEqual([...STATIK_QUESTIONS]);
    const full = task.fallback({
      ...sample,
      existing: [{ stage: "backlog", enter: "In", exit: "Out" }],
    });
    expect(full.policies.map((p) => p.stage)).not.toContain("backlog");
    // A stage the templates don't know still gets a policy in our words.
    const odd = task.fallback({ ...sample, stages: [{ stage: "qa", label: "QA", wip: 2 }] });
    expect(odd.policies[0].stage).toBe("qa");
    expect(task.output.safeParse(odd).success).toBe(true);
  });

  it("builds the prompt on the server, the board inside the block", () => {
    expect(buildTaskSystem(task, kanbanPoliciesPrompt)).toContain("never Done");
    const user = buildTaskUser(kanbanPoliciesPrompt, sample);
    expect(user.startsWith("<user_content>\nBoard: Flow board")).toBe(true);
    expect(user).toContain("- review (Review): WIP limit 2");
    expect(user).toContain("- backlog (Backlog): no WIP limit");
    expect(user).toContain("Classes of service in use: standard, expedite (jumps the queue)");
  });

  it("caps its input", () => {
    expect(task.input.safeParse({ ...sample, stages: [] }).success).toBe(false);
    const seven = Array.from({ length: 7 }, (_, i) => ({ stage: `s${i}`, label: "S", wip: null }));
    expect(task.input.safeParse({ ...sample, stages: seven }).success).toBe(false);
    expect(
      task.input.safeParse({ ...sample, notes: { inside: "x".repeat(POLICY_NOTE_MAX + 1) } })
        .success
    ).toBe(false);
  });

  it("fits the route's body budget at its caps, in 3-byte text", () => {
    const cjk = (n: number) => "界".repeat(n);
    const largest: PoliciesInput = {
      board: "flow",
      workItem: cjk(POLICY_TEXT_MAX),
      stages: Array.from({ length: POLICY_STAGES_MAX }, (_, i) => ({
        stage: `${i}${cjk(POLICY_STAGE_MAX - 1)}`,
        label: cjk(POLICY_LABEL_MAX),
        wip: 999,
      })),
      notes: {
        inside: cjk(POLICY_NOTE_MAX),
        outside: cjk(POLICY_NOTE_MAX),
        demand: cjk(POLICY_NOTE_MAX),
        capability: cjk(POLICY_NOTE_MAX),
      },
      existing: Array.from({ length: POLICY_STAGES_MAX }, (_, i) => ({
        stage: `${i}${cjk(POLICY_STAGE_MAX - 1)}`,
        enter: cjk(POLICY_TEXT_MAX),
        exit: cjk(POLICY_TEXT_MAX),
      })),
      classes: ["standard", "expedite", "fixed_date", "intangible"],
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    expect(jsonBytes({ task: task.id, input: largest })).toBeLessThan(TOOL_AI_BODY_BUDGET);
  });

  it("gets a valid input from the page's draft, whatever was typed", () => {
    const draft = draftFromWorkflow(null, "flow");
    draft.workItem = "w".repeat(500);
    draft["enter:review"] = "e".repeat(500);
    const input = policiesInput({
      board: "flow",
      draft,
      statik: { inside: "i".repeat(5000), rollout: "not sent" },
      wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
      cards: [{ id: "a", title: "A", column: "ready", class: "expedite", createdAt: "2026-11-01" }],
    });
    expect(task.input.safeParse(input).success).toBe(true);
    expect(input.stages.map((s) => [s.stage, s.wip])).toEqual([
      ["backlog", null],
      ["ready", 5],
      ["in_progress", 3],
      ["review", 2],
    ]);
    expect(input.classes).toEqual(["expedite"]);
    expect(input.notes).not.toHaveProperty("rollout");
    const sprint = policiesInput({
      board: "sprint",
      draft: draftFromWorkflow(null, "sprint"),
      statik: undefined,
      wipLimits: { backlog: 0, ready: 4, in_progress: 3, review: 2, done: 0 },
      cards: [],
    });
    // To do shares Ready's limit; stories have no classes of service.
    expect(sprint.stages[0]).toEqual({ stage: "todo", label: "To do", wip: 4 });
    expect(sprint.classes).toEqual([]);
  });
});
