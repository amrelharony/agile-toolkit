// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateTechDebtPrompts } from "@/lib/ai-prompts/tech-debt";
import type { TechDebtItem } from "@/lib/stores/workspace-types";

/**
 * The debt prompt reads the items as the page does (lib/tech-debt/model):
 * ages in sprints of the team's cadence counted on the page's day (never
 * from the clock), the capped score with how it adds up, an interest that
 * isn't estimated named as such (never scored as 0 silently), the backlog
 * link, the page's order and its verdict.
 */

const TODAY = "2026-10-27";

const item = (id: string, title: string, extra: Partial<TechDebtItem>): TechDebtItem => ({
  id,
  title,
  impact: 3,
  effort: 3,
  raisedAt: TODAY,
  ...extra,
});

const ITEMS: TechDebtItem[] = [
  item("d4", "Paid", {
    impact: 5,
    effort: 1,
    interestRate: 1,
    raisedAt: "2026-08-01",
    resolvedAt: "2026-09-01",
  }),
  item("d3", "No estimate", { impact: 2, effort: 1, raisedAt: "2026-10-20" }),
  item("d2", "Old ORM", {
    area: "DB",
    impact: 3,
    effort: 5,
    interestRate: 3,
    raisedAt: "2026-04-01",
  }),
  item("d1", "Flaky deploy script", {
    area: "CI",
    impact: 4,
    effort: 2,
    interestRate: 0.5,
    raisedAt: "2026-07-07",
    description: `Retries hide a race in the artifact upload. ${"x".repeat(80)}`,
    sentTo: [{ route: "backlog-story", targetId: "s1", at: "2026-10-01T09:00:00.000Z" }],
  }),
];

const STORIES = [{ id: "s1", status: "todo" as const }];

describe("generateTechDebtPrompts", () => {
  const [paydown, systemic] = generateTechDebtPrompts({
    items: ITEMS,
    sprintLengthDays: 14,
    today: TODAY,
    stories: STORIES,
  });

  // The description is clamped at 80 characters.
  const described = `Retries hide a race in the artifact upload. ${"x".repeat(80)}`.slice(0, 80);

  it("ages each item in sprints and shows how its capped score adds up, in the page's order", () => {
    const rows = paydown.prompt.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toEqual([
      `| 1 | Flaky deploy script | CI | 4 | 2 | 0.5 | ≈ 8 sprints | 18 (4 × 4 − 2 + 4 interest) | Open, on the backlog | ${described} |`,
      "| 2 | Old ORM | DB | 3 | 5 | 3 | ≈ 14 sprints | 17 (3 × 4 − 5 + 10 interest (capped at 10)) | Open | — |",
      "| 3 | No estimate | — | 2 | 1 | Not estimated | under a sprint | 7 (2 × 4 − 1) | Open | — |",
      "| 4 | Paid | — | 5 | 1 | 1 | ≈ 2 sprints | 21 (5 × 4 − 1 + 2 interest) | Paid down 2026-09-01 | — |",
    ]);
    expect(systemic.prompt).toContain(`| ${described} |`);
  });

  it("states the cadence, the interest, the oldest item, the hotspot and the verdict", () => {
    expect(paydown.prompt).toContain("Ages are in 14-day sprints (the team's cadence);");
    expect(paydown.prompt).toContain(
      "3 open, 1 paid down, 1 of the open on the backlog. Interest on the open debt: about 3.5 score points a sprint (1 not estimated). The oldest open item is ≈ 14 sprints old. Hotspot: CI (4 impact points open). 1 open item with no area."
    );
    expect(systemic.prompt).toContain(
      "Verdict: 3 open items cost about 3.5 points a sprint (1 not estimated); the top one, “Flaky deploy script”, is 8 sprints old and scores 18."
    );
  });

  it("counts ages in the team's sprint length, and names the default", () => {
    const [p] = generateTechDebtPrompts({
      items: ITEMS,
      sprintLengthDays: 7,
      defaultLength: true,
      today: TODAY,
    });
    expect(p.prompt).toContain(
      "Ages are in 7-day sprints (the default: the team hasn't set a sprint length)"
    );
    expect(p.prompt).toContain(
      `| 1 | Flaky deploy script | CI | 4 | 2 | 0.5 | ≈ 16 sprints | 22 (4 × 4 − 2 + 8 interest) | Open, on the backlog | ${described} |`
    );
    expect(generateTechDebtPrompts({ items: [], sprintLengthDays: 14, today: TODAY })).toEqual([]);
  });
});
