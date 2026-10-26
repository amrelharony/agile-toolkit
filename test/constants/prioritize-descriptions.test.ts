import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getToolById } from "@/lib/constants/tools";
import { HUB_METHOD_IDS, method } from "@/lib/prioritization/methods";
import { COD_URGENCIES, COD_URGENCY_LABEL } from "@/lib/prioritization/methods/cost-of-delay";
import { resetToolSearchIndex, searchTools } from "@/lib/search/tool-search";

/*
 * The Prioritize & decide descriptions are the tools' one-liners in the
 * catalog, the palette's search and the pages' metadata, so they say what
 * the rebuilt pages do, and a word dropped from one can't lose the tool
 * its search match.
 */

const description = (id: string) => getToolById(id)?.description ?? "";

describe("Prioritize & decide tool descriptions", () => {
  beforeEach(() => resetToolSearchIndex());

  it("Backlog Prioritizer: every method it compares, and the order it decides", () => {
    const text = description("prioritizer");
    expect(HUB_METHOD_IDS).toHaveLength(7);
    for (const id of HUB_METHOD_IDS) {
      // The registry's short label, or the method's full name.
      const label = method(id).label;
      const name = id === "value-effort" ? "Value vs Effort" : label;
      expect(text, id).toContain(name);
    }
    expect(text).toContain("decide one order");
  });

  it("Cost of Delay: CD3 and the urgency lanes, not the old weekly total", () => {
    const text = description("cost-of-delay");
    expect(text).toContain("CD3");
    for (const u of COD_URGENCIES) {
      expect(text.toLowerCase(), u).toContain(COD_URGENCY_LABEL[u].toLowerCase());
    }
    expect(text).not.toMatch(/loss of delaying/);
  });

  it("Kano and Eisenhower: the two-question survey, the due date", () => {
    expect(description("kano-model")).toContain("two-question customer survey");
    expect(description("eisenhower")).toContain("due date");
    expect(description("eisenhower")).not.toMatch(/^Plot tasks/);
  });

  it("DACI and RAPID: the same records as the Decision Log, in their form", () => {
    expect(description("daci")).toMatch(
      /^The same records as the Decision Log, raised in the DACI form/
    );
    expect(description("rapid-decision")).toMatch(
      /^The same records as the Decision Log, raised in the RAPID form/
    );
  });

  it("Weighted Decision Matrix: the result goes to the Decision Log only when sent", () => {
    const text = description("weighted-decision");
    expect(text).toContain("the result can go to the Decision Log as a proposed record");
    expect(text).not.toMatch(/result sent to/);
    // Sending is the page's own step: Send to… → Decision record (proposed).
    const card = readFileSync(
      join(process.cwd(), "src", "app", "(tools)", "weighted-decision", "result-card.tsx"),
      "utf8"
    );
    expect(card).toContain('decision: "Decision record (proposed)"');
  });

  it("Kano, Buy-a-Feature and the $100 Test run live rounds, like the Phase 6 vote tools", () => {
    for (const id of ["kano-model", "buy-a-feature", "hundred-dollar-test", "health-check"]) {
      expect(getToolById(id)?.isRealtime, id).toBe(true);
    }
  });

  it.each([
    ["cumulative voting", "hundred-dollar-test"],
    ["play money", "buy-a-feature"],
    ["cd3", "cost-of-delay"],
    ["urgent important", "eisenhower"],
    ["architecture decision record", "decision-log"],
    ["pugh", "weighted-decision"],
    ["snowden", "cynefin"],
    ["quick wins", "value-effort-matrix"],
  ])("%j still finds %s", (query, id) => {
    expect(searchTools(query, 3).map((t) => t.id)).toContain(id);
  });
});

describe("Prioritize & decide page metadata", () => {
  // These pages kept their own copy of a description while the catalog's
  // was stale; the catalog's is the one kept up to date, so they read it.
  it.each([
    "prioritizer",
    "cost-of-delay",
    "value-effort-matrix",
    "eisenhower",
    "kano-model",
    "buy-a-feature",
    "hundred-dollar-test",
    "weighted-decision",
    "cynefin",
    "daci",
    "rapid-decision",
    "decision-log",
  ])("%s takes its title and description from the catalog", (id) => {
    const src = readFileSync(join(process.cwd(), "src", "app", "(tools)", id, "page.tsx"), "utf8");
    expect(src).toContain(`toolMetadata("${id}");`);
    expect(src).not.toMatch(/description:/);
  });
});
