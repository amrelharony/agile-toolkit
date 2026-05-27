"use client";

import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useCanvasStore } from "../use-canvas-store";
import { clampZoom, resetCamera } from "@/lib/whiteboard/canvas-transform";

interface ZoomControlsProps {
  onFit?: () => void;
  viewportSize?: { w: number; h: number };
}

export function ZoomControls({ onFit, viewportSize }: ZoomControlsProps) {
  const camera = useCanvasStore((s) => s.camera);
  const setCamera = useCanvasStore((s) => s.setCamera);

  const zoomIn = () => {
    const center = viewportSize ? { x: viewportSize.w / 2, y: viewportSize.h / 2 } : { x: 0, y: 0 };
    const next = clampZoom(camera.zoom * 1.2);
    const worldX = camera.x + center.x / camera.zoom;
    const worldY = camera.y + center.y / camera.zoom;
    setCamera({
      x: worldX - center.x / next,
      y: worldY - center.y / next,
      zoom: next,
    });
  };
  const zoomOut = () => {
    const center = viewportSize ? { x: viewportSize.w / 2, y: viewportSize.h / 2 } : { x: 0, y: 0 };
    const next = clampZoom(camera.zoom / 1.2);
    const worldX = camera.x + center.x / camera.zoom;
    const worldY = camera.y + center.y / camera.zoom;
    setCamera({
      x: worldX - center.x / next,
      y: worldY - center.y / next,
      zoom: next,
    });
  };
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
        aria-label="Zoom out"
        title="Zoom out (Cmd+-)"
        className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep min-touch-coarse"
      >
        <ZoomOut className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={reset}
        title="Reset zoom (Cmd+0)"
        aria-label={`Reset zoom (currently ${Math.round(camera.zoom * 100)}%)`}
        className="text-xs font-mono text-sub hover:text-text px-2 py-1 rounded hover:bg-surface-deep min-w-[50px] text-center"
      >
        {Math.round(camera.zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={zoomIn}
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
