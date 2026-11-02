import { describe, expect, it } from "vitest";
import { getAllGuides, getGuide } from "@/lib/tools/guides";
import { getToolById } from "@/lib/constants/tools";
import { SECTIONS } from "@/lib/constants/sections";

describe("tool guides", () => {
  it("only describe tools that exist, once each", async () => {
    const ids = (await getAllGuides()).map((g) => g.toolId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(getToolById(id), id).toBeDefined();
  });

  it("cover every tool except the reading in the Library and the VIP tools", async () => {
    const guided = new Set((await getAllGuides()).map((g) => g.toolId));
    const missing = SECTIONS.flatMap((s) => s.toolIds).filter(
      (id) =>
        getToolById(id)?.kind !== "reading" && getToolById(id)?.access !== "vip" && !guided.has(id)
    );
    expect(missing).toEqual([]);
  });

  it("have a summary, situations and at least two steps", async () => {
    for (const g of await getAllGuides()) {
      expect(g.summary.length, g.toolId).toBeGreaterThan(20);
      expect(g.whenToUse.length, g.toolId).toBeGreaterThanOrEqual(1);
      expect(g.steps.length, g.toolId).toBeGreaterThanOrEqual(2);
    }
  });

  it("stay short enough to read in a panel", async () => {
    for (const g of await getAllGuides()) {
      expect(JSON.stringify(g).length, g.toolId).toBeLessThan(2500);
    }
  });

  it("are loaded by tool id from the right chunk", async () => {
    expect((await getGuide("retro"))?.toolId).toBe("retro");
    expect((await getGuide("cynefin"))?.toolId).toBe("cynefin");
    // Moved with their sections: they must load from the new chunk.
    expect((await getGuide("six-hats"))?.toolId).toBe("six-hats");
    expect((await getGuide("impediments"))?.toolId).toBe("impediments");
    expect((await getGuide("dod-builder"))?.toolId).toBe("dod-builder");
    expect((await getGuide("dora-scorecard"))?.toolId).toBe("dora-scorecard");
    expect((await getGuide("model-card"))?.toolId).toBe("model-card");
    expect(await getGuide("not-a-tool")).toBeUndefined();
  });
});
