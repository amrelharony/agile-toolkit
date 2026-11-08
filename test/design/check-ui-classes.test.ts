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

  it("flags 100vh centring wrappers and page mains", () => {
    const flagged = [
      '<main className="min-h-screen flex items-center justify-center px-4">',
      '<div className="min-h-screen grid place-items-center">',
      '<main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6">',
      '<section className="md:min-h-screen flex flex-col justify-center">',
    ].join("\n");
    expect(findViolations(flagged)).toEqual([
      expect.objectContaining({ line: 1, rule: "min-h-screen-wrapper", match: "min-h-screen" }),
      expect.objectContaining({ line: 2, rule: "min-h-screen-wrapper", match: "min-h-screen" }),
      expect.objectContaining({ line: 3, rule: "min-h-screen-wrapper", match: "min-h-screen" }),
      expect.objectContaining({ line: 4, rule: "min-h-screen-wrapper", match: "md:min-h-screen" }),
    ]);

    const ok = [
      '<main className="min-h-screen-dvh flex items-center justify-center px-4">',
      '<main className="mx-auto min-h-screen-dvh w-full max-w-3xl">',
      // The app shell's row is not a centring wrapper.
      '<div className="flex min-h-screen">',
      '// a comment: <main className="min-h-screen flex items-center">',
    ].join("\n");
    expect(findViolations(ok)).toEqual([]);
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

  describe("touch primitives", () => {
    const BUTTON = "src/components/ui/button.tsx";

    it("flags a width breakpoint shrinking a Button or Input", () => {
      // What button.tsx had: landscape phones and tablets (md+, touch) got 36 px.
      const src = [
        'default: "min-h-[44px] md:min-h-9 md:h-9 px-4 py-2",',
        'icon: "min-h-[44px] min-w-[44px] md:h-9 md:w-9 md:min-h-0 md:min-w-0",',
        'sm: "min-h-[36px] lg:h-[30px] rounded-md",',
      ].join("\n");
      expect(
        findViolations(src, BUTTON).map((v: { line: number; match: string }) => [v.line, v.match])
      ).toEqual([
        [1, "md:min-h-9"],
        [1, "md:h-9"],
        [2, "md:h-9"],
        [2, "md:w-9"],
        [2, "md:min-h-0"],
        [2, "md:min-w-0"],
        [3, "lg:h-[30px]"],
      ]);
      expect(
        findViolations('"flex h-11 md:min-h-9 w-full"', "src/components/ui/input.tsx")
      ).toEqual([
        expect.objectContaining({ rule: "touch-primitive-width-shrink", match: "md:min-h-9" }),
      ]);
    });

    it("accepts a shrink scoped to a mouse, and touch-only growth", () => {
      const src = [
        'default: "min-h-[44px] md-fine:min-h-9 md-fine:h-9 px-4 py-2",',
        'sm: "min-h-[36px] pointer-coarse:min-h-11 md-fine:h-8",',
        'icon: "md:pointer-fine:h-9 pointer-fine:w-9 max-md:h-11 [&_svg]:size-4",',
        'wide: "md:w-auto md:h-auto",',
      ].join("\n");
      expect(findViolations(src, BUTTON)).toEqual([]);
    });

    it("only applies to the touch primitives", () => {
      expect(findViolations('<Button className="md:h-7 md:w-7" />', "src/app/x/page.tsx")).toEqual(
        []
      );
      expect(findViolations('<Button className="md:h-7 md:w-7" />')).toEqual([]);
    });

    it("tolerates only Input's existing md:h-9, which the form-fields fix moves", () => {
      const input = "src/components/ui/input.tsx";
      expect(findViolations('"flex h-11 md:h-9 w-full"', input)).toEqual([]);
      expect(findViolations('"flex h-11 md:h-9 w-full"', BUTTON)).toHaveLength(1);
    });
  });
});
