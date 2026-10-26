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
});
