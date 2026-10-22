import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { COMIC_DOWNLOAD_NAME, formatBytes } from "@/lib/comic/agile-at-work";

/**
 * Agile at Work (comic reader) gap-filling: the hooks the reader is built
 * from — element size, pinch-zoom detection, fullscreen with its immersive
 * fallback, the scroll lock and inert siblings, and the PDF loader's states
 * (progress, ready, each error, timeout, retry) — plus the status panels.
 * (The reader itself, swipes and the toolbar are covered in test/comic.)
 */

const { loadPdfjs } = vi.hoisted(() => ({ loadPdfjs: vi.fn() }));
vi.mock("@/lib/pdf/load-pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/load-pdfjs")>()),
  loadPdfjs,
}));

import { useElementSize } from "@/app/(tools)/agile-at-work/hooks/use-element-size";
import { useIsZoomed } from "@/app/(tools)/agile-at-work/hooks/use-page-swipe";
import {
  useBodyScrollLock,
  useFullscreen,
  useInertSiblings,
} from "@/app/(tools)/agile-at-work/hooks/use-fullscreen";
import { usePdfDocument } from "@/app/(tools)/agile-at-work/hooks/use-pdf-document";
import {
  ComicComingSoon,
  ComicErrorPanel,
  DownloadPdfButton,
} from "@/app/(tools)/agile-at-work/components/comic-status";

const SRC = "/comics/agile-at-work.pdf?v=abc123";

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 } as DOMRect;
}

function sizedElement(width: number, height: number) {
  const el = document.createElement("div");
  const box = { width, height };
  el.getBoundingClientRect = () => rect(box.width, box.height);
  return { el, box };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useElementSize", () => {
  it("is 0 × 0 without an element, and measures (rounded) as soon as there is one", () => {
    expect(renderHook(() => useElementSize(null)).result.current).toEqual({ width: 0, height: 0 });
    const { el } = sizedElement(300.4, 200.6);
    expect(renderHook(() => useElementSize(el)).result.current).toEqual({
      width: 300,
      height: 201,
    });
  });

  it("debounces resize-observer callbacks", () => {
    vi.useFakeTimers();
    let notify = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    const { el, box } = sizedElement(300, 200);
    const { result } = renderHook(() => useElementSize(el, 150));
    box.width = 500;
    act(() => {
      notify();
      vi.advanceTimersByTime(100);
      notify();
      vi.advanceTimersByTime(100);
    });
    expect(result.current.width).toBe(300);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toEqual({ width: 500, height: 200 });
  });

  it("falls back to window resize without ResizeObserver", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { el, box } = sizedElement(320, 480);
    const { result } = renderHook(() => useElementSize(el));
    box.height = 640;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ width: 320, height: 640 });
  });
});

describe("useIsZoomed", () => {
  afterEach(() => {
    delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it("follows the visual viewport's pinch scale", () => {
    const vv = Object.assign(new EventTarget(), { scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const { result } = renderHook(() => useIsZoomed());
    expect(result.current).toBe(false);
    vv.scale = 1.005; // within rounding noise
    act(() => {
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(false);
    vv.scale = 2;
    act(() => {
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(true);
  });

  it("is never zoomed where there's no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    expect(renderHook(() => useIsZoomed()).result.current).toBe(false);
  });
});

describe("useFullscreen", () => {
  type Doc = Document & Record<string, unknown>;
  const doc = document as Doc;
  let fsElement: Element | null = null;

  beforeEach(() => {
    fsElement = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fsElement,
    });
  });
  afterEach(() => {
    for (const k of ["fullscreenElement", "fullscreenEnabled", "webkitFullscreenEnabled"]) {
      delete doc[k];
    }
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  });

  function setup(el: HTMLElement) {
    document.body.appendChild(el);
    const ref = { current: el } as RefObject<HTMLElement>;
    return renderHook(() => useFullscreen(ref));
  }

  it("uses an immersive overlay where element fullscreen isn't supported", () => {
    const { result } = setup(document.createElement("div"));
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ immersive: true, isFullscreen: true });
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ immersive: false, isFullscreen: false });
    act(() => result.current.toggle());
    act(() => result.current.exitImmersive());
    expect(result.current.isFullscreen).toBe(false);
  });

  it("requests native fullscreen, tracks fullscreenchange, and exits when toggled again", () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const exitFullscreen = vi.fn(async () => {});
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    const el = document.createElement("div");
    const requestFullscreen = vi.fn(async () => {});
    el.requestFullscreen = requestFullscreen;
    const { result } = setup(el);

    act(() => result.current.toggle());
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.isFullscreen).toBe(false);
    fsElement = el;
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current).toMatchObject({ isFullscreen: true, immersive: false });

    act(() => result.current.toggle());
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    // The browser leaving (Esc) is picked up from the prefixed event too.
    fsElement = null;
    act(() => {
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it("falls back to the overlay when the request is refused", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const el = document.createElement("div");
    el.requestFullscreen = vi.fn(async () => {
      throw new Error("denied");
    });
    const { result } = setup(el);
    await act(async () => result.current.toggle());
    expect(result.current).toMatchObject({ immersive: true, isFullscreen: true });
  });

  it("uses Safari's prefixed API", () => {
    Object.defineProperty(document, "webkitFullscreenEnabled", { configurable: true, value: true });
    const el = document.createElement("div") as HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
    };
    Object.defineProperty(el, "requestFullscreen", { configurable: true, value: undefined });
    el.webkitRequestFullscreen = vi.fn();
    const { result } = setup(el);
    act(() => result.current.toggle());
    expect(el.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.immersive).toBe(false);
  });
});

describe("useBodyScrollLock and useInertSiblings", () => {
  it("locks body scroll until the last lock is released, then restores it", () => {
    document.body.style.overflow = "scroll";
    const a = renderHook(({ on }) => useBodyScrollLock(on), { initialProps: { on: true } });
    const b = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.overflow).toBe("hidden");
    a.rerender({ on: false });
    expect(document.body.style.overflow).toBe("hidden");
    b.unmount();
    expect(document.body.style.overflow).toBe("scroll");
    expect((window as { __scrollLockCount?: number }).__scrollLockCount).toBe(0);
    a.unmount();
    document.body.style.overflow = "";
  });

  it("makes the overlay's siblings inert while open, leaving already-inert ones alone", () => {
    const app = document.createElement("main");
    const portal = document.createElement("div");
    portal.setAttribute("inert", "");
    const overlay = document.createElement("div");
    document.body.append(app, portal, overlay);
    const ref = { current: overlay } as RefObject<HTMLElement>;
    const hook = renderHook(({ on }) => useInertSiblings(ref, on), {
      initialProps: { on: true },
    });
    expect(app).toHaveAttribute("inert");
    expect(overlay).not.toHaveAttribute("inert");

    hook.rerender({ on: false });
    expect(app).not.toHaveAttribute("inert");
    expect(portal).toHaveAttribute("inert");
  });

  it("does nothing for an overlay that isn't portalled into the body", () => {
    const app = document.createElement("main");
    const overlay = document.createElement("div");
    app.appendChild(overlay);
    const sibling = document.createElement("aside");
    document.body.append(app, sibling);
    renderHook(() => useInertSiblings({ current: overlay } as RefObject<HTMLElement>, true));
    expect(sibling).not.toHaveAttribute("inert");
  });
});

describe("usePdfDocument", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function fakePdfjs(pageWidth = 600) {
    const opened = deferred<unknown>();
    const task = {
      promise: opened.promise,
      onProgress: null as null | ((p: { loaded: number; total: number }) => void),
      destroy: vi.fn(async () => {}),
    };
    const pdfjs = {
      VerbosityLevel: { ERRORS: 0 },
      getDocument: vi.fn(() => task),
    };
    const doc = (numPages: number) => ({
      numPages,
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: pageWidth * scale,
          height: 900 * scale,
        }),
      })),
    });
    return { pdfjs, task, opened, doc };
  }

  const pdfError = (name: string) => Object.assign(new Error(name), { name });

  beforeEach(() => loadPdfjs.mockReset());

  it("reports download progress, then the page count and page-1 size", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    expect(result.current).toMatchObject({ status: "loading", progress: null });
    await act(async () => {});
    expect(fake.pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SRC,
        rangeChunkSize: 1 << 20,
        disableAutoFetch: true,
        disableStream: true,
      })
    );

    act(() => fake.task.onProgress!({ loaded: 50, total: 0 }));
    expect(result.current).toMatchObject({ status: "loading", progress: null });
    act(() => fake.task.onProgress!({ loaded: 50, total: 200 }));
    expect(result.current).toMatchObject({ status: "loading", progress: 0.25 });
    act(() => fake.task.onProgress!({ loaded: 300, total: 200 }));
    expect(result.current).toMatchObject({ progress: 1 });

    await act(async () => fake.opened.resolve(fake.doc(24)));
    expect(result.current).toMatchObject({
      status: "ready",
      numPages: 24,
      pageSize: { width: 600, height: 900 },
    });
  });

  it.each([
    ["a PDF with no pages", null, "invalid"],
    ["a password-protected PDF", "PasswordException", "password"],
    ["a damaged PDF", "InvalidPDFException", "invalid"],
    ["a load cancelled by a dying worker", "AbortException", "other"],
  ])("reports %s as %s", async (_label, errorName, kind) => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await act(async () => {});
    await act(async () => {
      if (errorName) fake.opened.reject(pdfError(errorName));
      else fake.opened.resolve(fake.doc(0));
    });
    expect(result.current).toMatchObject({ status: "error", kind });
    expect(fake.task.destroy).toHaveBeenCalled();
  });

  it("gives up after 30 seconds, and Retry loads again", async () => {
    vi.useFakeTimers();
    const slow = fakePdfjs();
    loadPdfjs.mockResolvedValue(slow.pdfjs);
    const { result } = renderHook(() => usePdfDocument(SRC));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current).toMatchObject({ status: "error", kind: "timeout" });
    expect(slow.task.destroy).toHaveBeenCalled();

    const fast = fakePdfjs();
    loadPdfjs.mockResolvedValue(fast.pdfjs);
    act(() => result.current.retry());
    expect(result.current).toMatchObject({ status: "loading", progress: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      fast.opened.resolve(fast.doc(3));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toMatchObject({ status: "ready", numPages: 3 });
  });

  it("tears the loading task down on unmount", async () => {
    const fake = fakePdfjs();
    loadPdfjs.mockResolvedValue(fake.pdfjs);
    const { unmount } = renderHook(() => usePdfDocument(SRC));
    await act(async () => {});
    unmount();
    expect(fake.task.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("comic status panels", () => {
  it("explains a timeout, offers Retry and a sized download", () => {
    const onRetry = vi.fn();
    render(<ComicErrorPanel kind="timeout" onRetry={onRetry} src={SRC} size={12_897_485} />);
    expect(
      screen.getByText("The comic took too long to load. Check your connection and try again.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const link = screen.getByRole("link", { name: /Download PDF/ });
    expect(link).toHaveAttribute("href", SRC);
    expect(link).toHaveAttribute("download", COMIC_DOWNLOAD_NAME);
    expect(link).toHaveAccessibleName(`Download PDF (${formatBytes(12_897_485)})`);
  });

  it("names a reader crash", () => {
    render(<ComicErrorPanel kind="crash" onRetry={() => {}} src={SRC} size={null} />);
    expect(screen.getByText("The reader hit an unexpected error.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("leaves the size out when it's unknown", () => {
    render(<DownloadPdfButton src={SRC} size={null} />);
    expect(screen.getByRole("link")).toHaveAccessibleName("Download PDF");
  });

  it("links back to the tools while the comic is coming soon", () => {
    render(<ComicComingSoon />);
    expect(screen.getByText(/is coming soon$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to tools" })).toHaveAttribute("href", "/");
  });
});
