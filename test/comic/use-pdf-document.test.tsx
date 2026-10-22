import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Opening the comic times out on silence, not on total time. The signed URL
 * is cross-origin; if Supabase doesn't expose `Accept-Ranges` to the page,
 * pdf.js downloads the whole file (up to 50 MB) before page 1. A fixed 30 s
 * budget would then kill — and Retry would restart from byte 0 — any big
 * download on a slow phone connection, so it could never open.
 */

const { loadPdfjs } = vi.hoisted(() => ({ loadPdfjs: vi.fn() }));

vi.mock("@/lib/pdf/load-pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/load-pdfjs")>()),
  loadPdfjs,
}));

import { usePdfDocument } from "@/components/comic/reader/hooks/use-pdf-document";

const SRC =
  "https://ref.supabase.co/storage/v1/object/sign/comics/agile-at-work.pdf?token=signed-url-token";
const MB = 1 << 20;
const TOTAL = 40 * MB;

type Progress = (data: { loaded: number; total: number }) => void;

function fakePdfjs() {
  let resolveDoc!: (doc: unknown) => void;
  const task = {
    promise: new Promise((resolve) => {
      resolveDoc = resolve;
    }),
    onProgress: null as Progress | null,
    destroy: vi.fn(async () => {}),
  };
  const doc = {
    numPages: 24,
    getPage: async () => ({ getViewport: () => ({ width: 600, height: 900 }) }),
  };
  return {
    pdfjs: { VerbosityLevel: { ERRORS: 0 }, getDocument: vi.fn(() => task) },
    task,
    open: () => resolveDoc(doc),
    progress: (loaded: number) => task.onProgress?.({ loaded, total: TOTAL }),
  };
}

/** Let timers (and the promises they unblock) run. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  loadPdfjs.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePdfDocument load timeout", () => {
  it("keeps waiting while bytes keep arriving, however long the whole download takes", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await advance(0);
    expect(fake.pdfjs.getDocument).toHaveBeenCalledTimes(1);

    // Two minutes in all, never more than 20 s without a new chunk.
    for (let i = 1; i <= 6; i++) {
      await advance(20_000);
      act(() => fake.progress(i * 4 * MB));
    }
    expect(result.current.status).toBe("loading");
    expect(fake.task.destroy).not.toHaveBeenCalled();

    act(() => fake.open());
    await advance(0);
    expect(result.current.status).toBe("ready");
  });

  it("gives up after 30 s without a new byte", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await advance(0);

    act(() => fake.progress(4 * MB));
    await advance(29_000);
    // A repeat of the same count is not progress.
    act(() => fake.progress(4 * MB));
    await advance(1_000);

    expect(result.current).toMatchObject({ status: "error", kind: "timeout" });
    // Destroying the task aborts the download and shuts the worker down.
    expect(fake.task.destroy).toHaveBeenCalled();
  });

  it("times out when nothing arrives at all", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await advance(29_999);
    expect(result.current.status).toBe("loading");
    await advance(1);
    expect(result.current).toMatchObject({ status: "error", kind: "timeout" });
  });

  it("stops the clock once the comic is open", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await advance(0);
    act(() => fake.open());
    await advance(0);
    expect(result.current.status).toBe("ready");

    // Later pages keep reporting bytes; that must not start a timer.
    act(() => fake.progress(8 * MB));
    await advance(60_000);
    expect(result.current.status).toBe("ready");
    expect(fake.task.destroy).not.toHaveBeenCalled();
  });
});
