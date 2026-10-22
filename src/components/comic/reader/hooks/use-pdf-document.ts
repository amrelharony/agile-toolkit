"use client";

import { useCallback, useEffect, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs, pdfErrorKind, type PdfErrorKind } from "@/lib/pdf/load-pdfjs";

/**
 * How long opening may go without a single new byte. Every chunk that
 * arrives restarts the clock, so a big file on a slow phone connection
 * still opens; only a stalled download gives up.
 */
const LOAD_TIMEOUT_MS = 30_000;

export type ComicLoadError = Exclude<PdfErrorKind, "cancelled"> | "timeout" | "expired";

/**
 * What Supabase Storage answers once a signed URL has expired (or was
 * tampered with). Retrying the same URL can't help; reloading the page
 * mints a fresh one.
 */
const EXPIRED_LINK_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);

/**
 * True for a pdf.js `ResponseException` caused by an expired signed URL.
 * Matched on `name`, like pdfErrorKind(): the error may have crossed the
 * worker boundary as a structured clone.
 */
export function isExpiredLinkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, status } = err as { name?: unknown; status?: unknown };
  return (
    name === "ResponseException" && typeof status === "number" && EXPIRED_LINK_STATUSES.has(status)
  );
}

export type PdfDocumentState =
  | {
      status: "loading";
      /** Share of the file fetched so far (0..1), or null before pdf.js reports. */
      progress: number | null;
    }
  | {
      status: "ready";
      doc: PDFDocumentProxy;
      numPages: number;
      /** Page 1 at scale 1, in PDF points — sizes the stage before any render. */
      pageSize: { width: number; height: number };
    }
  | { status: "error"; kind: ComicLoadError };

class LoadTimeoutError extends Error {
  constructor() {
    super(`No data arrived for ${LOAD_TIMEOUT_MS / 1000}s while opening the comic.`);
    this.name = "LoadTimeoutError";
  }
}

/**
 * Open the comic with pdf.js, fetching only what is needed where it can.
 *
 * The PDF can be tens of MB, so pdf.js is asked for 1 MB HTTP range
 * requests with streaming and auto-fetch off: page 1 needs a few chunks,
 * and later pages fetch their own bytes when rendered (or prefetched). A
 * linearized ("Fast Web View") export makes the first page cheapest. That
 * only works if the page can see the response's `Accept-Ranges` header —
 * the signed URL is cross-origin (Supabase), so CORS must expose it.
 * Otherwise pdf.js downloads the whole file before page 1, which is why the
 * timeout measures silence rather than the whole load.
 *
 * Page 1 is fetched as part of opening, so the stage can take the comic's
 * real aspect ratio before anything is drawn. The loading task is
 * destroyed on unmount, on retry and on timeout — that aborts the
 * downloads and shuts down the worker.
 */
export function usePdfDocument(src: string): PdfDocumentState & { retry: () => void } {
  const [state, setState] = useState<PdfDocumentState>({ status: "loading", progress: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((prev) =>
      prev.status === "loading" && prev.progress === null
        ? prev
        : { status: "loading", progress: null }
    );

    let rejectTimeout: (err: Error) => void = () => {};
    const timeout = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    // (Re)start the silence clock; a no-op once opening has finished.
    const armTimeout = () => {
      if (settled) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => rejectTimeout(new LoadTimeoutError()), LOAD_TIMEOUT_MS);
    };
    let lastLoaded = 0;

    const open = async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return null;
      task = pdfjs.getDocument({
        url: src,
        rangeChunkSize: 1 << 20,
        disableAutoFetch: true,
        disableStream: true,
        verbosity: pdfjs.VerbosityLevel.ERRORS,
      });
      // destroy() rejects the task's promise; nobody else awaits it then.
      task.promise.catch(() => {});
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (cancelled) return;
        // pdf.js reports bytes both for range requests and for a whole-file
        // download; either way, data is still arriving.
        if (loaded > lastLoaded) {
          lastLoaded = loaded;
          armTimeout();
        }
        if (!(total > 0)) return;
        const progress = Math.min(1, loaded / total);
        setState((prev) => (prev.status === "loading" ? { status: "loading", progress } : prev));
      };
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const { width, height } = page.getViewport({ scale: 1 });
      const numPages = Math.floor(doc.numPages);
      if (!(numPages >= 1) || !(width > 0) || !(height > 0)) {
        throw Object.assign(new Error("The comic PDF has no readable pages."), {
          name: "InvalidPDFException",
        });
      }
      return { doc, numPages, pageSize: { width, height } };
    };

    armTimeout();
    Promise.race([open(), timeout])
      .then((opened) => {
        if (cancelled || !opened) return;
        setState({ status: "ready", ...opened });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        void (task as PDFDocumentLoadingTask | null)?.destroy().catch(() => {});
        task = null;
        const kind =
          err instanceof LoadTimeoutError
            ? "timeout"
            : isExpiredLinkError(err)
              ? "expired"
              : pdfErrorKind(err);
        // A cancel we didn't ask for (the worker died mid-load) is still a
        // failed load from the reader's point of view.
        setState({ status: "error", kind: kind === "cancelled" ? "other" : kind });
      })
      .finally(() => {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      void (task as PDFDocumentLoadingTask | null)?.destroy().catch(() => {});
    };
  }, [src, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
