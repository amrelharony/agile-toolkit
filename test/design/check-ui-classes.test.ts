// @vitest-environment node
import { describe, expect, it } from "vitest";
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

  it("flags the comic's palette as hex too", () => {
    expect(findViolations('<p className="text-[#873a16] bg-[#1c5f3d]/10">x</p>')).toEqual([
      expect.objectContaining({ rule: "brand-hex-class", match: "text-[#873a16]" }),
      expect.objectContaining({ rule: "brand-hex-class", match: "bg-[#1c5f3d]/10" }),
    ]);
  });

  it("caps own-colour text on its own tint at /20", () => {
    const flagged = [
      '<b className="bg-accent/15 hover:bg-accent/25 text-accent">x</b>',
      '<b className="bg-success/30 text-success">x</b>',
      '<b className="bg-accent-green/40 text-accent-green">x</b>',
    ].join("\n");
    expect(findViolations(flagged)).toEqual([
      expect.objectContaining({ line: 1, rule: "strong-own-tint", match: "hover:bg-accent/25" }),
      expect.objectContaining({ line: 2, rule: "strong-own-tint", match: "bg-success/30" }),
      expect.objectContaining({ line: 3, rule: "strong-own-tint", match: "bg-accent-green/40" }),
    ]);

    const ok = [
      '<b className="bg-accent/10 hover:bg-accent/20 text-accent">x</b>',
      '<b className="bg-accent/30 text-text">x</b>',
      '<b className="bg-accent/30 text-accent-green">x</b>',
      '<b className="bg-accent/90 text-white">x</b>',
    ].join("\n");
    expect(findViolations(ok)).toEqual([]);
  });
});
