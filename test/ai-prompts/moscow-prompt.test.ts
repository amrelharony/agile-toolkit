// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateMoscowPrompts } from "@/lib/ai-prompts/moscow";
import { moscowVerdict } from "@/app/(tools)/moscow/verdict";
import { rankMethodRows } from "@/lib/prioritization/rank";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The MoSCoW prompt reads the buckets as the page does: no default bucket
 * (a row without one is "Not sorted yet", never Must), each item's effort
 * and where it comes from (a linked item's job size), and the Must budget
 * as the panel states it, from 3 sized items.
 */

const STAMP = "2026-10-20T09:00:00.000Z";

const row = (
  id: string,
  title: string,
  fields: Record<string, number | string>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "moscow",
  title,
  fields,
  status: "open",
  updatedAt: STAMP,
  ...extra,
});

const items: BacklogItem[] = [
  { id: "b1", name: "Checkout", moscow: "must", jobSize: 8, updatedAt: STAMP },
];

const ranked = rankMethodRows(
  "moscow",
  [
    row("m1", "Checkout", {}, { backlogItemId: "b1" }),
    row("m2", "Login", { bucket: "must", effort: 3 }),
    row("s1", "Search", { bucket: "should", effort: 5 }),
    row("c1", "Themes", { bucket: "could" }),
    row("w1", "Chat", { bucket: "wont", effort: 13 }),
    // An agent row without a bucket.
    row("n1", "Agent row", {}),
  ],
  items
);

describe("generateMoscowPrompts", () => {
  const [p] = generateMoscowPrompts({ rows: ranked, items }, null);

  it("lists each bucket with every item's effort and where it comes from", () => {
    expect(p.prompt).toContain(
      "### MUST HAVE (2)\n- Checkout (effort 8, the backlog job size)\n- Login (effort 3)"
    );
    expect(p.prompt).toContain("### COULD HAVE (1)\n- Themes (no effort yet)");
    expect(p.prompt).toContain("### WON'T HAVE (THIS TIME) (1)\n- Chat (effort 13)");
  });

  it("puts a row without a bucket under Not sorted yet, never Must", () => {
    expect(p.prompt).toContain("### NOT SORTED YET (1)\n- Agent row (no effort yet)");
  });

  it("states the Must budget and the verdict as the page does", () => {
    expect(p.prompt).toContain(
      "Musts: 69% of the planned effort (11 of 16 points; limit about 60%)."
    );
    expect(p.prompt).toContain(`Verdict: ${moscowVerdict(ranked, items)}`);
  });

  it("says when the budget can't show yet, and has nothing to ask without rows", () => {
    const [few] = generateMoscowPrompts({ rows: ranked.slice(0, 1), items });
    expect(few.prompt).toContain(
      "Must budget: it shows from 3 planned items with an effort; 1 so far."
    );
    expect(generateMoscowPrompts({ rows: [] })).toEqual([]);
  });
});
