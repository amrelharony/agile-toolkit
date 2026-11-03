/**
 * pdf.js loader for the Canvas PDF import (the comic's PDF reader that also
 * used it was retired when the comic moved to /comics).
 *
 * Why the LEGACY build: the modern pdfjs-dist 5.x build calls very new
 * built-ins (Math.sumPrecise, Map.prototype.getOrInsertComputed,
 * Promise.try) with no polyfills, so it throws on older Safari / iOS /
 * Chromium, and Canvas is open to every visitor, on whatever browser they
 * have. The legacy build bundles the polyfills for roughly +20 KB gzipped.
 *
 * The worker is a committed byte copy of
 * node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs, served
 * same-origin from /public (CSP `script-src 'self'` covers it, and there's
 * no third-party CDN at runtime). pdf.js refuses to run when the API and
 * worker versions differ, so run `npm run pdf:worker` after every
 * pdfjs-dist bump — test/pdf/worker-version.test.ts fails until you do.
 */

export const PDF_WORKER_SRC = "/pdf.worker.legacy.min.mjs";

export type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/**
 * Lazy-load pdf.js once per page session (~500 KB, paid only when a PDF is
 * actually opened). A failed import is forgotten so the next call retries —
 * a chunk that 404'd mid-deploy or on a flaky network shouldn't poison the
 * session.
 */
export function loadPdfjs(): Promise<Pdfjs> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("pdf.js can only be loaded in the browser."));
  }
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then(
      (pdfjs) => {
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
        } catch {
          // some bundles freeze GlobalWorkerOptions; ignore
        }
        return pdfjs;
      },
      (err: unknown) => {
        pdfjsPromise = null;
        throw err;
      }
    );
  }
  return pdfjsPromise;
}

export type PdfErrorKind = "missing" | "invalid" | "password" | "cancelled" | "other";

/**
 * Classify a pdf.js failure. Matches on `err.name` rather than `instanceof`:
 * errors cross the worker boundary as structured clones, and callers
 * shouldn't need the (lazily loaded) module just to inspect an error.
 *
 * pdf.js 5.x reports an HTTP failure as `ResponseException { status,
 * missing }` (missing = status 404); `MissingPDFException` is the pre-5
 * name and is kept for safety.
 */
export function pdfErrorKind(err: unknown): PdfErrorKind {
  if (typeof err !== "object" || err === null) return "other";
  const { name, status, missing } = err as { name?: unknown; status?: unknown; missing?: unknown };
  switch (name) {
    case "ResponseException":
      return missing === true || status === 404 ? "missing" : "other";
    case "MissingPDFException":
      return "missing";
    case "InvalidPDFException":
      return "invalid";
    case "PasswordException":
      return "password";
    case "RenderingCancelledException":
    case "AbortException":
      return "cancelled";
    default:
      return "other";
  }
}
