"use client";

import { ZoomIn, ZoomOut, Maximize2, Undo2, Redo2 } from "lucide-react";
import { useCanvasStore } from "../use-canvas-store";
import { resetCamera } from "@/lib/whiteboard/canvas-transform";
import { keepBoardFocus } from "@/lib/whiteboard/keyboard";
import { zoomStep } from "../hooks/use-pan-zoom-controls";
import { useOpenCanvasActions } from "../hooks/use-canvas-shortcuts";

interface ZoomControlsProps {
  onFit?: () => void;
  viewportSize?: { w: number; h: number };
}

export function ZoomControls({ onFit, viewportSize }: ZoomControlsProps) {
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);

  // Same step as the Cmd/Ctrl + = / - shortcuts (see useKeyboardZoomActions).
  const size = viewportSize ?? { w: 0, h: 0 };
  const zoomIn = () => setCamera(zoomStep(camera, size, 1));
  const zoomOut = () => setCamera(zoomStep(camera, size, -1));
  const reset = () => setCamera(resetCamera());
  // The open board's Undo / Redo (null when it's read-only or none is open).
  const history = useOpenCanvasActions();

  return (
    <div
      // Stacks the touch-only Undo / Redo bar above the zoom bar, left-
      // aligned so it stays out of Amr's bottom-right corner. Clicks pass
      // through the empty corner beside the narrower bar.
      className="pointer-events-none absolute right-3 bottom-3 z-10 flex flex-col items-start gap-2"
      // PNG export filters out anything carrying this attribute.
      data-canvas-export-ignore="true"
    >
      {history && (
        // Phones have no Cmd+Z: on coarse pointers the board's own undo /
        // redo handlers get 44 px buttons. Desktop keeps the shortcuts.
        <div
          className="pointer-events-auto hidden items-center gap-1 bg-surface/95 border border-border rounded-lg px-1 py-1 shadow-lg backdrop-blur-sm pointer-coarse:flex"
          role="toolbar"
          aria-label="Undo and redo"
        >
          <button
            type="button"
            onClick={history.undo}
            onMouseDown={keepBoardFocus}
            aria-label="Undo"
            title="Undo (Cmd+Z)"
            className="w-11 h-11 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
          >
            <Undo2 className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={history.redo}
            onMouseDown={keepBoardFocus}
            aria-label="Redo"
            title="Redo (Cmd+Shift+Z)"
            className="w-11 h-11 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
          >
            <Redo2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        className="pointer-events-auto flex items-center gap-1 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm"
        role="toolbar"
        aria-label="Zoom controls"
      >
        <button
          type="button"
          onClick={zoomOut}
          onMouseDown={keepBoardFocus}
          aria-label="Zoom out"
          title="Zoom out (Cmd+-)"
          className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep min-touch-coarse"
        >
          <ZoomOut className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={reset}
          onMouseDown={keepBoardFocus}
          title="Reset zoom (Cmd+0)"
          aria-label={`Reset zoom (currently ${Math.round(camera.zoom * 100)}%)`}
          className="text-xs font-mono text-sub hover:text-text px-2 py-1 rounded hover:bg-surface-deep min-w-[50px] text-center"
        >
          {Math.round(camera.zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          onMouseDown={keepBoardFocus}
          aria-label="Zoom in"
          title="Zoom in (Cmd+=)"
          className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep min-touch-coarse"
        >
          <ZoomIn className="w-4 h-4" aria-hidden="true" />
        </button>
        <div className="w-px h-5 bg-border mx-1" />
        {onFit && (
          <button
            type="button"
            onClick={onFit}
            onMouseDown={keepBoardFocus}
            aria-label="Fit to content"
            title="Fit to content (Cmd+1)"
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep min-touch-coarse"
          >
            <Maximize2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
