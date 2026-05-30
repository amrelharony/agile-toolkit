import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ObjectRenderer } from "@/app/(tools)/canvas/components/object-renderer";
import {
  stickyFixture,
  shapeFixture,
  textFixture,
  frameFixture,
  lineFixture,
  freehandFixture,
  imageFixture,
  embedFixture,
  kanbanFixture,
  timerFixture,
  votingFixture,
  cardFixture,
  tableFixture,
  mindMapNodeFixture,
  diagramShapeFixture,
} from "./object-fixtures";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Render-characterization tests for ObjectRenderer. These pin the CURRENT
 * read-only render output of each object type (no canvas test coverage existed
 * before) so the per-type render branches can be carved out of the big
 * `switch (o.type)` with a safety net. Rendered with editing=false so the
 * Tiptap editor never instantiates.
 */

function renderObject(object: WhiteboardObject) {
  return render(<ObjectRenderer object={object} selected={false} />);
}

function root(container: HTMLElement, kind: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-canvas-object-kind="${kind}"]`);
  expect(el, `expected a [data-canvas-object-kind="${kind}"] root`).not.toBeNull();
  return el as HTMLElement;
}

describe("ObjectRenderer — inline primitive types", () => {
  it("sticky: tagged root + content text", () => {
    const { container } = renderObject(stickyFixture({ content: "Hello sticky" }));
    expect(root(container, "sticky").textContent).toContain("Hello sticky");
  });

  it("sticky: empty content shows the placeholder", () => {
    const { container } = renderObject(stickyFixture({ content: "" }));
    expect(root(container, "sticky").textContent).toContain("Sticky note");
  });

  it.each(["rect", "ellipse", "diamond", "triangle"] as const)(
    "shape '%s': tagged root + svg",
    (type) => {
      const { container } = renderObject(shapeFixture(type));
      const el = root(container, type);
      expect(el.querySelector("svg")).not.toBeNull();
    }
  );

  it("text: tagged root + content", () => {
    const { container } = renderObject(textFixture({ content: "Some text" }));
    expect(root(container, "text").textContent).toContain("Some text");
  });

  it("frame: tagged root + label", () => {
    const { container } = renderObject(frameFixture({ label: "Frame label" }));
    expect(root(container, "frame").textContent).toContain("Frame label");
  });

  it.each(["line", "arrow"] as const)("%s: tagged root + svg", (type) => {
    const { container } = renderObject(lineFixture(type));
    expect(root(container, type).querySelector("svg")).not.toBeNull();
  });

  it("freehand: tagged root + svg path", () => {
    const { container } = renderObject(freehandFixture());
    const el = root(container, "freehand");
    expect(el.querySelector("svg")).not.toBeNull();
  });

  it("image: tagged root + sanitized <img> src", () => {
    const { container } = renderObject(
      imageFixture({ src: "https://cdn.example.com/pic.png", alt: "a picture" })
    );
    const img = root(container, "image").querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/pic.png");
  });

  it("image: an unsafe data-URL src is blocked (no <img src>)", () => {
    const { container } = renderObject(
      imageFixture({ src: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })
    );
    const img = root(container, "image").querySelector("img");
    // safeImageSrc returns "" for SVG data-URLs → no usable src.
    expect(img?.getAttribute("src") || "").toBe("");
  });

  it("embed: a valid YouTube URL produces an <iframe> at the embed URL", () => {
    const { container } = renderObject(
      embedFixture({ src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "youtube" })
    );
    const iframe = root(container, "embed").querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("embed: an unrecognized non-generic URL falls back (no <iframe>)", () => {
    const { container } = renderObject(
      embedFixture({ src: "https://evil.example.com/x", kind: "youtube" })
    );
    expect(root(container, "embed").querySelector("iframe")).toBeNull();
  });

  it("kanban: tagged root + label", () => {
    const { container } = renderObject(kanbanFixture({ label: "Sprint board" }));
    expect(root(container, "kanban").textContent).toContain("Sprint board");
  });
});

describe("ObjectRenderer — delegating types render without throwing", () => {
  // These cases delegate to already-extracted child components; we smoke-test
  // that the dispatch wires them up and produces output.
  const cases: Array<[string, WhiteboardObject]> = [
    ["timer", timerFixture()],
    ["voting", votingFixture()],
    ["card", cardFixture()],
    ["table", tableFixture()],
    ["mindMapNode", mindMapNodeFixture()],
    ["diagramShape", diagramShapeFixture()],
  ];
  it.each(cases)("%s renders some output", (_label, object) => {
    const { container } = renderObject(object);
    expect(container.firstChild).not.toBeNull();
  });
});

describe("ObjectRenderer — selection", () => {
  it("renders a sticky when selected without throwing", () => {
    const { container } = render(<ObjectRenderer object={stickyFixture()} selected />);
    expect(container.querySelector('[data-canvas-object-kind="sticky"]')).not.toBeNull();
  });
});
