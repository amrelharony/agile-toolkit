import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useRenderedPages } from "@/app/(tools)/agile-at-work/hooks/use-rendered-page";
import { DEFAULT_PAGE_CACHE_CAPACITY } from "@/lib/comic/page-url-cache";

/**
 * Jumping back to a page the LRU already evicted must show it again once it
 * re-renders. The page's last rendering keeps the same cache key, so the
 * hook has to notice the fresh blob URL rather than the unchanged key.
 */

function fakeDoc(): PDFDocumentProxy {
  return {
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy;
}

let nextUrl = 0;

beforeEach(() => {
  nextUrl = 0;
  // getContext is overloaded per context type; the 2D shape is all we need.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillStyle: "",
    fillRect: () => {},
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb) {
    cb(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
  URL.createObjectURL = vi.fn(() => `blob:page-${++nextUrl}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRenderedPages", () => {
  it("shows a page again after it was evicted from the cache and re-rendered", async () => {
    const doc = fakeDoc();
    const { result, rerender } = renderHook(
      ({ visible }: { visible: number[] }) =>
        useRenderedPages({ doc, visible, prefetch: [], bucket: 256 }),
      { initialProps: { visible: [1] } }
    );
    await waitFor(() => expect(result.current.urls.has(1)).toBe(true));
    const first = result.current.urls.get(1);

    // Read far enough ahead that page 1 falls out of the LRU.
    for (let page = 2; page <= DEFAULT_PAGE_CACHE_CAPACITY + 2; page++) {
      rerender({ visible: [page] });
      await waitFor(() => expect(result.current.urls.has(page)).toBe(true));
    }
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);

    rerender({ visible: [1] });
    await waitFor(() => expect(result.current.urls.has(1)).toBe(true));
    expect(result.current.urls.get(1)).not.toBe(first);
  });
});
