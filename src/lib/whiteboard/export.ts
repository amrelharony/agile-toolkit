/**
 * Canvas export — PNG, SVG, JSON.
 *
 * - PNG export piggy-backs the existing `html-to-image` helper used by
 *   `ExportButton`. Caller passes the DOM node containing the rendered
 *   canvas; we set CSS to ignore current transforms so the exported image
 *   shows the natural object positions.
 * - SVG export builds a fresh SVG document by walking the object list.
 *   No DOM dependency — runs server-side too. Hand-rolled so we can control
 *   the cyberpunk palette and embed text faithfully.
 * - JSON export is straight serialisation of (board, objects, comments).
 */

import { toPng } from "html-to-image";
import type {
  Whiteboard,
  WhiteboardObject,
  WhiteboardCommentThread,
} from "@/lib/stores/workspace-types";
import { boundingBoxOfFlatPoints, boundingBoxOfPoints } from "@/lib/geometry/bbox";
import { routeConnector, arrowheadPoints } from "@/lib/geometry/path-routing";

/**
 * Export `node` (typically the canvas viewport) as a PNG.
 *
 * NOTE: this captures whatever's CURRENTLY rendered — the viewport's CSS
 * transform (pan/zoom) is preserved, so the PNG matches what the user sees
 * on screen. If you want to export the entire board regardless of current
 * camera, fit-to-content first via the FitToContent button, then export.
 *
 * `pixelRatio: 2` doubles resolution so the PNG looks crisp on Retina
 * displays. `cacheBust` defeats cross-origin image caching that can leave
 * stale frames in screenshots after a hot reload.
 *
 * The `filter` callback removes any element flagged with the
 * `data-canvas-export-ignore` attribute — toolbars, zoom controls, the
 * minimap, comment-drawer, etc. — so the exported PNG looks like the
 * board, not the whole UI shell.
 */
export async function exportPng(node: HTMLElement, filename = "canvas.png"): Promise<void> {
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#0b0f17",
    filter: (n) => {
      if (!(n instanceof HTMLElement)) return true;
      return !n.hasAttribute("data-canvas-export-ignore");
    },
  });
  triggerDownload(dataUrl, filename);
}

export function exportJson(
  board: Whiteboard,
  objects: readonly WhiteboardObject[],
  comments: readonly WhiteboardCommentThread[],
  filename = "canvas.json",
): void {
  const payload = {
    schema: "agile-toolkit/canvas/v1",
    board,
    objects,
    comments,
  };
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
  triggerDownload(dataUrl, filename);
}

export function exportSvg(
  board: Whiteboard,
  objects: readonly WhiteboardObject[],
  filename = "canvas.svg",
): void {
  // Compute bbox of everything so we can size the SVG to fit.
  const allPoints: { x: number; y: number }[] = [];
  for (const o of objects) {
    allPoints.push({ x: o.x, y: o.y });
    allPoints.push({ x: o.x + o.w, y: o.y + o.h });
  }
  const bbox = boundingBoxOfPoints(allPoints);
  const pad = 40;
  const W = Math.max(800, bbox.w + pad * 2);
  const H = Math.max(600, bbox.h + pad * 2);
  const offX = -bbox.x + pad;
  const offY = -bbox.y + pad;

  const elems: string[] = [];
  const objectById = new Map(objects.map((o) => [o.id, o]));

  // Render in z-order — back to front.
  const ordered = [...objects].sort((a, b) => a.z - b.z);
  for (const o of ordered) {
    elems.push(svgForObject(o, offX, offY, objectById));
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="0" y="0" width="${W}" height="${H}" fill="#0b0f17"/>
<title>${escapeXml(board.name)}</title>
${elems.join("\n")}
</svg>`;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  triggerDownload(dataUrl, filename);
}

function svgForObject(
  o: WhiteboardObject,
  offX: number,
  offY: number,
  byId: Map<string, WhiteboardObject>,
): string {
  const x = o.x + offX;
  const y = o.y + offY;
  // SECURITY: every value that lands in an SVG attribute below could be
  // user-controlled (color picker, clipboard paste, cross-tool import,
  // realtime patch from peer). Without escaping, an attacker could break
  // out of an attribute and inject `onload=` / `onmouseover=` event
  // handlers that execute when the SVG is opened in a browser. We pipe
  // EVERY string-typed user input through escapeAttr; numeric inputs
  // (sizes, positions, font weights) are stringified by the template and
  // are safe.
  switch (o.type) {
    case "sticky":
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="${escapeAttr(o.color)}" rx="6" />
<foreignObject x="${x}" y="${y}" width="${o.w}" height="${o.h}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font:14px sans-serif;color:${escapeAttr(o.textColor ?? "#0b0f17")};padding:10px;box-sizing:border-box;white-space:pre-wrap;word-wrap:break-word;">${escapeXml(o.content)}</div>
</foreignObject></g>`;
    case "rect":
      return `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="${escapeAttr(o.fill ?? "none")}" stroke="${escapeAttr(o.stroke ?? "#475569")}" stroke-width="${o.strokeWidth ?? 1}" />`;
    case "ellipse":
      return `<ellipse cx="${x + o.w / 2}" cy="${y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" fill="${escapeAttr(o.fill ?? "none")}" stroke="${escapeAttr(o.stroke ?? "#475569")}" stroke-width="${o.strokeWidth ?? 1}" />`;
    case "diamond":
      return `<polygon points="${x + o.w / 2},${y} ${x + o.w},${y + o.h / 2} ${x + o.w / 2},${y + o.h} ${x},${y + o.h / 2}" fill="${escapeAttr(o.fill ?? "none")}" stroke="${escapeAttr(o.stroke ?? "#475569")}" stroke-width="${o.strokeWidth ?? 1}" />`;
    case "triangle":
      return `<polygon points="${x + o.w / 2},${y} ${x + o.w},${y + o.h} ${x},${y + o.h}" fill="${escapeAttr(o.fill ?? "none")}" stroke="${escapeAttr(o.stroke ?? "#475569")}" stroke-width="${o.strokeWidth ?? 1}" />`;
    case "line":
    case "arrow": {
      const x2 = x + o.w;
      const y2 = y + o.h;
      const dash = o.dashed ? `stroke-dasharray="6 4"` : "";
      const stroke = escapeAttr(o.stroke);
      let s = `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${o.strokeWidth}" ${dash} />`;
      if (o.type === "arrow") {
        const tangent = unitVec(x2 - x, y2 - y);
        const pts = arrowheadPoints({ x: x2, y: y2 }, tangent, Math.max(8, o.strokeWidth * 3));
        s += `<polygon points="${pts}" fill="${stroke}" />`;
      }
      return s;
    }
    case "connector": {
      const from = byId.get(o.fromId);
      const to = byId.get(o.toId);
      if (!from || !to) return "";
      const path = routeConnector(
        { x: from.x + offX, y: from.y + offY, w: from.w, h: from.h },
        { x: to.x + offX, y: to.y + offY, w: to.w, h: to.h },
        o.routing,
        o.fromAnchor,
        o.toAnchor,
      );
      const dash = o.dashed ? `stroke-dasharray="6 4"` : "";
      const stroke = escapeAttr(o.stroke);
      let s = `<path d="${path.d}" fill="none" stroke="${stroke}" stroke-width="${o.strokeWidth}" ${dash} />`;
      if (o.arrowEnd) {
        const pts = arrowheadPoints(path.end, path.endTangent, Math.max(8, o.strokeWidth * 3));
        s += `<polygon points="${pts}" fill="${stroke}" />`;
      }
      if (o.arrowStart) {
        const tan = { x: -path.endTangent.x, y: -path.endTangent.y };
        const pts = arrowheadPoints(path.start, tan, Math.max(8, o.strokeWidth * 3));
        s += `<polygon points="${pts}" fill="${stroke}" />`;
      }
      return s;
    }
    case "text":
      return `<text x="${x}" y="${y + o.fontSize}" font-size="${o.fontSize}" fill="${escapeAttr(o.color)}" font-weight="${o.fontWeight ?? 400}" text-anchor="${o.align === "center" ? "middle" : o.align === "right" ? "end" : "start"}">${escapeXml(o.content)}</text>`;
    case "freehand": {
      // Translate the freehand points by the offset.
      const flat: number[] = [];
      for (let i = 0; i < o.points.length; i += 2) {
        flat.push(o.points[i] + offX, o.points[i + 1] + offY);
      }
      // Use a simple polyline for the SVG export — perfect-freehand's
      // pressure-aware contour is overkill on a static export.
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(`${flat[i]},${flat[i + 1]}`);
      const bb = boundingBoxOfFlatPoints(flat); // ensure import is used
      void bb;
      return `<polyline points="${pts.join(" ")}" fill="none" stroke="${escapeAttr(o.stroke)}" stroke-width="${o.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
    }
    case "image":
      // SECURITY: o.src is user-controlled (data URL or paste-from-other-canvas)
      // and lands inside an attribute; without escaping, an attacker who can
      // set the src to e.g. `"/><script>...</script><img src="` would break
      // out of the attribute and execute arbitrary SVG/HTML when the exported
      // file is opened in a browser. We also reject javascript:/vbscript: URIs
      // outright — they have no legitimate use in our image src.
      return `<image x="${x}" y="${y}" width="${o.w}" height="${o.h}" href="${escapeAttr(sanitizeUrl(o.src))}" preserveAspectRatio="${o.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}" />`;
    case "frame":
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="${escapeAttr(o.fill ?? "none")}" stroke="#475569" stroke-dasharray="4 4" rx="8" />
<text x="${x + 12}" y="${y + 20}" font-size="14" fill="#94a3b8">${escapeXml(o.label)}</text></g>`;
    case "embed":
      return `<rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="#1e293b" stroke="#475569" />
<text x="${x + o.w / 2}" y="${y + o.h / 2}" font-size="12" fill="#94a3b8" text-anchor="middle">${escapeXml(o.kind)}: ${escapeXml(o.src.slice(0, 40))}</text>`;
    default:
      return "";
  }
}

function unitVec(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Same escaping rules as escapeXml — safe for attribute values too — but
 * tolerates non-string inputs (legacy data may have a number where we
 * expect a string). Anything non-string is coerced via String().
 */
function escapeAttr(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return "";
  return escapeXml(typeof s === "string" ? s : String(s));
}

/**
 * Reject URLs that would execute script when the exported SVG is opened.
 * Whitelist: http, https, data:image/* (for inline images). Anything else
 * — javascript:, vbscript:, data:text/html, etc. — gets blanked out so the
 * SVG renders a broken image rather than a vector for arbitrary script.
 */
function sanitizeUrl(url: string): string {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  // Anything else (javascript:, file:, data:text/html, vbscript:) → blank.
  return "";
}

function triggerDownload(dataUrl: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
