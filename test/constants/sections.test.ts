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

  it("look tools up by id", () => {
    expect(getSectionForTool("retro")?.id).toBe("ceremonies");
    expect(getSectionForTool("premortem")?.id).toBe("ceremonies");
    expect(getSectionForTool("wsjf")?.id).toBe("prioritize");
  });
});
