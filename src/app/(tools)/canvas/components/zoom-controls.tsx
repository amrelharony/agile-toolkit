"use client";

import { ZoomIn, ZoomOut, Maximize2, Undo2, Redo2, Expand, Shrink } from "lucide-react";
import { useCanvasStore } from "../use-canvas-store";
import { resetCamera } from "@/lib/whiteboard/canvas-transform";
import { keepBoardFocus } from "@/lib/whiteboard/keyboard";
import { zoomStep } from "../hooks/use-pan-zoom-controls";
import { useOpenCanvasActions } from "../hooks/use-canvas-shortcuts";

/**
 * Where the zoom controls sit on a touch screen. Amr stands in the
 * bottom-right corner of the screen, which is where the board's bottom
 * edge sits when it is scrolled fully into view, so on touch the bars
 * move to the bottom-LEFT, just past the tool rail (which ends 59 px in
 * from the stage edge at every width). The zoom bar is also tightened
 * there (no divider, 2 px gaps) so even at 360 px wide its last button
 * stops short of Amr's figure, and Fit to content, the control he used to
 * cover, comes first. With a mouse the bars stay bottom-right, as before.
 */
export const ZOOM_CONTROLS_TOUCH_LEFT = "pointer-coarse:right-auto pointer-coarse:left-[4.5rem]";

interface ZoomControlsProps {
  onFit?: () => void;
  viewportSize?: { w: number; h: number };
  /** The page's "board fills the screen" mode (touch only). Omit where the
   * board already fills its page (the guest board). */
  fillScreen?: { on: boolean; toggle: () => void };
}

export function ZoomControls({ onFit, viewportSize, fillScreen }: ZoomControlsProps) {
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
      // Phones: the touch-only row (Undo / Redo, full screen) stacks
      // above the zoom bar, left-aligned. From sm up it goes beside the
      // zoom bar, which keeps a short landscape board's bottom free. On
      // touch the whole stack sits bottom-left, clear of Amr (see
      // ZOOM_CONTROLS_TOUCH_LEFT). Clicks pass through the empty space
      // around the bars. With a mouse only the zoom bar renders, at the
      // bottom-right, so desktop is unchanged.
      className={`pointer-events-none absolute right-3 bottom-3 z-10 flex flex-col items-start gap-2 sm:flex-row sm:items-end ${ZOOM_CONTROLS_TOUCH_LEFT}`}
      // PNG export filters out anything carrying this attribute.
      data-canvas-export-ignore="true"
    >
      {(history || fillScreen) && (
        <div className="hidden items-end gap-2 pointer-coarse:flex">
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
          {fillScreen && (
            // A phone's board is capped below the screen's height so the
            // page around it stays scrollable; this lets it take the whole
            // screen under the app header instead. Pressing again gives the
            // page back.
            <div className="pointer-events-auto flex bg-surface/95 border border-border rounded-lg p-1 shadow-lg backdrop-blur-sm">
              <button
                type="button"
                onClick={fillScreen.toggle}
                onMouseDown={keepBoardFocus}
                aria-label="Full-screen board"
                aria-pressed={fillScreen.on}
                title={fillScreen.on ? "Exit full screen" : "Full screen"}
                className="w-11 h-11 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
              >
                {fillScreen.on ? (
                  <Shrink className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Expand className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
      <div
        className="pointer-events-auto flex items-center gap-1 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm pointer-coarse:gap-0.5 pointer-coarse:px-1"
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
          className="text-xs font-mono text-sub hover:text-text px-2 py-1 rounded hover:bg-surface-deep min-w-[50px] text-center pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1"
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
        {/* Dropped on touch, where the bar is tightened (see above). */}
        <div className="w-px h-5 bg-border mx-1 pointer-coarse:hidden" />
        {onFit && (
          // On touch Fit leads the bar, as far from Amr's corner as it
          // can be: the bar is rem-sized and Amr is not, so with a larger
          // root font (a browser text-size setting) the bar's right end
          // grows toward him at 360 px. Fit was the control he covered.
          <button
            type="button"
            onClick={onFit}
            onMouseDown={keepBoardFocus}
            aria-label="Fit to content"
            title="Fit to content (Cmd+1)"
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep min-touch-coarse pointer-coarse:order-first"
          >
            <Maximize2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
