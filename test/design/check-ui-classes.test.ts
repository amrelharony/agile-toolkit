// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
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

  describe("the header search pill", () => {
    it("may not be rigid (shrink-0, flex-shrink-0, flex-none, any variant)", () => {
      const src = [
        "<button",
        "  onClick={() => open(a > b)}",
        '  data-header-search=""',
        "  className={cn(",
        '    "flex items-center shrink-0",',
        '    "lg:flex-shrink-0 md:!flex-none"',
        "  )}",
        ">",
        '  <Search className="shrink-0" />',
        "</button>",
      ].join("\n");
      expect(findViolations(src)).toEqual([
        expect.objectContaining({ line: 5, rule: "rigid-header-search", match: "shrink-0" }),
        expect.objectContaining({ line: 6, match: "lg:flex-shrink-0" }),
        expect.objectContaining({ line: 6, match: "md:!flex-none" }),
      ]);
    });

    it("passes a shrinkable pill, rigid children, comments and unmarked elements", () => {
      const src = [
        '<span className="shrink-0">not the search</span>',
        "<button",
        '  className={cn("min-w-9 lg:min-w-[10rem] lg:shrink-[100] [&>svg]:shrink-0",',
        "    // never shrink-0: it pushed the bar wider than the screen",
        '    /* nor flex-none */ "lg:w-[280px]")}',
        "  data-header-search",
        ">",
        '  <kbd className="shrink-0">K</kbd>',
        "</button>",
      ].join("\n");
      expect(findViolations(src)).toEqual([]);
    });

    it("holds for the real header", () => {
      const file = path.join(process.cwd(), "src/components/layout/header.tsx");
      const source = readFileSync(file, "utf8");
      expect(source).toContain("data-header-search");
      expect(findViolations(source)).toEqual([]);
    });
  });
});
