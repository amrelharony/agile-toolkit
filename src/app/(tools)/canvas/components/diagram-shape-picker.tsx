"use client";

import { useEffect, useRef } from "react";
import { useCanvasStore } from "../use-canvas-store";
import { DIAGRAM_SHAPE_KINDS } from "./objects/diagram-shape";

/**
 * Popover palette that appears beside the toolbar when the user
 * clicks the Diagram tool. Picks the shape kind, then the next
 * click on the canvas creates that kind (via the standard
 * `tool="diagramShape"` + `pickedDiagramShape` flow).
 *
 * Closes on outside-click + Escape, so it gets out of the way as
 * soon as the user starts placing. Sized to fit on a 1366×768 dock
 * without clipping the toolbar above.
 */
export function DiagramShapePicker({
  anchorRect,
  onClose,
}: {
  anchorRect: DOMRect | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setTool = useCanvasStore((s) => s.setTool);
  const setPickedDiagramShape = useCanvasStore((s) => s.setPickedDiagramShape);
  const picked = useCanvasStore((s) => s.pickedDiagramShape);

  // Outside-click closes. Pointer-down (not click) so the picker
  // also dismisses when the user starts dragging on the canvas.
  useEffect(() => {
    const onDocPointerDown = (e: PointerEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [onClose]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Default positioning when no anchor (component mounted without
  // a known target): float at top-left of the canvas region.
  const left = anchorRect ? anchorRect.right + 8 : 60;
  const top = anchorRect ? anchorRect.top : 80;

  const entries = Object.entries(DIAGRAM_SHAPE_KINDS);

  return (
    <div
      ref={ref}
      data-canvas-export-ignore="true"
      role="menu"
      aria-label="Diagram shape picker"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 60,
        background: "rgba(11,15,23,0.98)",
        border: "1px solid #475569",
        borderRadius: 8,
        padding: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        display: "grid",
        gridTemplateColumns: "repeat(4, 56px)",
        gap: 4,
      }}
    >
      {entries.map(([kind, def]) => {
        const Icon = def.icon;
        const isPicked = kind === picked;
        return (
          <button
            key={kind}
            type="button"
            role="menuitem"
            title={def.label}
            aria-label={def.label}
            onClick={() => {
              setPickedDiagramShape(kind);
              // Switching to the diagram tool means the next canvas
              // click drops the shape; close the picker so it
              // doesn't sit over the canvas.
              setTool("diagramShape");
              onClose();
            }}
            style={{
              width: 56,
              height: 56,
              borderRadius: 6,
              background: isPicked ? "rgba(0, 240, 255, 0.18)" : "transparent",
              border: isPicked ? "1px solid #00f0ff" : "1px solid transparent",
              color: def.tint,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              cursor: "pointer",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontSize: 9,
              padding: 4,
            }}
          >
            <Icon width={20} height={20} aria-hidden="true" />
            <span style={{ color: "#cbd5e1", fontWeight: 500 }}>{def.label}</span>
          </button>
        );
      })}
    </div>
  );
}
