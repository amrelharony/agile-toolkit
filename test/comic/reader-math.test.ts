import { describe, it, expect } from "vitest";
import {
  clampPage,
  viewFor,
  nextView,
  prevView,
  prefetchPages,
  shouldUseSpread,
  fitScale,
  scaleForBucket,
  widthBucket,
  parsePageHash,
  pageHash,
  pageLabel,
  readerKeyAction,
  zoomStep,
  MAX_CANVAS_AREA,
  MAX_CANVAS_EDGE,
  type ReaderKeyEvent,
} from "@/lib/comic/reader-math";

/**
 * Pure layout / sizing / keyboard helpers behind the "Agile at Work" comic
 * reader. Page numbers are 1-based.
 */

describe("clampPage", () => {
  it("coerces junk into 1..numPages", () => {
    expect(clampPage(NaN, 24)).toBe(1);
    expect(clampPage(0, 24)).toBe(1);
    expect(clampPage(-3, 24)).toBe(1);
    expect(clampPage(2.7, 24)).toBe(2);
    expect(clampPage(99, 24)).toBe(24);
    expect(clampPage(Infinity, 24)).toBe(1);
    expect(clampPage(7, 24)).toBe(7);
  });
  it("treats an unusable page count as a single page", () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(clampPage(5, NaN)).toBe(1);
  });
});

describe("viewFor", () => {
  it("shows one page in single mode", () => {
    expect(viewFor(1, 24, false)).toEqual([1]);
    expect(viewFor(7, 24, false)).toEqual([7]);
  });
  it("N=1: the cover alone", () => {
    expect(viewFor(1, 1, true)).toEqual([1]);
  });
  it("N=2: cover alone, then page 2 alone (no partner)", () => {
    expect(viewFor(1, 2, true)).toEqual([1]);
    expect(viewFor(2, 2, true)).toEqual([2]);
  });
  it("N=24: cover alone, pairs 2–3 … 22–23, last page alone", () => {
    expect(viewFor(1, 24, true)).toEqual([1]);
    expect(viewFor(2, 24, true)).toEqual([2, 3]);
    expect(viewFor(3, 24, true)).toEqual([2, 3]);
    expect(viewFor(22, 24, true)).toEqual([22, 23]);
    expect(viewFor(23, 24, true)).toEqual([22, 23]);
    expect(viewFor(24, 24, true)).toEqual([24]);
  });
  it("N=25: the last pair is 24–25", () => {
    expect(viewFor(24, 25, true)).toEqual([24, 25]);
    expect(viewFor(25, 25, true)).toEqual([24, 25]);
  });
  it("clamps out-of-range pages first", () => {
    expect(viewFor(99, 24, true)).toEqual([24]);
    expect(viewFor(0, 24, true)).toEqual([1]);
  });
});

describe("nextView / prevView", () => {
  it("walks spreads from the cover to the end and back", () => {
    expect(nextView(1, 24, true)).toEqual([2, 3]);
    expect(nextView(2, 24, true)).toEqual([4, 5]);
    expect(nextView(3, 24, true)).toEqual([4, 5]);
    expect(nextView(22, 24, true)).toEqual([24]);
    expect(prevView(24, 24, true)).toEqual([22, 23]);
    expect(prevView(3, 24, true)).toEqual([1]);
    expect(prevView(2, 24, true)).toEqual([1]);
  });
  it("stays put at both ends", () => {
    expect(nextView(24, 24, true)).toEqual([24]);
    expect(nextView(24, 25, true)).toEqual([24, 25]);
    expect(nextView(24, 24, false)).toEqual([24]);
    expect(prevView(1, 24, true)).toEqual([1]);
    expect(prevView(1, 24, false)).toEqual([1]);
    expect(nextView(1, 1, true)).toEqual([1]);
    expect(prevView(1, 1, false)).toEqual([1]);
  });
  it("steps one page at a time in single mode", () => {
    expect(nextView(5, 24, false)).toEqual([6]);
    expect(prevView(5, 24, false)).toEqual([4]);
  });
});

describe("layout mode switch", () => {
  it("keeps the current page on screen", () => {
    for (const n of [1, 2, 24, 25]) {
      for (let page = 1; page <= n; page++) {
        expect(viewFor(page, n, true)).toContain(page);
        expect(viewFor(page, n, false)).toContain(page);
      }
    }
  });
  it("a spread's anchor page opens the matching single page", () => {
    const [anchor] = nextView(1, 24, true); // → [2, 3]
    expect(viewFor(anchor, 24, false)).toEqual([2]);
    expect(viewFor(anchor, 24, true)).toEqual([2, 3]);
  });
});

describe("prefetchPages", () => {
  it("returns the neighbouring views, next first, never visible pages", () => {
    expect(prefetchPages(2, 24, true)).toEqual([4, 5, 1]);
    expect(prefetchPages(5, 24, false)).toEqual([6, 4]);
    expect(prefetchPages(1, 24, true)).toEqual([2, 3]);
    expect(prefetchPages(24, 24, true)).toEqual([22, 23]);
  });
  it("is empty for a single-page comic", () => {
    expect(prefetchPages(1, 1, true)).toEqual([]);
  });
  it("never includes a visible page", () => {
    for (let page = 1; page <= 25; page++) {
      const visible = viewFor(page, 25, true);
      for (const p of prefetchPages(page, 25, true)) expect(visible).not.toContain(p);
    }
  });
});

describe("shouldUseSpread", () => {
  const portrait = 2 / 3;
  it("uses spreads on a wide, landscape stage", () => {
    expect(shouldUseSpread(1400, 700, portrait)).toBe(true);
  });
  it("keeps single pages when spreading would shrink them", () => {
    expect(shouldUseSpread(900, 1100, portrait)).toBe(false);
  });
  it("keeps single pages below the minimum width", () => {
    expect(shouldUseSpread(899, 400, portrait)).toBe(false);
    expect(shouldUseSpread(1000, 400, portrait, 1200)).toBe(false);
  });
  it("rejects unusable sizes", () => {
    expect(shouldUseSpread(NaN, 700, portrait)).toBe(false);
    expect(shouldUseSpread(1400, 0, portrait)).toBe(false);
    expect(shouldUseSpread(1400, 700, 0)).toBe(false);
  });
});

describe("fitScale", () => {
  it("fits the box, then multiplies by the device pixel ratio", () => {
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 600, boxH: 900, dpr: 1 })).toBe(1);
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 1200, boxH: 900, dpr: 1 })).toBe(1);
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 300, boxH: 900, dpr: 2 })).toBe(1);
  });
  it("caps the pixel ratio at 2", () => {
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 600, boxH: 900, dpr: 3 })).toBe(2);
  });
  it("treats a missing or sub-1 pixel ratio as 1", () => {
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 600, boxH: 900, dpr: 0 })).toBe(1);
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 600, boxH: 900, dpr: 0.5 })).toBe(1);
  });
  it("caps the longest edge at 4096 px", () => {
    const s = fitScale({ pageW: 1000, pageH: 1500, boxW: 3000, boxH: 4500, dpr: 2 });
    expect(s).toBeCloseTo(MAX_CANVAS_EDGE / 1500);
    expect(1500 * s).toBeLessThanOrEqual(MAX_CANVAS_EDGE + 1e-9);
  });
  it("caps the canvas area at 16,777,216 px", () => {
    const s = fitScale({
      pageW: 1000,
      pageH: 1000,
      boxW: 8000,
      boxH: 8000,
      dpr: 1,
      maxEdge: 8192,
    });
    expect(s * 1000 * s * 1000).toBeLessThanOrEqual(MAX_CANVAS_AREA * (1 + 1e-9));
    expect(s).toBeCloseTo(Math.sqrt(MAX_CANVAS_AREA / 1e6));
  });
  it("returns 0 for unusable sizes so callers skip the render", () => {
    expect(fitScale({ pageW: 600, pageH: 900, boxW: 0, boxH: 900, dpr: 1 })).toBe(0);
    expect(fitScale({ pageW: NaN, pageH: 900, boxW: 600, boxH: 900, dpr: 1 })).toBe(0);
  });
  it("multiplies by the pinch-zoom factor after capping the pixel ratio", () => {
    const phone = { pageW: 600, pageH: 900, boxW: 300, boxH: 450 };
    expect(fitScale({ ...phone, dpr: 2, zoom: 2 })).toBe(2);
    // A 3× screen is still rendered at 2× per screen pixel, then zoomed.
    expect(fitScale({ ...phone, dpr: 3, zoom: 2.5 })).toBe(2.5);
  });
  it("treats a zoom below 1 or an unusable zoom as no zoom", () => {
    const base = { pageW: 600, pageH: 900, boxW: 600, boxH: 900, dpr: 1 };
    expect(fitScale({ ...base, zoom: 0.5 })).toBe(1);
    expect(fitScale({ ...base, zoom: NaN })).toBe(1);
  });
  it("keeps the canvas caps however far the page is zoomed", () => {
    const s = fitScale({ pageW: 600, pageH: 900, boxW: 300, boxH: 450, dpr: 2, zoom: 10 });
    expect(900 * s).toBeCloseTo(MAX_CANVAS_EDGE);
  });
});

describe("zoomStep", () => {
  it("is 1 when not zoomed or the scale is unusable", () => {
    expect(zoomStep(1)).toBe(1);
    expect(zoomStep(1.005)).toBe(1);
    expect(zoomStep(0.8)).toBe(1);
    expect(zoomStep(NaN)).toBe(1);
    expect(zoomStep(Infinity)).toBe(1);
  });
  it("rounds a zoom up to the next half step", () => {
    expect(zoomStep(1.02)).toBe(1.5);
    expect(zoomStep(1.5)).toBe(1.5);
    expect(zoomStep(2)).toBe(2);
    expect(zoomStep(2.01)).toBe(2.5);
    expect(zoomStep(3.3)).toBe(3.5);
  });
});

describe("widthBucket / scaleForBucket", () => {
  it("rounds up to a multiple of 256", () => {
    expect(widthBucket(1)).toBe(256);
    expect(widthBucket(256)).toBe(256);
    expect(widthBucket(257)).toBe(512);
    expect(widthBucket(1199.5)).toBe(1280);
  });
  it("is 0 when there is no width yet", () => {
    expect(widthBucket(0)).toBe(0);
    expect(widthBucket(-5)).toBe(0);
    expect(widthBucket(NaN)).toBe(0);
  });
  it("renders a bucket at its full width, within the canvas caps", () => {
    expect(scaleForBucket(1280, 640, 960)).toBe(2);
    // 2816 px wide would make a 2:3 page 4224 px tall → capped to 4096.
    expect(scaleForBucket(2816, 1000, 1500) * 1500).toBeCloseTo(MAX_CANVAS_EDGE);
    expect(scaleForBucket(0, 640, 960)).toBe(0);
  });
});

describe("parsePageHash / pageHash", () => {
  it("reads #page=N only", () => {
    expect(parsePageHash("#page=3")).toBe(3);
    expect(parsePageHash("#page=0")).toBeNull();
    expect(parsePageHash("#page=abc")).toBeNull();
    expect(parsePageHash("#p=3")).toBeNull();
    expect(parsePageHash("#page=3&x=1")).toBeNull();
    expect(parsePageHash("#page=-2")).toBeNull();
    expect(parsePageHash("")).toBeNull();
    expect(parsePageHash("#main-content")).toBeNull();
  });
  it("clamps to the page count when given", () => {
    expect(parsePageHash("#page=99", 24)).toBe(24);
    expect(parsePageHash("#page=12", 24)).toBe(12);
  });
  it("round-trips", () => {
    expect(pageHash(7)).toBe("#page=7");
    expect(parsePageHash(pageHash(7), 24)).toBe(7);
  });
});

describe("pageLabel", () => {
  it("names a single page or a spread", () => {
    expect(pageLabel([1], 24)).toBe("Page 1 of 24");
    expect(pageLabel([2, 3], 24)).toBe("Pages 2–3 of 24");
  });
});

describe("readerKeyAction", () => {
  const key = (k: string, extra: Partial<ReaderKeyEvent> = {}): ReaderKeyEvent => ({
    key: k,
    target: document.body,
    ...extra,
  });
  const idle = { focused: false, fullscreen: false };
  const focused = { focused: true, fullscreen: false };
  const fullscreen = { focused: false, fullscreen: true };

  it("maps the arrows anywhere on the page", () => {
    expect(readerKeyAction(key("ArrowLeft"), idle)).toBe("prev");
    expect(readerKeyAction(key("ArrowRight"), idle)).toBe("next");
  });

  it("maps Home/End/PageUp/PageDown/Space/F only when focused or fullscreen", () => {
    for (const ctx of [focused, fullscreen]) {
      expect(readerKeyAction(key("Home"), ctx)).toBe("first");
      expect(readerKeyAction(key("End"), ctx)).toBe("last");
      expect(readerKeyAction(key("PageUp"), ctx)).toBe("prev");
      expect(readerKeyAction(key("PageDown"), ctx)).toBe("next");
      expect(readerKeyAction(key(" "), ctx)).toBe("next");
      expect(readerKeyAction(key(" ", { shiftKey: true }), ctx)).toBe("prev");
      expect(readerKeyAction(key("f"), ctx)).toBe("toggle-fullscreen");
      expect(readerKeyAction(key("F"), ctx)).toBe("toggle-fullscreen");
    }
    for (const k of ["Home", "End", "PageUp", "PageDown", " ", "f"]) {
      expect(readerKeyAction(key(k), idle)).toBeNull();
    }
  });

  it("ignores keys held with Meta, Ctrl or Alt", () => {
    for (const mod of ["metaKey", "ctrlKey", "altKey"] as const) {
      expect(readerKeyAction(key("ArrowRight", { [mod]: true }), focused)).toBeNull();
      expect(readerKeyAction(key("f", { [mod]: true }), fullscreen)).toBeNull();
    }
  });

  it("ignores events another handler already consumed", () => {
    expect(readerKeyAction(key("ArrowRight", { defaultPrevented: true }), focused)).toBeNull();
  });

  it("leaves text fields alone", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editor.appendChild(inner);
    for (const target of [input, textarea, inner]) {
      expect(readerKeyAction(key("ArrowLeft", { target }), focused)).toBeNull();
    }
  });

  it("leaves widgets that own the arrow keys alone", () => {
    for (const role of ["menu", "listbox", "tablist", "radiogroup", "dialog", "slider"]) {
      const widget = document.createElement("div");
      widget.setAttribute("role", role);
      const item = document.createElement("div");
      widget.appendChild(item);
      expect(readerKeyAction(key("ArrowRight", { target: item }), idle)).toBeNull();
      expect(readerKeyAction(key("ArrowRight", { target: widget }), idle)).toBeNull();
    }
  });

  it("does not let the reader's own dialog wrapper silence it", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const frame = document.createElement("div");
    const stage = document.createElement("div");
    dialog.appendChild(frame);
    frame.appendChild(stage);
    expect(
      readerKeyAction(key("ArrowRight", { target: stage }), { ...fullscreen, boundary: frame })
    ).toBe("next");
    // …but a slider inside the reader still owns its arrows.
    const slider = document.createElement("span");
    slider.setAttribute("role", "slider");
    frame.appendChild(slider);
    expect(
      readerKeyAction(key("ArrowRight", { target: slider }), { ...fullscreen, boundary: frame })
    ).toBeNull();
  });

  it("lets Space activate a focused button or link", () => {
    const button = document.createElement("button");
    expect(readerKeyAction(key(" ", { target: button }), fullscreen)).toBeNull();
    expect(readerKeyAction(key("ArrowRight", { target: button }), fullscreen)).toBe("next");
  });

  it("maps Escape to leaving the immersive overlay only while fullscreen", () => {
    expect(readerKeyAction(key("Escape"), fullscreen)).toBe("exit-immersive");
    expect(readerKeyAction(key("Escape"), focused)).toBeNull();
  });

  it("ignores unrelated keys and a missing target", () => {
    expect(readerKeyAction(key("a"), focused)).toBeNull();
    expect(readerKeyAction(key("ArrowUp"), focused)).toBeNull();
    expect(readerKeyAction({ key: "ArrowRight", target: null }, idle)).toBe("next");
  });
});
