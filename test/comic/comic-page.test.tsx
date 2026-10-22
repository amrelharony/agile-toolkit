import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reader page behind /comic/<token> (the middleware rewrites the right
 * link to it): a wrong token still 404s here, as defence in depth, without
 * touching storage or getting the comic's metadata; a right one renders the
 * reader on a fresh signed URL — with no download anywhere — or the "coming
 * soon" / "can't be loaded" states, and marks the page as a reader page for
 * the shared chrome. The token check and the storage call are mocked here
 * (they have their own tests); the token below is a dummy, not the real
 * link.
 */

const GOOD_TOKEN = "AbCdEf0123456789_-AbCdEf0123456789";
const SIGNED =
  "https://ref.supabase.co/storage/v1/object/sign/comics/agile-at-work.pdf?token=signed-url-token";

const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  isValidComicToken: vi.fn(),
  getComicSignedUrl: vi.fn(),
  loadPdfjs: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: h.notFound,
  usePathname: () => "/comic/x",
}));
vi.mock("@/lib/comic/access", () => ({ isValidComicToken: h.isValidComicToken }));
vi.mock("@/lib/comic/storage", () => ({ getComicSignedUrl: h.getComicSignedUrl }));
vi.mock("@/lib/pdf/load-pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/load-pdfjs")>()),
  loadPdfjs: h.loadPdfjs,
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: vi.fn() }));

import ComicPage, { dynamic, generateMetadata, revalidate } from "@/app/read/[token]/page";
import { ComicClient } from "@/app/read/[token]/comic-client";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

function fakePdfjs(numPages = 3) {
  const doc = {
    numPages,
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      cleanup: vi.fn(),
    })),
  };
  return {
    VerbosityLevel: { ERRORS: 0 },
    getDocument: vi.fn(() => ({
      promise: Promise.resolve(doc),
      onProgress: null as unknown,
      destroy: vi.fn(async () => {}),
    })),
  };
}

async function renderPage(token: string) {
  return render(await ComicPage({ params: { token } }));
}

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
    value: () => "blob:page",
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.restoreAllMocks();
  h.notFound.mockClear();
  h.isValidComicToken.mockReset();
  h.isValidComicToken.mockImplementation((token: unknown) => token === GOOD_TOKEN);
  h.getComicSignedUrl.mockReset();
  h.loadPdfjs.mockReset();
  localStorage.clear();
  useReaderPageStore.setState({ title: null });
  window.history.replaceState(null, "", "/comic/x");
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    fillStyle: "",
    fillRect: () => {},
  })) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) =>
    cb(new Blob(["jpeg"], { type: "image/jpeg" }))
  );
});

describe("the comic reader page", () => {
  it.each([
    ["a wrong token", "ZyXwVu9876543210_-ZyXwVu9876543210"],
    ["a malformed token", "not a token"],
    ["an empty token", ""],
  ])("404s on %s without touching storage", async (_label, token) => {
    await expect(ComicPage({ params: { token } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.notFound).toHaveBeenCalledTimes(1);
    expect(h.isValidComicToken).toHaveBeenCalledWith(token);
    expect(h.getComicSignedUrl).not.toHaveBeenCalled();
  });

  it("opens the reader on the signed URL, with no download anywhere", async () => {
    h.getComicSignedUrl.mockResolvedValue({ status: "ready", url: SIGNED });
    const pdfjs = fakePdfjs();
    h.loadPdfjs.mockResolvedValue(pdfjs);
    await renderPage(GOOD_TOKEN);

    expect(h.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeInTheDocument();
    expect(await screen.findByAltText("Agile at Work — page 1 of 3")).toBeInTheDocument();
    expect(pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: SIGNED }));

    expect(document.querySelector("a[download]")).toBeNull();
    expect(document.querySelector(`a[href="${SIGNED}"]`)).toBeNull();
    expect(screen.queryByText(/download/i)).toBeNull();
    // The token never ends up in the rendered page either.
    expect(document.body.innerHTML).not.toContain(GOOD_TOKEN);
  });

  it("shows 'coming soon' while the PDF isn't uploaded, without loading pdf.js", async () => {
    h.getComicSignedUrl.mockResolvedValue({ status: "missing" });
    await renderPage(GOOD_TOKEN);

    expect(screen.getByText("Agile at Work is coming soon")).toBeInTheDocument();
    expect(
      screen.getByText("The colour edition isn't uploaded yet — check back soon.")
    ).toBeInTheDocument();
    expect(h.loadPdfjs).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("offers Reload when storage is unavailable", async () => {
    h.getComicSignedUrl.mockResolvedValue({ status: "unavailable" });
    await renderPage(GOOD_TOKEN);

    expect(screen.getByText("The comic can't be loaded right now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(h.loadPdfjs).not.toHaveBeenCalled();
  });

  it("is rendered per request, never cached or prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("is never indexed, sends no Referer, and puts no URL in its meta tags", () => {
    const metadata = generateMetadata({ params: { token: GOOD_TOKEN } });
    expect(metadata.title).toBe("Agile at Work");
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, nocache: true },
    });
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph).toBeDefined();
    expect(metadata.openGraph).not.toHaveProperty("url");
  });

  it.each([
    ["a wrong token", "ZyXwVu9876543210_-ZyXwVu9876543210"],
    ["a malformed token", "not a token"],
  ])("gives %s no metadata of its own, so nothing names the comic", (_label, token) => {
    expect(generateMetadata({ params: { token } })).toEqual({});
    expect(h.isValidComicToken).toHaveBeenCalledWith(token);
  });
});

describe("ComicClient", () => {
  it("names itself to the shared chrome while mounted, and only then", () => {
    const { unmount } = render(<ComicClient source={{ status: "missing" }} />);
    expect(useReaderPageStore.getState().title).toBe("Agile at Work");
    unmount();
    expect(useReaderPageStore.getState().title).toBeNull();
  });

  it("reloads the page from the unavailable panel", () => {
    const onReload = vi.fn();
    render(<ComicClient source={{ status: "unavailable" }} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
