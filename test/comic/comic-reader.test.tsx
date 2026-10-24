import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_EDITION_LAST_PAGE_KEY, COMIC_LAST_PAGE_KEY } from "@/lib/comic/agile-at-work";

/**
 * The "Agile at Work" reader against a fake pdf.js: page images, keyboard,
 * #page=N deep links, the resume chip, error / coming-soon fallbacks and
 * the toolbar's accessible names. jsdom has no canvas, so the canvas,
 * toBlob and blob-URL APIs are stubbed; the stage measures 800 × 900, which
 * is below the 900 px spread threshold (single pages).
 */

const { loadPdfjs, emit } = vi.hoisted(() => ({ loadPdfjs: vi.fn(), emit: vi.fn() }));

vi.mock("@/lib/pdf/load-pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/load-pdfjs")>()),
  loadPdfjs,
}));
vi.mock("@/lib/sonification/emit", () => ({ emit }));

import { ComicReader } from "@/app/(tools)/agile-at-work/components/comic-reader";
import { AgileAtWorkClient } from "@/app/(tools)/agile-at-work/agile-at-work-client";

const SRC = "/comics/agile-at-work.pdf?v=abc123";
const SIZE = 12_897_485;

function fakePdfjs(numPages = 24) {
  /** Every page render, with the pixel width it was drawn at. */
  const renders: { page: number; width: number }[] = [];
  const doc = {
    numPages,
    getPage: vi.fn(async (page: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
      render: vi.fn(({ viewport }: { viewport: { width: number } }) => {
        renders.push({ page, width: viewport.width });
        return { promise: Promise.resolve(), cancel: vi.fn() };
      }),
      cleanup: vi.fn(),
    })),
  };
  const task = {
    promise: Promise.resolve(doc),
    onProgress: null as unknown,
    destroy: vi.fn(async () => {}),
  };
  return {
    VerbosityLevel: { ERRORS: 0 },
    getDocument: vi.fn(() => task),
    task,
    renders,
  };
}

function pdfError(name: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(name), { name, ...extra });
}

let blobCount = 0;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:page-${++blobCount}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/agile-at-work");
  localStorage.clear();
  emit.mockReset();
  loadPdfjs.mockReset();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 900,
    top: 0,
    left: 0,
    right: 800,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  // getContext is overloaded per context type; only "2d" is used here.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    fillStyle: "",
    fillRect: () => {},
  })) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) =>
    cb(new Blob(["jpeg"], { type: "image/jpeg" }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("ComicReader", () => {
  it("opens the PDF with range requests and shows page 1", async () => {
    const pdfjs = fakePdfjs();
    loadPdfjs.mockResolvedValue(pdfjs);
    render(<ComicReader src={SRC} size={SIZE} />);

    expect(await screen.findByAltText("Agile at Work — page 1 of 24")).toBeInTheDocument();
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SRC,
        rangeChunkSize: 1 << 20,
        disableAutoFetch: true,
        disableStream: true,
      })
    );
    // The cover keeps a clean URL.
    expect(window.location.hash).toBe("");
  });

  it("turns pages with the arrow keys and mirrors them in #page=N", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByAltText("Agile at Work — page 2 of 24")).toBeInTheDocument();
    expect(window.location.hash).toBe("#page=2");
    expect(screen.getByText("Page 2 of 24", { selector: "[aria-live]" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByAltText("Agile at Work — page 1 of 24")).toBeInTheDocument();
    expect(window.location.hash).toBe("#page=1");
  });

  it("scopes End (and other single keys) to the focused reader", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByText("Page 1 of 24", { selector: "[aria-live]" })).toBeInTheDocument();

    const stage = screen.getByRole("region", { name: "Agile at Work comic" });
    act(() => stage.focus());
    fireEvent.keyDown(stage, { key: "End" });
    expect(await screen.findByAltText("Agile at Work — page 24 of 24")).toBeInTheDocument();
    expect(emit).toHaveBeenCalledWith("agile-at-work", "finished");

    // Meta/Ctrl shortcuts belong to the app (command palette, undo…).
    fireEvent.keyDown(stage, { key: "ArrowLeft", metaKey: true });
    expect(screen.getByText("Page 24 of 24", { selector: "[aria-live]" })).toBeInTheDocument();
  });

  it("opens on the page named in #page=N", async () => {
    window.history.replaceState(null, "", "/agile-at-work#page=5");
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    expect(await screen.findByAltText("Agile at Work — page 5 of 24")).toBeInTheDocument();
  });

  it("offers to resume from the saved page instead of jumping there", async () => {
    localStorage.setItem(COMIC_LAST_PAGE_KEY, "7");
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    fireEvent.click(await screen.findByRole("button", { name: /Continue from p\. 7/ }));
    expect(await screen.findByAltText("Agile at Work — page 7 of 24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue from/ })).toBeNull();
  });

  it("hands focus to the stage when the resume chip is dismissed", async () => {
    localStorage.setItem(COMIC_LAST_PAGE_KEY, "7");
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    const dismiss = await screen.findByRole("button", { name: "Dismiss, start from the cover" });
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    expect(screen.queryByRole("button", { name: /Continue from/ })).toBeNull();
    // Not <body>: the stage-scoped keys (Home, End, Space, F…) keep working.
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Agile at Work comic" })
    );
  });

  it("keeps the scrubber label and thumb in step after keyboard use (Radix commits first)", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    const controls = screen.getByRole("group", { name: "Comic reader controls" });
    const thumb = within(controls).getByRole("slider", { name: "Go to page" });
    act(() => thumb.focus());
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(await screen.findByAltText("Agile at Work — page 2 of 24")).toBeInTheDocument();

    const next = within(controls).getByRole("button", { name: "Next page" });
    for (let i = 0; i < 3; i++) fireEvent.click(next);
    expect(await screen.findByAltText("Agile at Work — page 5 of 24")).toBeInTheDocument();
    expect(within(controls).getByText("Page 5 of 24")).toBeInTheDocument();
    expect(thumb).toHaveAttribute("aria-valuenow", "5");
    expect(thumb).toHaveAttribute("aria-valuetext", "Page 5 of 24");

    // The next keyboard step starts from the real page, not a stale preview.
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(await screen.findByAltText("Agile at Work — page 6 of 24")).toBeInTheDocument();
    expect(thumb).toHaveAttribute("aria-valuetext", "Page 6 of 24");
  });

  it("labels the toolbar controls and offers the PDF download", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    const controls = screen.getByRole("group", { name: "Comic reader controls" });
    // aria-disabled (not disabled) so focus survives reaching either end.
    expect(within(controls).getByRole("button", { name: "Previous page" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(within(controls).getByRole("button", { name: "Next page" })).toHaveAttribute(
      "aria-disabled",
      "false"
    );
    expect(within(controls).getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: "Auto" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const thumb = within(controls).getByRole("slider", { name: "Go to page" });
    expect(thumb).toHaveAttribute("aria-valuetext", "Page 1 of 24");

    const download = within(controls).getByRole("link", { name: "Download PDF (12.3 MB)" });
    expect(download).toHaveAttribute("href", SRC);
    expect(download).toHaveAttribute("download", "Agile-at-Work.pdf");
  });

  it("shows 'coming soon' when the PDF is missing", async () => {
    loadPdfjs.mockRejectedValue(pdfError("ResponseException", { status: 404, missing: true }));
    render(<ComicReader src={SRC} size={SIZE} />);
    expect(await screen.findByText("Agile at Work is coming soon")).toBeInTheDocument();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("shows Retry and Download when the PDF can't be read", async () => {
    loadPdfjs.mockRejectedValueOnce(pdfError("InvalidPDFException"));
    render(<ComicReader src={SRC} size={SIZE} />);
    expect(await screen.findByText(/couldn't be read/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download PDF/ })).toHaveAttribute("href", SRC);

    loadPdfjs.mockResolvedValue(fakePdfjs());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByAltText("Agile at Work — page 1 of 24")).toBeInTheDocument();
    expect(loadPdfjs).toHaveBeenCalledTimes(2);
  });

  it("does not offer Retry for a password-protected PDF", async () => {
    loadPdfjs.mockRejectedValue(pdfError("PasswordException"));
    render(<ComicReader src={SRC} size={SIZE} />);
    expect(await screen.findByText(/password-protected/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("link", { name: /Download PDF/ })).toBeInTheDocument();
  });
});

describe("ComicReader read-only (colour edition)", () => {
  it("offers no download in the toolbar", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} download={false} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    const controls = screen.getByRole("group", { name: "Comic reader controls" });
    expect(within(controls).getByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
    expect(within(controls).queryByRole("link", { name: /Download PDF/ })).toBeNull();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("offers Retry but no download when the PDF can't be read", async () => {
    loadPdfjs.mockRejectedValueOnce(pdfError("InvalidPDFException"));
    render(<ComicReader src={SRC} size={SIZE} download={false} />);
    expect(await screen.findByText(/couldn't be read/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/download the PDF/)).toBeNull();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("keeps its own resume point, apart from the free edition's", async () => {
    localStorage.setItem(COMIC_LAST_PAGE_KEY, "7");
    localStorage.setItem(COLOR_EDITION_LAST_PAGE_KEY, "12");
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(
      <ComicReader
        src={SRC}
        size={SIZE}
        download={false}
        lastPageKey={COLOR_EDITION_LAST_PAGE_KEY}
      />
    );
    expect(await screen.findByRole("button", { name: "Continue from p. 12" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue from p. 12" }));
    await waitFor(() => expect(localStorage.getItem(COLOR_EDITION_LAST_PAGE_KEY)).toBe("12"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(localStorage.getItem(COLOR_EDITION_LAST_PAGE_KEY)).toBe("13"));
    expect(localStorage.getItem(COMIC_LAST_PAGE_KEY)).toBe("7");
  });
});

describe("ComicReader pinch-zoom", () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");

  afterEach(() => {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
  });

  it("re-renders the page on screen for the zoom once the pinch rests", async () => {
    // jsdom has no visualViewport; an EventTarget with a scale stands in.
    const vv = Object.assign(new EventTarget(), { scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    const pdfjs = fakePdfjs();
    loadPdfjs.mockResolvedValue(pdfjs);
    render(<ComicReader src={SRC} size={SIZE} />);
    const alt = "Agile at Work — page 1 of 24";
    const before = (await screen.findByAltText(alt)).getAttribute("src");
    // 776 × 876 px inside the stage padding fits a 600 × 900 page 584 px
    // wide at 1× → the 768 px bucket.
    expect(pdfjs.renders).toContainEqual({ page: 1, width: 768 });

    act(() => {
      vv.scale = 2.5;
      vv.dispatchEvent(new Event("resize"));
    });
    // 584 × 2.5 = 1460 px → the 1536 px bucket, swapped in when drawn.
    await waitFor(() => expect(pdfjs.renders).toContainEqual({ page: 1, width: 1536 }));
    await waitFor(() => expect(screen.getByAltText(alt).getAttribute("src")).not.toBe(before));
    // Neighbours are never drawn at the zoomed size.
    expect(pdfjs.renders.filter((r) => r.page !== 1).every((r) => r.width === 768)).toBe(true);
  });
});

describe("ComicReader fullscreen", () => {
  afterEach(() => {
    delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled;
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it("uses the Fullscreen API on the reader frame when available", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    const requestFullscreen = vi.fn(async () => {});
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    loadPdfjs.mockResolvedValue(fakePdfjs());
    render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    const frame = requestFullscreen.mock.contexts[0] as HTMLElement;
    expect(frame).toContainElement(screen.getByRole("region", { name: "Agile at Work comic" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back to a modal overlay without the Fullscreen API (iPhone)", async () => {
    loadPdfjs.mockResolvedValue(fakePdfjs());
    const { container } = render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText("Agile at Work — page 1 of 24");

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    const dialog = await screen.findByRole("dialog", { name: "Agile at Work reader" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.parentElement).toBe(document.body);
    expect(container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    // The reader keeps its page and keys inside the overlay.
    expect(within(dialog).getByAltText("Agile at Work — page 1 of 24")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await within(dialog).findByAltText("Agile at Work — page 2 of 24")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Enter fullscreen" })).toHaveFocus();
    expect(screen.getByAltText("Agile at Work — page 2 of 24")).toBeInTheDocument();
  });
});

describe("AgileAtWorkClient", () => {
  it("shows 'coming soon' without a download when no PDF was built in", () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "");
    render(<AgileAtWorkClient />);

    expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeInTheDocument();
    expect(screen.getByText("Agile at Work is coming soon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to tools" })).toHaveAttribute("href", "/");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(loadPdfjs).not.toHaveBeenCalled();
  });

  it("mounts the reader on the versioned PDF when one was built in", async () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", String(SIZE));
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "abc123");
    const pdfjs = fakePdfjs();
    loadPdfjs.mockResolvedValue(pdfjs);
    render(<AgileAtWorkClient />);

    expect(await screen.findByAltText("Agile at Work — page 1 of 24")).toBeInTheDocument();
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: SRC }));
  });
});
