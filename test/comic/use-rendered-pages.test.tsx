import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useRenderedPages } from "@/components/comic/reader/hooks/use-rendered-page";
import { DEFAULT_PAGE_CACHE_CAPACITY } from "@/lib/comic/page-url-cache";

/**
 * Jumping back to a page the LRU already evicted must show it again once it
 * re-renders. The page's last rendering keeps the same cache key, so the
 * hook has to notice the fresh blob URL rather than the unchanged key.
 *
 * A failed download poisons the document: pdf.js never re-requests a byte
 * range that failed, so a later render needing it waits forever. Once any
 * render (prefetches included) fails that way, the hook must stop asking
 * and report every uncached visible page as failed, never as a skeleton.
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

/** pdf.js's errors, as they arrive from the worker (matched on `name`). */
function pdfError(name: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(name), { name, ...extra });
}

/**
 * A document whose page renders follow `outcome(page, attempt)`: an Error
 * rejects, "hang" never settles (pdf.js re-asking for a failed range), and
 * anything else succeeds. `renders` counts render calls per page.
 */
function scriptedDoc(outcome: (page: number, attempt: number) => Error | "hang" | null) {
  const renders = new Map<number, number>();
  const doc = {
    getPage: async (page: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
      render: () => {
        const attempt = (renders.get(page) ?? 0) + 1;
        renders.set(page, attempt);
        const result = outcome(page, attempt);
        const promise =
          result === "hang"
            ? new Promise<void>(() => {})
            : result
              ? Promise.reject(result)
              : Promise.resolve();
        return { promise, cancel: () => {} };
      },
      cleanup: () => {},
    }),
  } as unknown as PDFDocumentProxy;
  return { doc, renders };
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

describe("useRenderedPages after a failed download", () => {
  /** Read page 11 with 12 prefetched, then turn to page 12. */
  async function turnToPrefetchedPage(doc: PDFDocumentProxy) {
    const hook = renderHook(
      ({ visible, prefetch }: { visible: number[]; prefetch: number[] }) =>
        useRenderedPages({ doc, visible, prefetch, bucket: 256 }),
      { initialProps: { visible: [11], prefetch: [12] } }
    );
    await waitFor(() => expect(hook.result.current.urls.has(11)).toBe(true));
    // The idle prefetch of page 12 fails; nobody awaits it.
    await waitFor(() => expect(hook.result.current.broken).toBe(true));
    hook.rerender({ visible: [12], prefetch: [13] });
    return hook;
  }

  it("notices an expired link on a prefetch and offers the reload, not a skeleton", async () => {
    const { doc, renders } = scriptedDoc((page, attempt) =>
      page !== 12 ? null : attempt === 1 ? pdfError("ResponseException", { status: 400 }) : "hang"
    );
    const { result } = await turnToPrefetchedPage(doc);

    expect(result.current.expired).toBe(true);
    expect(result.current.urls.has(12)).toBe(false);
    expect(result.current.failed.has(12)).toBe(true);
    // Asking pdf.js again would hang: page 12 is not re-requested.
    expect(renders.get(12)).toBe(1);
    expect(renders.has(13)).toBe(false);
  });

  it("treats a network failure on a prefetch the same way, without calling it expired", async () => {
    const { doc, renders } = scriptedDoc((page, attempt) =>
      page !== 12 ? null : attempt === 1 ? pdfError("UnknownErrorException") : "hang"
    );
    const { result } = await turnToPrefetchedPage(doc);

    expect(result.current.expired).toBe(false);
    expect(result.current.failed.has(12)).toBe(true);
    expect(renders.get(12)).toBe(1);
  });

  it("keeps a failed page failed after it leaves the view and comes back", async () => {
    const { doc, renders } = scriptedDoc((page, attempt) =>
      page !== 2 ? null : attempt === 1 ? pdfError("ResponseException", { status: 500 }) : "hang"
    );
    const { result, rerender } = renderHook(
      ({ visible }: { visible: number[] }) =>
        useRenderedPages({ doc, visible, prefetch: [], bucket: 256 }),
      { initialProps: { visible: [1] } }
    );
    await waitFor(() => expect(result.current.urls.has(1)).toBe(true));
    rerender({ visible: [2] });
    await waitFor(() => expect(result.current.failed.has(2)).toBe(true));
    expect(result.current.broken).toBe(true);

    rerender({ visible: [1] });
    // Page 1 is cached, so it still shows.
    expect(result.current.urls.has(1)).toBe(true);
    rerender({ visible: [2] });
    expect(result.current.failed.has(2)).toBe(true);
    expect(renders.get(2)).toBe(1);
  });

  it("still retries a page in place when its render failed for another reason", async () => {
    const { doc, renders } = scriptedDoc((page, attempt) =>
      page === 12 && attempt === 1 ? new Error("canvas lost") : null
    );
    const { result, rerender } = renderHook(
      ({ visible, prefetch }: { visible: number[]; prefetch: number[] }) =>
        useRenderedPages({ doc, visible, prefetch, bucket: 256 }),
      { initialProps: { visible: [11], prefetch: [12] } }
    );
    await waitFor(() => expect(result.current.urls.has(11)).toBe(true));
    await waitFor(() => expect(renders.get(12)).toBe(1));
    // Let the failed prefetch settle, so page 12 gets a job of its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    rerender({ visible: [12], prefetch: [13] });
    await waitFor(() => expect(result.current.urls.has(12)).toBe(true));
    expect(result.current.broken).toBe(false);
    expect(result.current.expired).toBe(false);
  });
});
