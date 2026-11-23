/**
 * The shared PNG export (the kudos wall's image among others): a picture that
 * can't be fetched, or comes back as an error page that won't decode, is
 * drawn blank instead of failing the whole export; and a control marked
 * EXPORT_SKIP stays on the page and out of the picture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toPng: vi.fn(), saveAs: vi.fn() }));
vi.mock("html-to-image", () => ({ toPng: h.toPng }));
vi.mock("file-saver", () => ({ saveAs: h.saveAs }));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: vi.fn() }));

import { exportToPNG } from "@/lib/utils/export";
import { EXPORT_SKIP, keepInExport } from "@/lib/utils/export-skip";

beforeEach(() => {
  h.toPng.mockReset();
  h.saveAs.mockReset();
  h.toPng.mockResolvedValue("data:image/png;base64,AAAA");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("exportToPNG", () => {
  it("draws a blank for a picture it can't fetch or decode, and saves the image", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await exportToPNG(el, "kudos-wall");

    expect(h.toPng).toHaveBeenCalledTimes(1);
    const [node, options] = h.toPng.mock.calls[0];
    expect(node).toBe(el);
    expect(options.imagePlaceholder).toMatch(/^data:image\/gif;base64,/);
    // html-to-image rejects the capture on a cloned picture's decode error
    // unless this handler is given; it must not throw either.
    expect(typeof options.onImageErrorHandler).toBe("function");
    expect(() => options.onImageErrorHandler(new Event("error"))).not.toThrow();
    expect(h.saveAs).toHaveBeenCalledWith("data:image/png;base64,AAAA", "kudos-wall.png");
  });

  it("leaves out of the picture what is marked to stay on the page, and keeps the rest", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    await exportToPNG(el, "impact-map");
    const { filter } = h.toPng.mock.calls[0][1] as { filter: (n: Node) => boolean };
    expect(filter).toBe(keepInExport);

    const skipped = document.createElement("div");
    Object.entries(EXPORT_SKIP).forEach(([k, v]) => skipped.setAttribute(k, v));
    expect(filter(skipped)).toBe(false);
    expect(filter(document.createElement("article"))).toBe(true);
    // A text node and an SVG part go through as they are.
    expect(filter(document.createTextNode("Grow repeat orders"))).toBe(true);
    expect(filter(document.createElementNS("http://www.w3.org/2000/svg", "path"))).toBe(true);
  });
});
