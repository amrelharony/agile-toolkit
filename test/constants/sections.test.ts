import { describe, expect, it } from "vitest";
import { SECTIONS, getSectionForTool } from "@/lib/constants/sections";
import { tools } from "@/lib/constants/tools";

describe("navigation sections", () => {
  it("place every tool in exactly one section", () => {
    const placed = SECTIONS.flatMap((s) => s.toolIds);
    expect(new Set(placed).size).toBe(placed.length);
    const all = tools.map((t) => t.id).sort();
    expect([...placed].sort()).toEqual(all);
  });

  it("follows the sprint: plan, run, retrospect, then the standing jobs", () => {
    expect(SECTIONS.slice(0, 4).map((s) => s.id)).toEqual(["plan", "run", "retro", "delivery"]);
  });

  it("look tools up by id", () => {
    expect(getSectionForTool("retro")?.id).toBe("retro");
    expect(getSectionForTool("premortem")?.id).toBe("retro");
    expect(getSectionForTool("kanban")?.id).toBe("run");
    expect(getSectionForTool("six-hats")?.id).toBe("retro");
    expect(getSectionForTool("dod-builder")?.id).toBe("team");
    expect(getSectionForTool("wsjf")?.id).toBe("prioritize");
  });
});
