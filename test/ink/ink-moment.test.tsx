/**
 * Ink moments (DNA-SPEC §9): a small mark drawn once, in place, when
 * something gets finished. Each is decorative (the text beside it says what
 * happened), has a fixed box, inks in once and then stays still. These check
 * the marks and the pen helpers they're drawn with; the sites that draw them
 * are checked in ink-moment-sites.test.tsx and with their own screens.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { InkMoment, type MomentMark } from "@/components/ink/ink-moment";
import { DONE_STAMP, STAR } from "@/lib/ink/drawings/marks";
import { ring, turn } from "@/lib/ink/pen";

const ink = (c: ParentNode, name: string) => c.querySelector(`[data-ink="${name}"]`);

describe("InkMoment", () => {
  const MARKS: [MomentMark, string][] = [
    ["stamp", "done-stamp"],
    ["heart", "heart"],
    ["flourish", "flourish"],
    ["star", "star"],
  ];

  it.each(MARKS)(
    "draws the %s as decorative art in a fixed box that inks in once",
    (mark, name) => {
      const { container } = render(<InkMoment mark={mark} />);
      const svg = ink(container, name)!;
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      // A fixed height and width, so inking in moves nothing.
      expect(svg.getAttribute("class")).toMatch(/\bh-\S+/);
      expect(svg.getAttribute("class")).toMatch(/\bw-\S+/);
      // Inks in (not drawn finished), and never boils or loops afterwards.
      expect(svg.classList.contains("ink-still")).toBe(false);
      expect(svg.classList.contains("ink-boil")).toBe(false);
      expect(svg.classList.contains("ink-scribble")).toBe(false);
    }
  );

  it("is server-safe: no hooks, so a server page can render it", () => {
    const html = renderToStaticMarkup(<InkMoment mark="stamp" />);
    expect(html).toContain('data-ink="done-stamp"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("lets a site resize the box", () => {
    const { container } = render(<InkMoment mark="flourish" className="w-24" />);
    const cls = ink(container, "flourish")!.getAttribute("class")!;
    expect(cls).toContain("w-24");
    expect(cls).not.toContain("w-20");
  });
});

describe("the marks", () => {
  it("letters the stamp's Done in the success tone, set askew with its oval", () => {
    expect(DONE_STAMP.strokes).toHaveLength(5);
    for (const s of DONE_STAMP.strokes) expect(s.tone).toBe("success");
    // The oval is turned by the stamp's tilt (the arc's x-axis rotation).
    expect(DONE_STAMP.strokes[0].d).toMatch(/A30 15 -7 /);
  });

  it("draws the star in the warning tone, tips and notches closed past the first tip", () => {
    const [edge] = STAR.strokes;
    expect(edge.tone).toBe("warning");
    expect(edge.fill).toBe("warning");
    // Ten edges, then one more running on past the first tip.
    expect(edge.d.match(/Q/g)).toHaveLength(11);
  });
});

describe("pen", () => {
  it("draws an untilted ring exactly as before", () => {
    // The output of ring() before it took a tilt: every drawing that uses it is unchanged.
    expect(ring(48, 48, 20)).toBe("M34.7 33.1A20 20 0 0 1 61.3 62.9A20 20 0 1 1 41.5 29.1");
    expect(ring(30, 40, 12, 8, -1.2, 0.3)).toBe(
      "M34.3 32.5A12 8 0 0 1 25.7 47.5A12 8 0 1 1 37.5 33.7"
    );
    expect(ring(30, 40, 12, 8, -1.2, 0.3, -7)).toMatch(/^M[\d. ]+A12 8 -7 0 1 /);
  });

  it("turns lettering about a point, and refuses arcs and H / V", () => {
    expect(turn("M10 0L0 10", 0, 0, 0)).toBe("M10 0L0 10");
    expect(turn("M10 0L0 10", 90, 0, 0)).toBe("M0 10L-10 0");
    expect(turn("M12 10C14 10 14 12 12 12", 180, 12, 10)).toBe("M12 10C10 10 10 8 12 8");
    expect(() => turn("M0 0A2 2 0 0 1 4 0", 10, 0, 0)).toThrow();
    expect(() => turn("M0 0H4", 10, 0, 0)).toThrow();
    expect(() => turn("M0 0l4 0", 10, 0, 0)).toThrow();
  });
});
