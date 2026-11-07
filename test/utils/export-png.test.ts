/**
 * The shared PNG export (the kudos wall's image among others): a picture that
 * can't be fetched, or comes back as an error page that won't decode, is
 * drawn blank instead of failing the whole export.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ toPng: vi.fn(), saveAs: vi.fn() }));
vi.mock("html-to-image", () => ({ toPng: h.toPng }));
vi.mock("file-saver", () => ({ saveAs: h.saveAs }));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: vi.fn() }));

import { exportToPNG } from "@/lib/utils/export";

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
});
