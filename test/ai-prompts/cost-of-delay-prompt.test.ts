// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateCostOfDelayPrompts } from "@/lib/ai-prompts/cost-of-delay";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { codGroups } from "@/app/(tools)/cost-of-delay/lanes";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Cost-of-Delay prompt reads the queue as the page does: CD3 = cost
 * of delay per week ÷ duration in weeks, the urgency lanes and the
 * fixed-date starts. A row from before CD3 (per week × weeks delayed) is
 * "Not scored", and nothing sums an old "Total CoD".
 */

const TODAY = "2026-10-26";

const row = (id: string, title: string, fields: Record<string, number | string>) =>
  ({
    id,
    framework: "cost-of-delay",
    title,
    fields,
    status: "scored",
    updatedAt: "2026-10-20T09:00:00.000Z",
  }) satisfies PrioritizationItem;

const ranked = rankMethodRows(
  "cost-of-delay",
  [
    row("s", "Wallet checkout", { perWeekUsd: 8000, durationWeeks: 4, urgency: "standard" }),
    row("f", "Tax filing", {
      perWeekUsd: 2000,
      durationWeeks: 2,
      urgency: "fixed_date",
      fixedDate: "2026-12-01",
    }),
    // Saved before CD3: per week × weeks delayed, no duration.
    row("old", "Old row", { perWeekUsd: 5000, weeksDelayed: 6, totalCost: 30000 }),
  ],
  [],
  { today: TODAY }
);

describe("generateCostOfDelayPrompts", () => {
  const [prompt] = generateCostOfDelayPrompts(
    { rows: ranked, today: TODAY, verdict: "Start “Tax filing” by 17 Nov." },
    null
  );

  it("states CD3, the lane and the latest start as the rows show them", () => {
    expect(prompt.prompt).toContain("CD3 = cost of delay per week ÷ duration in weeks");
    expect(prompt.prompt).toContain("| Wallet checkout | $8,000 | 4 | 2,000 | Standard: by CD3 |");
    expect(prompt.prompt).toMatch(
      /\| Tax filing \| \$2,000 \| 2 \| 1,000 \| Fixed date: by latest start \| Start by 17 Nov to land by 1 Dec \|/
    );
    expect(prompt.prompt).toContain("Verdict: Start “Tax filing” by 17 Nov.");
  });

  it("reads a legacy row as not scored and never totals the old cost", () => {
    expect(prompt.prompt).toContain("| Old row | $5,000 | — | — | Not scored: add a duration |");
    expect(prompt.prompt).toContain("Waiting costs $10,000 per week across 2 scored initiatives.");
    expect(prompt.prompt).not.toContain("30,000");
    expect(prompt.prompt).not.toMatch(/total cod/i);
  });

  it("names the lanes as the page heads them, the no-profile lane after Standard", () => {
    const queue = rankMethodRows(
      "cost-of-delay",
      [
        row("i", "Brand refresh", { perWeekUsd: 3000, durationWeeks: 1, urgency: "intangible" }),
        row("n", "Dark mode", { perWeekUsd: 1000, durationWeeks: 2 }),
        row("s", "Wallet checkout", { perWeekUsd: 8000, durationWeeks: 4, urgency: "standard" }),
      ],
      [],
      { today: TODAY }
    );
    const [p] = generateCostOfDelayPrompts({ rows: queue, today: TODAY }, null);
    // Every heading the page shows, in its order, in the preamble; unscored last.
    const headings = [...codGroups(queue).map((g) => g.label), "Not scored: add a duration"];
    expect(headings).toContain("No urgency profile yet: by CD3");
    const order = headings.map((h) => p.prompt.indexOf(h));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]))).toBe(true);
    expect(p.prompt).toContain("| Dark mode | $1,000 | 2 | 500 | No urgency profile yet: by CD3 |");
    expect(p.prompt).not.toContain("No profile |");
    // The table lists the rows lane by lane, as the page does.
    const at = (title: string) => p.prompt.indexOf(`| ${title} |`);
    expect(at("Wallet checkout")).toBeLessThan(at("Dark mode"));
    expect(at("Dark mode")).toBeLessThan(at("Brand refresh"));
  });

  it("keeps titles inside the untrusted block", () => {
    const open = prompt.prompt.indexOf("<user_content>");
    expect(open).toBeGreaterThan(-1);
    expect(prompt.prompt.indexOf("Wallet checkout")).toBeGreaterThan(open);
    expect(prompt.prompt.indexOf("Verdict:")).toBeGreaterThan(open);
  });

  it("has nothing to ask about an empty queue", () => {
    expect(generateCostOfDelayPrompts({ rows: [] })).toEqual([]);
  });
});
