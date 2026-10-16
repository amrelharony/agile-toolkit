// @vitest-environment node
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without types
import { findViolations } from "../../scripts/check-ui-classes.mjs";

describe("check-ui-classes guard", () => {
  it("flags the removed patterns", () => {
    const src = [
      '<p className="text-[10px] text-sub">x</p>',
      '<span className="text-[#00ff88] bg-[#ef4444]/10">x</span>',
      '<button className="hover:bg-accent">x</button>',
      '<div className="border border-border/40">x</div>',
    ].join("\n");
    const rules = findViolations(src).map((v: { rule: string }) => v.rule);
    expect(rules).toEqual([
      "text-below-12px",
      "brand-hex-class",
      "brand-hex-class",
      "solid-accent-hover",
      "border-border-opacity",
    ]);
  });

  it("accepts the replacements, comments and solid status dots", () => {
    const src = [
      '<p className="text-xs text-sub">x</p>',
      '<span className="text-accent-green bg-danger/10">x</span>',
      '<button className="hover:bg-accent/10">x</button>',
      "// a comment mentioning hover:bg-accent and text-[10px]",
      '<i className="bg-[#22c55e] rounded-full" />',
    ].join("\n");
    expect(findViolations(src)).toEqual([]);
  });
});
