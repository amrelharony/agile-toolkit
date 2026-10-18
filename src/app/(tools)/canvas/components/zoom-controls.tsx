"use client";

import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useCanvasStore } from "../use-canvas-store";
import { resetCamera } from "@/lib/whiteboard/canvas-transform";
import { keepBoardFocus } from "@/lib/whiteboard/keyboard";
import { zoomStep } from "../hooks/use-pan-zoom-controls";

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

  return (
    <div
      className="absolute right-3 bottom-3 flex items-center gap-1 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm z-10"
      role="toolbar"
      aria-label="Zoom controls"
      // PNG export filters out anything carrying this attribute.
      data-canvas-export-ignore="true"
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
  );
}
