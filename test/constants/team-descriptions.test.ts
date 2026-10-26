import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getToolById } from "@/lib/constants/tools";
import { resetToolSearchIndex, searchTools } from "@/lib/search/tool-search";

/*
 * The Team & people descriptions are what the palette searches (with the
 * name, id and category), so a word dropped from one can lose the tool its
 * only match.
 */

describe("Team tool descriptions", () => {
  beforeEach(() => resetToolSearchIndex());

  it("Skills Matrix: 'bus factor' still finds it", () => {
    expect(getToolById("skills-matrix")?.description).toMatch(/bus factor/i);
    expect(
      searchTools("bus factor", 3).map((t) => t.id),
      "the anti-pattern still says 'Bus factor = 1'"
    ).toContain("skills-matrix");
  });

  it("Skills Matrix: only the target check is against the target", () => {
    // lib/skills/coverage: a gap is nobody capable, a single point of failure
    // exactly one; neither depends on the skill's target.
    expect(getToolById("skills-matrix")?.description).not.toMatch(
      /single points of failure against/
    );
  });

  it("Psych Safety: no benchmark, and Edmondson still finds it", () => {
    // lib/psych-safety/instrument dropped the uncited 4.0 team-vs-org benchmark.
    expect(getToolById("psych-safety")?.description).not.toMatch(/benchmark/i);
    expect(searchTools("edmondson", 3).map((t) => t.id)).toContain("psych-safety");
  });

  it.each([
    ["traffic light", "health-check"],
    ["anonymous vote", "health-check"],
    ["heatmap", "mood-tracker"],
    ["anonymous pulse", "mood-tracker"],
  ])("the pulse tools: %j still finds %s", (query, id) => {
    expect(searchTools(query, 3).map((t) => t.id)).toContain(id);
  });
});

describe("Team page metadata", () => {
  // These pages kept their own copy of an older description; the catalog's
  // is the one kept up to date, so they read it.
  it.each([
    "adkar",
    "onboarding-tracker",
    "stakeholder-map",
    "working-agreement",
    "dod-builder",
    "health-check",
    "psych-safety",
    "mood-tracker",
  ])("%s takes its title and description from the catalog", (id) => {
    const src = readFileSync(join(process.cwd(), "src", "app", "(tools)", id, "page.tsx"), "utf8");
    expect(src).toContain(`toolMetadata("${id}");`);
    expect(src).not.toMatch(/description:/);
  });
});
