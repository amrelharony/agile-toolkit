"use client";

import { useCallback, useEffect, type RefObject } from "react";
import { fileToImage, imageToObject, extractImageFiles } from "@/lib/whiteboard/image-import";
import { pdfToImages, pdfPagesToObjects } from "@/lib/whiteboard/pdf-import";
import { wbId } from "@/lib/whiteboard/clipboard";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

// Cumulative image-import quota. Each image is bounded individually
// (IMAGE_MAX_BYTES ≈ 2.5 MB binary → ~3.4 MB encoded), but a drop of 5
// max-size images would still exceed the 5 MB localStorage quota when
// serialised together. Stop accepting images once we'd push the board
// past a conservative 3.5 MB budget (matching the per-image cap).
const CUMULATIVE_BUDGET = 3.5 * 1024 * 1024;

/**
 * Image + PDF import callbacks, plus the window-level paste listener.
 *
 * - `importImagesAt(files, worldOrigin)` — drops each image as a
 *   `WhiteboardImage`, stacking 24 px apart. Cumulative quota check
 *   stops the import at ~3.5 MB of encoded data so a multi-image drop
 *   doesn't blow the localStorage budget.
 *
 * - `importPdfAt(files, worldOrigin)` — rasterises pages of the FIRST
 *   PDF only (multi-PDF drops are rare and blocking). Pages land
 *   locked-by-default so freehand-over-PDF doesn't accidentally drag
 *   the page around. pdfjs-dist is dynamic-imported on first use so
 *   the bundle cost is opt-in.
 *
 * - Window paste listener for `Cmd+V` on an image. Skips when focus
 *   is inside a form field, an object is in inline-edit mode, or
 *   the cursor-chat composer is open — those owners should get first
 *   dibs on the paste.
 *
 * All three are no-ops in read-only mode (defense-in-depth — the
 * shortcut layer is also gated, but a future code path could
 * forget the check).
 */
export function useCanvasImports(params: {
  boardId: string;
  objects: readonly WhiteboardObject[];
  upsertMany: (objs: WhiteboardObject[]) => void;
  setSelection: (ids: string[]) => void;
  pushSnapshot: () => void;
  log: LogFn;
  logActivity: (kind: string, summary: string) => void;
  readOnly: boolean;
  editingObjectId: string | null;
  chatComposerScreen: { x: number; y: number } | null;
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
  viewportRectRef: RefObject<DOMRect | null>;
}) {
  const {
    boardId, objects, upsertMany, setSelection,
    pushSnapshot, log, logActivity, readOnly,
    editingObjectId, chatComposerScreen,
    clientToWorld, viewportRectRef,
  } = params;

  const importImagesAt = useCallback(
    async (files: File[], worldOrigin: { x: number; y: number }) => {
      if (readOnly) return;
      if (files.length === 0) return;
      pushSnapshot();
      const updates: WhiteboardObject[] = [];
      let topZ = 0;
      for (const o of objects) if (o.z > topZ) topZ = o.z;
      let cumulativeBytes = 0;
      let firstSkippedIdx = -1;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const result = await fileToImage(f, f.name);
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.warn("[canvas] image import failed:", result.err);
          continue;
        }
        const encoded = result.image.src.length;
        if (cumulativeBytes + encoded > CUMULATIVE_BUDGET) {
          if (firstSkippedIdx === -1) firstSkippedIdx = i;
          continue;
        }
        cumulativeBytes += encoded;
        const obj = imageToObject(result.image, {
          x: worldOrigin.x + i * 24,
          y: worldOrigin.y + i * 24,
        });
        // wbId() produces a crypto-strong id with deterministic length —
        // avoids the variable-length truncated-Math.random fallback.
        const id = wbId();
        updates.push({ ...obj, id, boardId, z: topZ + i + 1 } as WhiteboardObject);
      }
      if (firstSkippedIdx !== -1) {
        const skippedCount = files.length - firstSkippedIdx;
        // eslint-disable-next-line no-console
        console.warn(`[canvas] skipped ${skippedCount} image(s) — board would exceed ~3.5 MB encoded total.`);
        logActivity(
          "image-import",
          `Imported ${updates.length} image(s); skipped ${skippedCount} to keep board under quota.`,
        );
      }
      if (updates.length > 0) {
        upsertMany(updates);
        log(CANVAS_ACTIONS.OBJECT_ADDED, { count: updates.length, action: "image-import" });
        if (firstSkippedIdx === -1) {
          logActivity("image-import", `${updates.length} image${updates.length === 1 ? "" : "s"} imported`);
        }
        setSelection(updates.map((u) => u.id));
      }
    },
    [boardId, objects, upsertMany, log, pushSnapshot, setSelection, logActivity, readOnly],
  );

  const importPdfAt = useCallback(
    async (files: File[], worldOrigin: { x: number; y: number }) => {
      if (readOnly) return;
      if (files.length === 0) return;
      // PDFs can be heavy — render only the first one if a user drops
      // several. Multi-PDF drop is a niche case and rendering 5 PDFs
      // sequentially blocks the main thread for minutes.
      const file = files[0];
      let zBase = 0;
      for (const o of objects) if (o.z > zBase) zBase = o.z;
      // Snapshot BEFORE the long render — if we snapshotted after, any
      // user edits made while the PDF is rendering would be absorbed
      // into the undo entry and rolled back on Cmd+Z. Snapshotting
      // before is harmless when the render fails: it just adds one
      // no-op entry to the undo stack.
      pushSnapshot();
      const result = await pdfToImages(file, {
        onProgress: (current, total) => {
          if (current === 1 || current === total || current % 5 === 0) {
            logActivity("pdf-import", `Rendering PDF page ${current} of ${total}…`);
          }
        },
      });
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn("[canvas] PDF import failed:", result.err);
        logActivity("pdf-import", `PDF import failed: ${result.err}`);
        return;
      }
      const seeded = pdfPagesToObjects(result, boardId, worldOrigin, zBase);
      if (seeded.length === 0) return;
      upsertMany(seeded);
      log(CANVAS_ACTIONS.OBJECT_ADDED, { count: seeded.length, action: "pdf-import" });
      logActivity(
        "pdf-import",
        result.truncated
          ? `${seeded.length} of ${result.totalPages} pages imported from "${result.name}" (truncated at 30 pages)`
          : `${seeded.length} page${seeded.length === 1 ? "" : "s"} imported from "${result.name}"`,
      );
      // Pages land locked-by-default so freehand-over-PDF (the killer
      // use case) doesn't accidentally drag the page around. Tell the
      // user how to unlock when they need to reposition.
      logActivity("pdf-import", "PDF pages locked — Cmd+L to unlock if you need to move them.");
      setSelection([seeded[0].id]);
    },
    [boardId, objects, upsertMany, log, pushSnapshot, setSelection, logActivity, readOnly],
  );

  // Window-level paste listener for Cmd+V on an image.
  useEffect(() => {
    if (readOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const active = typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) return;
      if (editingObjectId || chatComposerScreen) return;
      if (!e.clipboardData) return;
      const files = extractImageFiles(e.clipboardData.items, e.clipboardData.files);
      if (files.length === 0) return;
      e.preventDefault();
      const rect = viewportRectRef.current;
      if (!rect) return;
      const world = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      void importImagesAt(files, world);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importImagesAt, clientToWorld, editingObjectId, chatComposerScreen, readOnly, viewportRectRef]);

  return { importImagesAt, importPdfAt };
}
