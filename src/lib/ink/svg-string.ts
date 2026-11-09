import type { InkDrawing, InkTone } from "./types";
import { SPOT_PEN } from "./types";
import { washEdgePath, washPath } from "./wash";

/**
 * A drawing as a finished, standalone SVG document with its colours written in:
 * for an image renderer (the link previews in app/og), which can't read the
 * page's CSS. Same layers and strengths as InkArt draws in the browser, but
 * still: no ink-in, no boil, no filters.
 */
export function drawingToSvg(
  drawing: InkDrawing,
  palette: Record<InkTone, string>,
  size = 400
): string {
  const pen = drawing.pen ?? SPOT_PEN;
  const parts: string[] = [];
  for (const w of drawing.washes ?? []) {
    const c = palette[w.tone];
    parts.push(`<path d="${washPath(w)}" fill="${c}" fill-opacity="0.15"/>`);
    parts.push(
      `<path d="${washEdgePath(w)}" fill="none" stroke="${c}" stroke-width="1.1" stroke-opacity="0.28"/>`
    );
  }
  for (const s of drawing.strokes) {
    if (s.fill) {
      const opacity = s.fill === "paper" ? 1 : 0.22;
      parts.push(
        `<path d="${s.fillD ?? s.d}" fill="${palette[s.fill]}" fill-opacity="${opacity}"/>`
      );
    }
    parts.push(
      `<path d="${s.d}" fill="none" stroke="${palette[s.tone ?? "ink"]}" stroke-width="${s.w ?? pen}" stroke-linecap="round" stroke-linejoin="round"/>`
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${drawing.viewBox}" width="${size}" height="${size}">${parts.join("")}</svg>`;
}

/** The SVG as a data URI, for an `<img src>`. */
export function drawingDataUri(
  drawing: InkDrawing,
  palette: Record<InkTone, string>,
  size = 400
): string {
  // btoa, not Buffer: this also runs on the edge. The SVG is plain ASCII.
  return `data:image/svg+xml;base64,${btoa(drawingToSvg(drawing, palette, size))}`;
}
