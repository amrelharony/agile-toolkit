import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { InkHighlight } from "@/components/ink/ink-highlight";
import { readFileSync } from "node:fs";
import path from "node:path";
import { highlightShape } from "@/lib/ink/highlight";

describe("InkHighlight", () => {
  it("keeps the words a real text node and the ink decorative", () => {
    const { container } = render(
      <p>
        Plan with <InkHighlight>110 interactive tools</InkHighlight> today
      </p>
    );
    expect(screen.getByText("110 interactive tools")).toBeInTheDocument();
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(container.querySelector("p")!.textContent).toBe("Plan with 110 interactive tools today");
  });

  it("reveals the ink through a mask drawn along the pen's path", () => {
    const { container } = render(<InkHighlight mark="circle">404</InkHighlight>);
    const mask = container.querySelector("mask")!;
    const ink = container.querySelector("path.ink-hl-ink")!;
    expect(ink.getAttribute("mask")).toBe(`url(#${mask.id})`);
    expect(mask.querySelector("path.ink-line")!.getAttribute("pathLength")).toBe("1");
  });

  it("draws the same mark for the same seed, on the server and in the browser", () => {
    expect(highlightShape("underline", 4, 2)).toEqual(highlightShape("underline", 4, 2));
    expect(highlightShape("circle", 7).outline).not.toBe(highlightShape("circle", 8).outline);
    const a = renderToStaticMarkup(<InkHighlight mark="circle">404</InkHighlight>);
    const b = renderToStaticMarkup(<InkHighlight mark="circle">404</InkHighlight>);
    expect(a).toBe(b);
  });

  it("ships no pen library: the marks are data", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/ink/ink-highlight.tsx"),
      "utf8"
    );
    const imports = src
      .split(/\r?\n/)
      .filter((l) => l.startsWith("import "))
      .join(" ");
    expect(imports).not.toMatch(/perfect-freehand|@\/lib\/ink\/highlight"/);
    expect(imports).toContain("@/lib/ink/highlight-marks");
  });

  it("produces a tapered outline and a pen path for both kinds", () => {
    for (const kind of ["underline", "circle"] as const) {
      const shape = highlightShape(kind, 1);
      expect(shape.outline).toMatch(/^M [\d.-]+ [\d.-]+ Q.* Z$/);
      expect(shape.centre).toMatch(/^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+$/);
    }
  });
});
