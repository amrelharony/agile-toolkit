// @vitest-environment node
/**
 * Golden tests for Root Cause's AI tasks: the prompt the server builds, a
 * typical model answer read into the output, a bad answer salvaged or
 * refused, and the fallbacks without a model.
 */

import { describe, expect, it } from "vitest";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { getAiTask } from "@/lib/ai/registry";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import {
  LOOP_LINKS_INPUT_MAX,
  LOOP_LINKS_MAX,
  LOOP_LINK_WHY_MAX,
  categoriesTask,
  categoryFor,
  countermeasureTask,
  fallbackCategoryMoves,
  fallbackCountermeasures,
  fallbackLoopLinks,
  fallbackNextWhys,
  guessPolarity,
  loopLinksTask,
  nextWhyTask,
} from "@/lib/ai/tasks/root-cause";
import {
  fitCategoriesInput,
  fitNextWhyInput,
  loopLinksTask as loopLinksRef,
} from "@/lib/ai/tasks/root-cause.lite";
import {
  categoriesPrompt,
  countermeasurePrompt,
  loopLinksPrompt,
  nextWhyPrompt,
} from "@/lib/ai/tasks/root-cause.server";
import { jsonBytes } from "@/lib/utils/json-bytes";

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
    // The page sends the title and the fact: before the first why, only the title is quoted.
    const first = fallbackNextWhys(
      "Releases rolled back the same day. Three of the last five releases were rolled back.",
      []
    );
    expect(first[0]).toBe(
      "No check caught “Releases rolled back the same day” before it went further."
    );
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

describe("the largest inputs in 3-byte text", () => {
  const wide = (n: number) => "界".repeat(n);
  const fits = (task: string, input: unknown) => jsonBytes({ task, input }) <= TOOL_AI_BODY_BUDGET;

  it("next_why: a full chain is trimmed from its oldest whys, keeping the problem and the last", () => {
    const largest = {
      problem: wide(1000),
      whys: Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(1000, "界")),
    };
    expect(nextWhyTask.input.safeParse(largest).success).toBe(true);
    expect(fits(nextWhyTask.id, largest)).toBe(false);
    const fitted = fitNextWhyInput(largest);
    expect(fits(nextWhyTask.id, fitted)).toBe(true);
    expect(fitted.problem).toBe(largest.problem);
    expect(fitted.whys[fitted.whys.length - 1]).toBe(largest.whys[19]);
    expect(fitted.whys.length).toBeGreaterThan(15);
    // A chain that fits goes as it is.
    const small = nextWhyTask.input.parse(nextWhyTask.sample);
    expect(fitNextWhyInput(small)).toBe(small);
  });

  it("categories: a full board is trimmed from its end, keeping at least one cause", () => {
    const largest = {
      problem: wide(1000),
      categories: Array.from({ length: 12 }, (_, i) => `${i}`.padEnd(60, "界")),
      causes: Array.from({ length: 100 }, (_, i) => ({
        id: `${i}`.padEnd(64, "界"),
        text: wide(1000),
        category: wide(60),
      })),
    };
    expect(categoriesTask.input.safeParse(largest).success).toBe(true);
    expect(fits(categoriesTask.id, largest)).toBe(false);
    const fitted = fitCategoriesInput(largest);
    expect(fits(categoriesTask.id, fitted)).toBe(true);
    expect(categoriesTask.input.safeParse(fitted).success).toBe(true);
    expect(fitted.causes[0]).toBe(largest.causes[0]);
    // It keeps as many as fit: one more would not.
    const more = { ...fitted, causes: largest.causes.slice(0, fitted.causes.length + 1) };
    expect(fits(categoriesTask.id, more)).toBe(false);
    const small = categoriesTask.input.parse(categoriesTask.sample);
    expect(fitCategoriesInput(small)).toBe(small);
  });
});

describe("root-cause.loop_links", () => {
  const wide = (n: number) => "界".repeat(n);

  it("is a quick task the owner and visitors can use, registered with the others", () => {
    expect(loopLinksTask).toMatchObject({
      id: "root-cause.loop_links",
      toolId: "root-cause",
      tier: "flash",
      effort: "low",
      maxTokens: 4096,
    });
    expect(loopLinksTask.ownerOnly).toBeUndefined();
    expect(getAiTask("root-cause.loop_links")).toBe(loopLinksTask);
    expect(loopLinksRef.id).toBe(loopLinksTask.id);
    expect(loopLinksRef.fallback).toBe(loopLinksTask.fallback);
  });

  it("sends the things by id and the arrows drawn as data, with the sign rules around them", () => {
    const system = buildTaskSystem(loopLinksTask, loopLinksPrompt);
    expect(system).toContain('"same"');
    expect(system).toContain('"opposite"');
    expect(system).toContain("Never suggest an arrow already drawn");
    const user = buildTaskUser(loopLinksPrompt, loopLinksTask.input.parse(loopLinksTask.sample));
    expect(user).toContain("Problem: Checkout errors noticed late.");
    expect(user).toContain("e | Checkout errors customers see");
    expect(user).toContain("e -> t, same (Checkout errors customers see -> Support tickets)");
    const none = buildTaskUser(loopLinksPrompt, {
      ...loopLinksTask.input.parse(loopLinksTask.sample),
      links: [],
    });
    expect(none).toContain("Arrows already drawn: (none yet)");
  });

  it("refuses an input with fewer than two things", () => {
    const one = { problem: "P", nodes: [{ id: "a", text: "A" }], links: [] };
    expect(loopLinksTask.input.safeParse(one).success).toBe(false);
  });

  it("reads a typical answer, drops a malformed arrow, and keeps ten of too many", () => {
    const answer = {
      links: [
        {
          from: "f",
          to: "a",
          polarity: "opposite",
          delay: true,
          why: "Firefighting crowds out alerts.",
        },
        { from: "a", polarity: "same", why: "No to" },
        { from: "a", to: "e", polarity: "sideways", why: "Bad sign" },
      ],
    };
    const parsed = parseAnswer(
      `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
      loopLinksTask.output
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.links).toEqual([answer.links[0]]);
    const many = {
      links: Array.from({ length: 14 }, (_, i) => ({
        from: `n${i}`,
        to: `n${i + 1}`,
        polarity: "same",
        why: "Check it.",
      })),
    };
    const capped = parseAnswer(JSON.stringify(many), loopLinksTask.output);
    expect(capped.ok && capped.data.links.length).toBe(LOOP_LINKS_MAX);
    // No new arrow is a fair answer.
    expect(parseAnswer('{"links": []}', loopLinksTask.output).ok).toBe(true);
  });

  it("falls back to a chain through the first things and one arrow back, signed by their words", () => {
    const nodes = [
      { id: "e", text: "Checkout errors" },
      { id: "t", text: "Support tickets" },
      { id: "f", text: "Time firefighting" },
      { id: "a", text: "Fewer alerts" },
    ];
    const out = fallbackLoopLinks(nodes, []);
    expect(out.map((l) => `${l.from}>${l.to}:${l.polarity}`)).toEqual([
      "e>t:same",
      "t>f:same",
      "f>a:opposite",
      "a>e:opposite",
    ]);
    expect(out[0].why).toBe(
      "Check the sign: does “Support tickets” go up when “Checkout errors” goes up?"
    );
    expect(out[2].why).toContain("go down when");
    expect(out[3].why).toBe("If this is true, it closes a loop: check it.");
    expect(guessPolarity("No alert", "Slow reviews")).toBe("same");
    expect(guessPolarity("Missing tests", "Bugs")).toBe("opposite");
  });

  it("skips pairs linked either way, and the arrow back when its ends are linked", () => {
    const nodes = ["a", "b", "c"].map((id) => ({ id, text: id.toUpperCase() }));
    const out = fallbackLoopLinks(nodes, [
      { from: "b", to: "a" },
      { from: "a", to: "c" },
    ]);
    expect(out.map((l) => `${l.from}>${l.to}`)).toEqual(["b>c"]);
  });

  it("closes a two-thing loop, and never offers more than ten arrows or a loop past twelve", () => {
    const two = fallbackLoopLinks(
      [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      []
    );
    expect(two.map((l) => `${l.from}>${l.to}`)).toEqual(["a>b", "b>a"]);
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, text: `Thing ${i}` }));
    const out = fallbackLoopLinks(nodes, []);
    expect(out).toHaveLength(LOOP_LINKS_MAX);
    expect(out[out.length - 1]).toMatchObject({ from: "n9", to: "n0" });
    expect(new Set(out.flatMap((l) => [l.from, l.to])).size).toBeLessThanOrEqual(12);
  });

  it("always answers inside its output schema, even with the longest words", () => {
    const sample = loopLinksTask.fallback(loopLinksTask.input.parse(loopLinksTask.sample));
    expect(loopLinksTask.output.safeParse(sample).success).toBe(true);
    const nodes = Array.from({ length: 30 }, (_, i) => ({
      id: `${i}`.padStart(LOOP_LINKS_INPUT_MAX.id, "x"),
      text: wide(LOOP_LINKS_INPUT_MAX.node),
    }));
    const out = loopLinksTask.fallback({ problem: wide(1000), nodes, links: [] });
    expect(loopLinksTask.output.safeParse(out).success).toBe(true);
    for (const l of out.links) expect(l.why.length).toBeLessThanOrEqual(LOOP_LINK_WHY_MAX);
    // A thing whose id the schema would refuse is left out, never echoed.
    const odd = fallbackLoopLinks(
      [
        { id: "x".repeat(65), text: "Too long an id" },
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      []
    );
    expect(odd.every((l) => l.from.length <= 64 && l.to.length <= 64)).toBe(true);
  });

  it("fits the body budget at its caps in 3-byte text, so it needs no fitter", () => {
    const I = LOOP_LINKS_INPUT_MAX;
    const id = (i: number) => `${wide(I.id - 2)}${String(i % I.nodes).padStart(2, "0")}`;
    const largest = {
      problem: wide(I.problem),
      nodes: Array.from({ length: I.nodes }, (_, i) => ({ id: id(i), text: wide(I.node) })),
      links: Array.from({ length: I.links }, (_, i) => ({
        from: id(i),
        to: id(i + 1),
        polarity: "opposite" as const,
      })),
    };
    expect(loopLinksTask.input.safeParse(largest).success).toBe(true);
    expect(jsonBytes({ task: loopLinksTask.id, input: largest })).toBeLessThanOrEqual(
      TOOL_AI_BODY_BUDGET
    );
  });
});
