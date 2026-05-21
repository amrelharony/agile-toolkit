/**
 * PDF annotation overlay — drop a PDF, scribble over it (Phase 33).
 *
 * Strategy: rasterise each PDF page to a PNG data URL via pdfjs-dist,
 * then place each page as a `WhiteboardImage` object laid out
 * horizontally. The user annotates with the normal freehand / sticky
 * tools — every annotation is just another canvas object stacked on
 * top of the page images.
 *
 * Why rasterise (not iframe)?
 *   - We get scribble-over-the-PDF for free, because annotations are
 *     normal canvas objects layered above the image.
 *   - The PDF is then exportable via our existing PNG/SVG pipelines
 *     (the embedded iframe approach would have rendered as blank in
 *     html-to-image).
 *   - Bigger payload, but offset by:
 *       * page count cap (PDF_MAX_PAGES = 30)
 *       * rendering scale capped to ~1.5x device pixel ratio
 *       * per-image cap from image-import.ts still applies
 *
 * pdfjs-dist is dynamic-imported on first use so the ~500 KB bundle
 * cost is paid only when a user actually drops a PDF.
 */

import type {
  WhiteboardImage,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import {
  DATA_URL_MAX_LEN,
  IMAGE_MAX_BYTES,
} from "./image-import";

/** Cap on how many pages we'll rasterise. A 200-page PDF would blow
 * localStorage on its own; pause + abort beyond this many pages. */
export const PDF_MAX_PAGES = 30;
/** Render scale — 1.5x device pixel ratio balances clarity (text stays
 * readable at canvas zoom 1.0–2.0) against payload size. Each page
 * comes in around 200-400 KB at this scale. */
const PDF_RENDER_SCALE = 1.5;
/** Per-page max edge in pixels — clamped down if a page would
 * otherwise render larger (very long technical PDFs). Keeps each
 * page data URL well under the per-image cap. */
const PDF_MAX_PAGE_EDGE = 1600;

export interface PdfPageImage {
  /** Data URL of the rendered page (PNG). */
  dataUrl: string;
  /** Natural rendered width / height in pixels. */
  w: number;
  h: number;
  /** 1-indexed page number for the filename / alt text. */
  pageNumber: number;
}

export interface PdfImportResult {
  ok: true;
  pages: PdfPageImage[];
  /** Original filename — used to build alt text per page. */
  name: string;
  /** True when we truncated past PDF_MAX_PAGES — UI can show a notice. */
  truncated: boolean;
  /** Total page count reported by the PDF (before truncation) — used by
   * the importer's activity-log entry to say "30 of N" instead of
   * "30 of 30+". */
  totalPages: number;
}

export type PdfImportError = { ok: false; err: string };

/** Optional hooks the caller can pass to surface render progress and
 * keep the UI responsive over a long render. */
export interface PdfImportOpts {
  /** Fired after each page renders so the UI can update a progress
   * indicator. Page numbers are 1-indexed; `total` is the number of
   * pages we'll actually render (already truncated to PDF_MAX_PAGES). */
  onProgress?: (current: number, total: number) => void;
}

/** Encoded-bytes budget for the combined page payload. 5 MB is the
 * localStorage quota on most browsers — we cap well below that so the
 * board still has room for the user's own objects. */
const PDF_TOTAL_BYTES_BUDGET = 3.5 * 1024 * 1024;
/** Hard timeout on the initial `getDocument` parse — a malicious or
 * pathological PDF could otherwise hang the worker indefinitely. */
const PDF_PARSE_TIMEOUT_MS = 30_000;

/**
 * Rasterise every page of a PDF File into PNG data URLs.
 *
 * Lazy-imports pdfjs-dist so the main app bundle isn't penalised when
 * no one uses PDFs. The pdfjs worker is self-hosted from /public so
 * we don't depend on a third-party CDN at runtime (supply-chain risk).
 */
export async function pdfToImages(
  file: File,
  opts: PdfImportOpts = {},
): Promise<PdfImportResult | PdfImportError> {
  if (typeof window === "undefined") {
    return { ok: false, err: "PDF import only works in the browser." };
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, err: "Not a PDF file." };
  }
  // 25 MB cap on the source PDF. Larger PDFs would either blow memory
  // during rasterisation or produce too many oversized page data URLs
  // to fit in localStorage.
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, err: `PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 25 MB.` };
  }
  // Dynamic import — paid only on first PDF drop. The "legacy" build is
  // what plays nicely with Next.js's webpack worker bundling.
  let pdfjs: typeof import("pdfjs-dist");
  try {
    pdfjs = await import("pdfjs-dist");
  } catch (err) {
    return {
      ok: false,
      err: `Failed to load PDF parser: ${err instanceof Error ? err.message : "unknown error"}. The worker file at /pdf.worker.min.mjs may be missing — re-run \`npm install\` to restore it.`,
    };
  }
  // Worker source: self-hosted from /public/pdf.worker.min.mjs so we
  // don't pull a third-party script at runtime (supply-chain risk).
  // The file is copied into /public during install. Because the worker
  // is served from the same origin as the app, the cdnjs version-pin
  // dance is no longer relevant — the worker always matches whatever
  // pdfjs-dist version `npm install` produced.
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  } catch {
    // some bundles freeze GlobalWorkerOptions; ignore
  }

  const buf = await file.arrayBuffer();
  let doc: import("pdfjs-dist").PDFDocumentProxy;
  // Hold the loading task in scope so the timeout branch can destroy
  // it — calling destroy() on the task aborts the in-flight parse and
  // releases the worker. Without this a 30-s timeout still leaves the
  // worker spinning until the doc resolves on its own.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  // Swallow rejection on the loading task's promise so an aborted parse
  // doesn't surface as an unhandled rejection when we destroy() it.
  loadingTask.promise.catch(() => {});
  try {
    // Race the parse against a hard timeout — a pathological PDF can
    // otherwise hang the worker indefinitely and leave the UI stuck on
    // "Rendering…". 30 s is generous; real PDFs parse in <2 s.
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`PDF parse timed out after ${PDF_PARSE_TIMEOUT_MS / 1000}s`)),
        PDF_PARSE_TIMEOUT_MS,
      );
    });
    try {
      doc = await Promise.race([loadingTask.promise, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
  } catch (err) {
    // Abort the loading task — releases the worker even if getDocument
    // is still mid-parse. .catch swallows the AbortException destroy()
    // raises on the original promise.
    loadingTask.destroy().catch(() => {});
    return { ok: false, err: `Failed to parse PDF: ${err instanceof Error ? err.message : "unknown error"}` };
  }

  // Math.floor — pdf.js declares numPages as a number, and some
  // malformed PDFs report a fractional value (e.g. via /Count entry
  // floats). A non-integer here would break `for (let i = 1; i <=
  // totalPages; i++)` and Math.min with PDF_MAX_PAGES would propagate
  // the fraction downstream into bookkeeping.
  const totalPages = Math.floor(doc.numPages);
  const renderCount = Math.min(totalPages, PDF_MAX_PAGES);
  const pages: PdfPageImage[] = [];
  // Running total of encoded JPEG bytes across all rendered pages. We
  // reject the import once this exceeds PDF_TOTAL_BYTES_BUDGET so the
  // resulting board still fits in the 5 MB localStorage quota.
  let totalBytes = 0;

  for (let pageNumber = 1; pageNumber <= renderCount; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    // Start at a sensible scale, then ratchet down if the resulting
    // canvas exceeds PDF_MAX_PAGE_EDGE.
    let scale = PDF_RENDER_SCALE;
    let viewport = page.getViewport({ scale });
    // Defensive: a malformed PDF can hand back NaN/<=0 dimensions —
    // would land as a default 300x150 canvas of garbage otherwise.
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      doc.destroy().catch(() => {});
      return { ok: false, err: `PDF page ${pageNumber} has invalid dimensions` };
    }
    const longest = Math.max(viewport.width, viewport.height);
    if (longest > PDF_MAX_PAGE_EDGE) {
      scale = scale * (PDF_MAX_PAGE_EDGE / longest);
      viewport = page.getViewport({ scale });
      // Re-validate after the scale-down — the multiplication can still
      // produce 0 / NaN if the original was pathological.
      if (
        !Number.isFinite(viewport.width) ||
        !Number.isFinite(viewport.height) ||
        viewport.width <= 0 ||
        viewport.height <= 0
      ) {
        doc.destroy().catch(() => {});
        return { ok: false, err: `PDF page ${pageNumber} has invalid dimensions after scale-down` };
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      doc.destroy().catch(() => {});
      return { ok: false, err: "Browser refused to allocate a canvas for PDF render." };
    }
    // Paint a white background before render — PDFs with transparent
    // backgrounds (uncommon but real) would otherwise encode as solid
    // black blocks when we toDataURL("image/jpeg"), since JPEG has no
    // alpha channel and the default canvas pixel is rgba(0,0,0,0).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    try {
      // pdfjs v5 takes a `canvas` parameter directly (the legacy
      // `canvasContext` path is still supported but the docs recommend
      // the new shape). We pass the canvas only — pdfjs derives the 2D
      // context internally. No type cast: TS validates the real
      // signature so the next API break shows up at compile time.
      await page.render({
        canvas,
        viewport,
      }).promise;
    } catch (err) {
      doc.destroy().catch(() => {});
      return { ok: false, err: `PDF page ${pageNumber} render failed: ${err instanceof Error ? err.message : "unknown error"}` };
    }
    // Use JPEG at quality 0.85 — produces ~3x smaller payload than PNG
    // for typical text PDFs, with no visible quality loss. Toggle to
    // PNG below if we ever start producing PDFs with sharp diagrams
    // where JPEG artefacts would matter.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (dataUrl.length > DATA_URL_MAX_LEN) {
      doc.destroy().catch(() => {});
      return {
        ok: false,
        err: `PDF page ${pageNumber} renders too large (${(dataUrl.length / 1024 / 1024).toFixed(1)} MB encoded). Try a smaller PDF or fewer pages.`,
      };
    }
    totalBytes += dataUrl.length;
    if (totalBytes > PDF_TOTAL_BYTES_BUDGET) {
      doc.destroy().catch(() => {});
      return {
        ok: false,
        err: `PDF too large after page ${pageNumber} (${(totalBytes / 1024 / 1024).toFixed(1)} MB encoded). Try fewer pages or a smaller PDF.`,
      };
    }
    pages.push({
      dataUrl,
      w: canvas.width,
      h: canvas.height,
      pageNumber,
    });
    // Free the canvas — without this the browser holds the bitmap
    // alive until GC, doubling memory peak for a 30-page render.
    canvas.width = 0;
    canvas.height = 0;
    // Release pdfjs's per-page caches (text content, operator list,
    // rendered tile data). Critical for large PDFs — without this the
    // worker grows by ~5 MB per page and OOM kills mid-render.
    try {
      page.cleanup();
    } catch {
      /* page.cleanup() can throw on already-cleaned pages — ignore */
    }
    // Yield to the event loop so the UI stays responsive across the
    // ~10-20 s render window. Without this, every input event queues
    // until the loop completes and the page feels frozen.
    // Guard against a buggy caller-supplied progress handler — its
    // throw would propagate out and abort the remaining pages even
    // though the render itself succeeded.
    try {
      opts.onProgress?.(pageNumber, renderCount);
    } catch {
      /* swallow — progress reporting is best-effort */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  // Cleanly close the document — releases its worker. Catch the
  // rejection so a teardown failure doesn't surface as console noise.
  doc.destroy().catch(() => {});
  return {
    ok: true,
    pages,
    name: file.name.replace(/\.pdf$/i, "") || "document",
    truncated: totalPages > PDF_MAX_PAGES,
    totalPages,
  };
}

/**
 * Convert a `PdfImportResult` into ready-to-upsert WhiteboardImage
 * objects, laid out horizontally with a small gap between pages.
 * Caller fills `id`, `boardId`, `z`.
 */
export function pdfPagesToObjects(
  result: PdfImportResult,
  boardId: string,
  origin: { x: number; y: number },
  zBase: number,
): WhiteboardObject[] {
  // Display each page at a saner on-canvas size — without this, a
  // 1600px-wide rendered page lands as 1600 world-px, dwarfing every
  // sticky on the board. We scale every page so the FIRST page sits
  // at 600 world-px wide; later pages keep the same ratio so they
  // line up visually even when the source PDF mixes portrait+landscape.
  const TARGET_WIDTH = 600;
  const firstPageW = result.pages[0]?.w ?? TARGET_WIDTH;
  const scaleFactor = firstPageW > 0 ? TARGET_WIDTH / firstPageW : 1;
  const GAP = 40;
  const epoch = Date.now().toString(36);
  const objects: WhiteboardObject[] = [];
  let cursorX = origin.x;
  let zCursor = zBase + 1;
  for (const p of result.pages) {
    const displayW = Math.round(p.w * scaleFactor);
    const displayH = Math.round(p.h * scaleFactor);
    const image: WhiteboardImage = {
      id: `wb_pdf_${epoch}_${p.pageNumber}`,
      boardId,
      type: "image",
      x: cursorX,
      y: origin.y,
      w: displayW,
      h: displayH,
      z: zCursor++,
      version: 1,
      src: p.dataUrl,
      alt: `${result.name} — page ${p.pageNumber}`,
      fit: "contain",
      // Lock the page by default so users can scribble over it
      // without accidentally dragging the page around. They can
      // unlock via Cmd+L if they need to reposition.
      locked: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    objects.push(image as WhiteboardObject);
    cursorX += displayW + GAP;
  }
  return objects;
}

/**
 * Lightweight pre-check used by the drop handler — does the dropped
 * DataTransfer carry a PDF? We exclude oversize files at this stage
 * so the user gets a fast rejection before pdfjs is even loaded.
 */
export function extractPdfFiles(items: DataTransferItemList | null, files: FileList | null): File[] {
  const out: File[] = [];
  const addIfPdf = (f: File) => {
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      if (f.size <= 25 * 1024 * 1024) out.push(f);
    }
  };
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) addIfPdf(f);
      }
    }
  }
  if (out.length === 0 && files) {
    for (let i = 0; i < files.length; i++) addIfPdf(files[i]);
  }
  return out;
}

/** Re-export so the canvas can show a consistent error for over-size
 * payloads regardless of source (image vs PDF). */
export { IMAGE_MAX_BYTES };
