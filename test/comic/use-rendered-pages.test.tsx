import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useRenderedPages } from "@/app/(tools)/agile-at-work/hooks/use-rendered-page";
import { DEFAULT_PAGE_CACHE_CAPACITY, PageUrlCache } from "@/lib/comic/page-url-cache";

/**
 * Jumping back to a page the LRU already evicted must show it again once it
 * re-renders. The page's last rendering keeps the same cache key, so the
 * hook has to notice the fresh blob URL rather than the unchanged key.
 *
 * Blob URLs carry the canvas width they were drawn at (`blob:w<px>-<n>`),
 * so a test can tell a zoomed rendering from a prefetched one.
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
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb
  ) {
    cb(Object.assign(new Blob(["jpeg"], { type: "image/jpeg" }), { width: this.width }));
  });
  URL.createObjectURL = vi.fn(
    (blob: Blob & { width?: number }) => `blob:w${blob.width}-${++nextUrl}`
  ) as typeof URL.createObjectURL;
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

  it("prefetches at prefetchBucket and shows that rendering until the page's own is ready", async () => {
    const cached = vi.spyOn(PageUrlCache.prototype, "set");
    const doc = fakeDoc();
    // Pinch-zoomed: visible pages at 1024 px, neighbours at 256 px.
    const { result, rerender } = renderHook(
      ({ visible, prefetch }: { visible: number[]; prefetch: number[] }) =>
        useRenderedPages({ doc, visible, prefetch, bucket: 1024, prefetchBucket: 256 }),
      { initialProps: { visible: [1], prefetch: [2] } }
    );
    await waitFor(() => expect(result.current.urls.get(1)).toMatch(/^blob:w1024-/));
    await waitFor(() => expect(cached).toHaveBeenCalledWith("2@256", expect.any(String)));
    expect(cached).not.toHaveBeenCalledWith("2@1024", expect.any(String));

    // Turning to the prefetched page shows it at once, then sharpens it.
    rerender({ visible: [2], prefetch: [3] });
    expect(result.current.urls.get(2)).toMatch(/^blob:w256-/);
    await waitFor(() => expect(result.current.urls.get(2)).toMatch(/^blob:w1024-/));
  });
});
