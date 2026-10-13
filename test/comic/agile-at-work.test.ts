import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMIC_PDF_PATH,
  COMIC_ROUTE,
  comicAsset,
  formatBytes,
  isComicRoute,
} from "@/lib/comic/agile-at-work";

/**
 * `comicAsset()` turns the build-time env written by next.config.mjs
 * (scripts/comic-asset.mjs) into the reader's source URL. It reads the env on
 * every call, so stubbing is enough — no module reload needed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("comicAsset", () => {
  it("is unavailable when the build found no PDF (empty strings from next.config)", () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "");
    expect(comicAsset()).toEqual({
      available: false,
      size: null,
      version: null,
      src: COMIC_PDF_PATH,
    });
  });

  it("is unavailable when the env is not set at all", () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", undefined);
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", undefined);
    const asset = comicAsset();
    expect(asset.available).toBe(false);
    expect(asset.src).toBe("/comics/agile-at-work.pdf");
  });

  it("returns a versioned src and the size when the PDF was present", () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "12897485");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "a163ac728a97");
    expect(comicAsset()).toEqual({
      available: true,
      size: 12897485,
      version: "a163ac728a97",
      src: "/comics/agile-at-work.pdf?v=a163ac728a97",
    });
  });

  it("keeps the comic available but drops a size it can't parse", () => {
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_SIZE", "not-a-number");
    vi.stubEnv("NEXT_PUBLIC_COMIC_PDF_VERSION", "abc");
    expect(comicAsset()).toMatchObject({
      available: true,
      size: null,
      src: `${COMIC_PDF_PATH}?v=abc`,
    });
  });

  it("serves the reader from the route the registry links to", () => {
    expect(COMIC_ROUTE).toBe("/agile-at-work");
  });
});

describe("formatBytes", () => {
  it("formats bytes, KB, MB and GB with one decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12897485)).toBe("12.3 MB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50.0 MB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  it("never prints a negative or NaN size", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});

describe("isComicRoute", () => {
  it.each([
    ["/agile-at-work", true],
    ["/agile-at-work/", true],
    ["/agile-at-work/anything", true],
    ["/agile-at-workshop", false],
    ["/", false],
    ["", false],
    [null, false],
  ])("%j → %s", (pathname, expected) => {
    expect(isComicRoute(pathname)).toBe(expected);
  });
});
