import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

  it("lists the DACI and RAPID pages beside the Decision Log: all three pick people from the roster", () => {
    expect(ROSTER_TOOLS.map((t) => t.toolId)).toEqual(
      expect.arrayContaining(["decision-log", "daci", "rapid-decision"])
    );
    const use = (id: string) => ROSTER_TOOLS.find((t) => t.toolId === id)?.use ?? "";
    expect(use("daci")).toMatch(/Approver, Driver, Contributors and Informed/);
    expect(use("rapid-decision")).toMatch(/Decide, Recommend, Agree, Perform and Input/);
  });

  it("lists the Phase 8 tools whose owner or author comes from the roster's person picker", () => {
    const phase8 = ["okrs", "risk-register", "flaky-tests", "code-review-metrics"];
    expect(ROSTER_TOOLS.map((t) => t.toolId)).toEqual(expect.arrayContaining(phase8));
    // Each of these pages renders a PersonPicker (components/team/person-picker).
    for (const id of phase8) {
      const dir = join(process.cwd(), "src", "app", "(tools)", id);
      const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
      expect(
        files.some((f) => readFileSync(join(dir, f), "utf8").includes("<PersonPicker")),
        id
      ).toBe(true);
    }
    const use = (id: string) => ROSTER_TOOLS.find((t) => t.toolId === id)?.use ?? "";
    expect(use("okrs")).toMatch(/objective's owner/);
    expect(use("code-review-metrics")).toMatch(/author/);
  });

  it("says the Mood Tracker uses the roster only by name: the anonymous mode keeps team pulses", () => {
    const use = ROSTER_TOOLS.find((t) => t.toolId === "mood-tracker")?.use ?? "";
    expect(use).toMatch(/each person .* by name/);
    expect(use).toMatch(/team pulses only in the anonymous mode/);
  });
});
