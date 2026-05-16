"use client";

/**
 * Presentation mode — frame-by-frame walkthrough.
 *
 * Enters when `presentationFrameIndex !== null`. Renders an overlay
 * that dims the surround and a control bar at the bottom for
 * Previous / Next / Exit. Arrow keys + Esc are wired at the canvas
 * level so the keyboard works without focus inside this component.
 *
 * The actual camera pan happens at the canvas level via fitToRects
 * around the current frame's bbox. This component is purely visual
 * (lightbox + controls).
 */

import { memo, useEffect } from "react";
import { ChevronLeft, ChevronRight, X, PlayCircle } from "lucide-react";
import type { WhiteboardFrame } from "@/lib/stores/workspace-types";

interface PresentationModeProps {
  frames: readonly WhiteboardFrame[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

function PresentationModeImpl({ frames, index, onPrev, onNext, onExit }: PresentationModeProps) {
  // Window-level keys are handled in whiteboard-canvas.tsx; here we
  // also handle them as a safety net in case focus is inside the
  // presentation control bar.
  //
  // INPUT/TEXTAREA/contentEditable guard: Space + ArrowKeys are valid
  // text-input keys. Without this, hitting Space inside a sticky's
  // inline editor (which can remain open if the user entered
  // presentation mode mid-edit) would advance the slide instead of
  // typing a space. Esc is treated similarly so editing can dismiss
  // normally before presentation handles the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); onNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      else if (e.key === "Escape") { e.preventDefault(); onExit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, onExit]);

  if (frames.length === 0) {
    return (
      <div
        role="dialog"
        aria-label="Presentation mode"
        data-canvas-export-ignore="true"
        className="absolute inset-0 z-40 bg-bg/95 backdrop-blur-sm flex items-center justify-center"
      >
        <div className="bg-surface border border-border rounded-lg p-6 max-w-md text-center">
          <PlayCircle className="w-10 h-10 text-accent mx-auto mb-3" />
          <h3 className="text-text font-semibold mb-2">No frames to present</h3>
          <p className="text-sm text-sub mb-4">
            Create frames around the content you want to walk through, then re-enter presentation mode.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="bg-accent text-bg font-medium px-4 py-1.5 rounded text-sm hover:bg-accent/80"
          >
            Exit
          </button>
        </div>
      </div>
    );
  }
  const cur = frames[Math.min(index, frames.length - 1)];

  return (
    <div
      role="dialog"
      aria-label={`Presentation mode — frame ${index + 1} of ${frames.length}: ${cur.label}`}
      data-canvas-export-ignore="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        pointerEvents: "none",
        // Lightbox: dim everything outside the focused frame. Since
        // the frame is inside the world-transform div and we can't
        // easily punch a hole in CSS, we just darken the WHOLE canvas
        // edges via a radial gradient that fades out where the focused
        // frame is — a soft attention cue rather than a strict mask.
        background: "radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.55) 100%)",
      }}
    >
      {/* Control bar at the bottom-centre */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(11,15,23,0.95)",
          border: "1px solid #475569",
          borderRadius: 999,
          padding: "6px 10px",
          pointerEvents: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          aria-label="Previous frame"
          className="w-8 h-8 rounded-full flex items-center justify-center text-text hover:bg-surface-deep disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 12px", minWidth: 180 }}>
          <span style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600 }}>
            {cur.label || `Frame ${index + 1}`}
          </span>
          <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {index + 1} / {frames.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onNext}
          disabled={index >= frames.length - 1}
          aria-label="Next frame"
          className="w-8 h-8 rounded-full flex items-center justify-center text-text hover:bg-surface-deep disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div style={{ width: 1, height: 18, background: "#475569", margin: "0 4px" }} />
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit presentation"
          title="Exit (Esc)"
          className="w-8 h-8 rounded-full flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export const PresentationMode = memo(PresentationModeImpl);
