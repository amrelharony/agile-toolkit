/**
 * "Agile at Work" comic — shared constants and build-time availability.
 *
 * The PDF is a static file the owner commits to public/comics/. Whether it
 * exists is decided when Next builds (scripts/comic-asset.mjs, wired through
 * next.config.mjs `env`), so the reader page, the home banner and the sitemap
 * all agree without a runtime probe. Pure and isomorphic: safe to import from
 * server and client components alike.
 */

export const COMIC_ID = "agile-at-work";
export const COMIC_TITLE = "Agile at Work";
export const COMIC_ROUTE = "/agile-at-work";
export const COMIC_PDF_PATH = "/comics/agile-at-work.pdf";
export const COMIC_DOWNLOAD_NAME = "Agile-at-Work.pdf";
export const COMIC_LAST_PAGE_KEY = "agile-toolkit:comic:agile-at-work:last-page:v1";
export const COMIC_LAYOUT_KEY = "agile-toolkit:comic:layout:v1";

/** The reader page (or anything under it). */
export function isComicRoute(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === COMIC_ROUTE || pathname.startsWith(`${COMIC_ROUTE}/`));
}

export type ComicAsset = {
  /** True when the PDF was present at build time. */
  available: boolean;
  /** File size in bytes, or null when unknown. */
  size: number | null;
  /** Short content hash of the PDF, or null when unavailable. */
  version: string | null;
  /** URL to load / download. Versioned (`?v=<hash>`) when available, so a
   * replaced PDF never mixes with cached byte ranges of the old one. */
  src: string;
};

export function comicAsset(): ComicAsset {
  // Each variable is written out literally (never `process.env[name]`) so
  // Next can inline the build-time value into client bundles.
  const rawSize = process.env.NEXT_PUBLIC_COMIC_PDF_SIZE;
  const rawVersion = process.env.NEXT_PUBLIC_COMIC_PDF_VERSION;

  if (!rawVersion) {
    return { available: false, size: null, version: null, src: COMIC_PDF_PATH };
  }
  const parsedSize = rawSize ? Number(rawSize) : NaN;
  return {
    available: true,
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : null,
    version: rawVersion,
    src: `${COMIC_PDF_PATH}?v=${encodeURIComponent(rawVersion)}`,
  };
}

const BYTE_UNITS = ["KB", "MB", "GB"] as const;

/** Human-readable size in binary units: 512 → "512 B", 12_897_485 → "12.3 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}
