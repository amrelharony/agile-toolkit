import { describe, expect, it } from "vitest";
import { ROSTER_TOOLS } from "@/app/(meta)/team/roster-tools";
import { getToolById } from "@/lib/constants/tools";

/**
 * The Team page's "Where the team list is used": every entry is a real
 * tool (the page skips an unknown id), each once, and the people tools
 * that stamp roster member ids are listed.
 */
describe("ROSTER_TOOLS", () => {
  it("names real tools, each once", () => {
    const ids = ROSTER_TOOLS.map((t) => t.toolId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getToolById(id), id).toBeTruthy();
  });

  it("lists the 1:1 log and the onboarding tracker", () => {
    expect(ROSTER_TOOLS.map((t) => t.toolId)).toEqual(
      expect.arrayContaining(["one-on-one", "onboarding-tracker"])
    );
  });
});
