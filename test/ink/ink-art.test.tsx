import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { InkArt } from "@/components/ink/ink-art";
import { InkScribble } from "@/components/ink/ink-scribble";
import { SECTION_ART } from "@/lib/ink/drawings/sections";
import { washPath } from "@/lib/ink/wash";
import { ring } from "@/lib/ink/pen";

const plan = SECTION_ART.plan;

describe("InkArt", () => {
  it("is decorative: hidden from assistive tech, never focusable, tagged for tooling", () => {
    const { container } = render(<InkArt drawing={plan} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("data-ink")).toBe("plan");
    expect(svg.classList.contains("ink-art")).toBe(true);
  });

  it("draws every stroke along a unit path length, one after another", () => {
    const { container } = render(<InkArt drawing={plan} />);
    const lines = Array.from(container.querySelectorAll("path.ink-line"));
    expect(lines).toHaveLength(plan.strokes.length);
    const delays = lines.map((p) => {
      expect(p.getAttribute("pathLength")).toBe("1");
      return parseInt((p as SVGPathElement).style.getPropertyValue("--ink-delay"), 10);
    });
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
  });

  it("paints a stroke's fill just before its own outline", () => {
    const { container } = render(<InkArt drawing={plan} />);
    const paths = Array.from(container.querySelectorAll("path"));
    const note = paths.findIndex((p) => p.classList.contains("ink-fill-warning"));
    expect(note).toBeGreaterThan(-1);
    expect(paths[note + 1].classList.contains("ink-line")).toBe(true);
  });

  it("colours with theme tone classes, never a hex value", () => {
    const html = renderToStaticMarkup(<InkArt drawing={plan} />);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).toContain("ink-tone-ink");
    expect(html).toContain("ink-fill-accent2");
  });

  it("boils and stays still only when asked", () => {
    const plain = render(<InkArt drawing={plan} />).container.querySelector("svg")!;
    expect(plain.classList.contains("ink-boil")).toBe(false);
    expect(plain.classList.contains("ink-still")).toBe(false);
    const both = render(<InkArt drawing={plan} boil still />).container.querySelector("svg")!;
    expect(both.classList.contains("ink-boil")).toBe(true);
    expect(both.classList.contains("ink-still")).toBe(true);
  });

  it("renders the same markup every time, so hydration matches the server", () => {
    expect(renderToStaticMarkup(<InkArt drawing={plan} />)).toBe(
      renderToStaticMarkup(<InkArt drawing={plan} />)
    );
    const shape = { cx: 10, cy: 10, rx: 5, ry: 4, seed: 9 };
    expect(washPath(shape)).toBe(washPath(shape));
    expect(washPath(shape)).not.toBe(washPath({ ...shape, seed: 10 }));
  });

  it("closes a ring past its own start, like a pen", () => {
    expect(ring(10, 10, 5)).toMatch(/^M[\d.]+ [\d.]+A5 5 0 0 1 [\d.]+ [\d.]+A5 5 0 1 1 /);
  });

  it("marks the loading scribble so its loop applies", () => {
    const svg = render(<InkScribble />).container.querySelector("svg")!;
    expect(svg.classList.contains("ink-scribble")).toBe(true);
    expect(svg.getAttribute("data-ink")).toBe("scribble");
  });
});
