// @vitest-environment node
/**
 * Golden tests for Root Cause's AI tasks: the prompt the server builds, a
 * typical model answer read into the output, a bad answer salvaged or
 * refused, and the fallbacks without a model.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import {
  categoriesTask,
  categoryFor,
  countermeasureTask,
  fallbackCategoryMoves,
  fallbackCountermeasures,
  fallbackNextWhys,
  nextWhyTask,
} from "@/lib/ai/tasks/root-cause";
import {
  categoriesPrompt,
  countermeasurePrompt,
  nextWhyPrompt,
} from "@/lib/ai/tasks/root-cause.server";

describe("root-cause.next_why", () => {
  it("is a quick task the owner and visitors can use", () => {
    expect(nextWhyTask).toMatchObject({ toolId: "root-cause", tier: "flash", maxTokens: 4096 });
    expect(nextWhyTask.ownerOnly).toBeUndefined();
  });

  it("sends the problem and the chain as data, blameless instructions around it", () => {
    const system = buildTaskSystem(nextWhyTask, nextWhyPrompt);
    expect(system).toContain("blameless 5 Whys");
    expect(system).toContain("never at a person");
    const user = buildTaskUser(nextWhyPrompt, nextWhyTask.input.parse(nextWhyTask.sample));
    expect(user).toContain("Problem: Two of the last three releases");
    expect(user).toContain("1. A database migration failed in production.");
  });

  it("reads a typical answer, and keeps three of too many", () => {
    const parsed = parseAnswer(
      '```json\n{"whys": ["Staging has a tiny seeded database.", "Nobody owns staging data.", "Migrations skip review.", "Fourth"]}\n```',
      nextWhyTask.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.whys).toHaveLength(3);
    expect(parseAnswer('{"whys": []}', nextWhyTask.output).ok).toBe(false);
  });

  it("falls back to three templates from the last answer, or the problem", () => {
    const out = fallbackNextWhys("Deploys fail", ["The migration broke."]);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("“The migration broke”");
    expect(fallbackNextWhys("Deploys fail", [])[1]).toContain("“Deploys fail”");
    expect(nextWhyTask.output.safeParse({ whys: out }).success).toBe(true);
  });
});

describe("root-cause.categories", () => {
  it("lists the categories and each cause by id", () => {
    const user = buildTaskUser(categoriesPrompt, categoriesTask.input.parse(categoriesTask.sample));
    expect(user).toContain("Categories: People, Process, Tools, Environment, Measurement, Other");
    expect(user).toContain("c1 | Other | No alert on the checkout error rate");
    expect(buildTaskSystem(categoriesTask, categoriesPrompt)).toContain(
      "Use only the category names given"
    );
  });

  it("reads the moves, dropping a malformed one", () => {
    const parsed = parseAnswer(
      JSON.stringify({ moves: [{ causeId: "c1", category: "Measurement" }, { causeId: "c2" }] }),
      categoriesTask.output
    );
    expect(parsed).toEqual({
      ok: true,
      data: { moves: [{ causeId: "c1", category: "Measurement" }] },
    });
  });

  it("places causes by their words without AI, only into categories the board has", () => {
    expect(categoryFor("No alert on the error rate")).toBe("Measurement");
    expect(categoryFor("The new joiner wasn't onboarded")).toBe("People");
    expect(categoryFor("Staging was down")).toBe("Environment");
    expect(categoryFor("Lunch")).toBeNull();
    const moves = fallbackCategoryMoves(
      ["People", "Process", "Measurement"],
      [
        { id: "a", text: "No alert on errors", category: "Other" },
        { id: "b", text: "No alert either", category: "Measurement" },
        { id: "c", text: "Staging was down", category: "Other" },
      ]
    );
    expect(moves).toEqual([{ causeId: "a", category: "Measurement" }]);
    const sample = categoriesTask.fallback(categoriesTask.input.parse(categoriesTask.sample));
    expect(sample.moves.map((m) => m.causeId).sort()).toEqual(["c1", "c2", "c3"]);
  });
});

describe("root-cause.countermeasure", () => {
  it("reasons with the bigger model, from the root cause and the chain", () => {
    expect(countermeasureTask).toMatchObject({ tier: "full", effort: "high" });
    const user = buildTaskUser(
      countermeasurePrompt,
      countermeasureTask.input.parse(countermeasureTask.sample)
    );
    expect(user).toContain("Root cause: Migrations are only tested on a small, seeded database.");
    expect(user).toContain("Other causes found:");
    expect(buildTaskSystem(countermeasureTask, countermeasurePrompt)).toContain('"check"');
  });

  it("reads countermeasures with their checks, and refuses one without a check", () => {
    const good = parseAnswer(
      JSON.stringify({
        countermeasures: [{ text: "Rehearse on a copy", check: "No rollback in 3 releases" }],
      }),
      countermeasureTask.output
    );
    expect(good.ok).toBe(true);
    expect(
      parseAnswer(JSON.stringify({ countermeasures: [{ text: "x" }] }), countermeasureTask.output)
        .ok
    ).toBe(false);
  });

  it("falls back to three countermeasures built from the root cause", () => {
    const out = fallbackCountermeasures("No owner for staging data.");
    expect(out).toHaveLength(3);
    for (const c of out) {
      expect(c.check.length).toBeGreaterThan(10);
    }
    expect(out[1].text).toContain("“No owner for staging data”");
  });
});
