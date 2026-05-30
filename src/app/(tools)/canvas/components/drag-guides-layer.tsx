"use client";

/**
 * Alignment-guides layer.
 *
 * Owns its own `dragGuides` subscription so the parent WhiteboardCanvas
 * doesn't re-render on every guide update during a drag (~60 Hz). Only the
 * SVG re-renders. Memoised on `camera` so a parent re-render that didn't
 * change the camera doesn't paint this either.
 */

import { memo } from "react";
import { useCanvasStore } from "../use-canvas-store";
import { AlignmentGuides } from "./alignment-guides";

export const DragGuidesLayer = memo(function DragGuidesLayerImpl({
  camera,
}: {
  camera: { x: number; y: number; zoom: number };
}) {
  const dragGuides = useCanvasStore((s) => s.dragGuides);
  if (dragGuides.length === 0) return null;
  return <AlignmentGuides guides={dragGuides} camera={camera} />;
});
