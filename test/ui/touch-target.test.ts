import { describe, expect, it } from "vitest";
import { TOUCH_LINK, TOUCH_ROW, TOUCH_ROW_LINK } from "@/components/ui/touch-target";

/**
 * Standalone text links get a 44px target on touch screens, and nothing
 * changes with a mouse: every shared class is behind `pointer-coarse:`.
 */

const classes = (s: string) => s.split(/\s+/).filter(Boolean);

describe("the shared touch classes", () => {
  it("only ever style touch screens", () => {
    for (const set of [TOUCH_LINK, TOUCH_ROW, TOUCH_ROW_LINK]) {
      expect(classes(set).length).toBeGreaterThan(0);
      for (const c of classes(set)) expect(c).toMatch(/^pointer-coarse:/);
    }
  });

  it("give a 44px floor: a link on its own, or a row a link stretches over", () => {
    expect(classes(TOUCH_LINK)).toEqual(
      expect.arrayContaining([
        "pointer-coarse:inline-flex",
        "pointer-coarse:min-h-11",
        "pointer-coarse:items-center",
      ])
    );
    expect(classes(TOUCH_ROW)).toEqual(["pointer-coarse:relative", "pointer-coarse:min-h-11"]);
    expect(classes(TOUCH_ROW_LINK)).toEqual(
      expect.arrayContaining([
        "pointer-coarse:after:absolute",
        "pointer-coarse:after:inset-0",
        "pointer-coarse:after:content-['']",
      ])
    );
  });
});
