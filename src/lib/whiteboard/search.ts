/**
 * Canvas object text extraction + search.
 *
 * Power-user "Find on board" (Cmd+F) lives here. We extract a single
 * searchable string from every object kind (covering content,
 * labels, alt text, embed URLs) so the AI-prompt path and the UI
 * find-bar can share one source of truth.
 *
 * The matcher is case-insensitive substring with word-boundary
 * scoring; no regex engine, no fancy tokenisation. Big enough boards
 * (1000+ objects) call this from the find-bar on every keystroke —
 * keep it allocation-light.
 */

import type { Rect } from "@/lib/geometry/bbox";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Strip HTML tags + decode entities for plain-text consumers (AI
 * prompts, find-bar previews, plain-text fallbacks).
 *
 * Sticky / text / shape content can now hold Tiptap-emitted HTML
 * (`<p>hello <strong>world</strong></p>`). For AI prompts and find
 * matching, we want "hello world" — passing the raw markup as
 * prompt context confuses the model and pollutes search hits.
 *
 * Pure-string implementation (no DOM, no DOMPurify) so this is safe
 * to call in SSR / Node / Edge runtimes. Output is not safe for
 * `dangerouslySetInnerHTML` — use `sanitizeRichHtml` for that.
 *
 * Conversions:
 *   - `<br>` / `<br/>` / `</p>` / `</div>` / `</li>` → `\n`
 *   - `<li>` (opening) → "- " (bullet marker)
 *   - All other tags → "" (stripped)
 *   - `&nbsp;` → " "
 *   - `&amp;` `&lt;` `&gt;` `&quot;` `&#39;` `&apos;` → respective chars
 *   - Numeric entities `&#NNN;` / `&#xHH;` → respective chars (bounded)
 *   - Collapses 3+ newlines into 2 so multi-paragraph HTML doesn't
 *     produce excessive blank lines.
 */
export function stripRichHtmlTags(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  // Quick path: no `<` means it's already plain text.
  if (input.indexOf("<") === -1) return decodeEntities(input);

  let s = input;
  // Block-level closers become newlines so paragraphs / list items
  // don't collapse into a single line.
  s = s.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // List bullets — opening <li> gets a "- " marker (closing tag
  // already became \n above).
  s = s.replace(/<li[^>]*>/gi, "- ");
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");
  // Entity decoding (kept narrow — these are the common Tiptap /
  // dompurify outputs).
  s = decodeEntities(s);
  // Collapse 3+ newlines into 2 for tidier prompt context.
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  if (s.indexOf("&") === -1) return s;
  return (
    s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      // Numeric decimal entity (bounded to avoid OOM on hand-crafted input)
      .replace(/&#(\d{1,7});/g, (_, n) => {
        const code = Number(n);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      })
      // Numeric hex entity
      .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => {
        const code = parseInt(n, 16);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : "";
      })
  );
}

/**
 * Reduce a whiteboard object to a single text line for prompts +
 * search. Returns null when the object truly has no textual handle
 * (e.g. an empty line/arrow with no label). Connector edges return
 * a synthetic "A → B" descriptor so graph topology is preserved in
 * search results.
 *
 * NOTE: kept in sync with the version previously inlined in
 * ai-prompts/canvas.ts. AI prompts now import from here.
 *
 * Sticky / text / shape content may be Tiptap-emitted HTML. We strip
 * tags so AI prompts and the find-bar both see plain text. Tables
 * flatten into "row1cell1 | row1cell2 \n row2cell1 | row2cell2".
 */
export function objectText(o: WhiteboardObject): string | null {
  switch (o.type) {
    case "sticky":
    case "text": {
      const plain = stripRichHtmlTags(o.content);
      return plain || null;
    }
    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle": {
      const plain = o.content ? stripRichHtmlTags(o.content) : "";
      return plain || null;
    }
    case "frame":
      return `[Frame: ${o.label}]`;
    case "connector":
      return o.label
        ? `[Connector: ${o.fromId} ${o.label} ${o.toId}]`
        : `[Connector: ${o.fromId} → ${o.toId}]`;
    case "line":
    case "arrow":
      return o.type === "arrow" ? "[Arrow]" : "[Line]";
    case "freehand":
      return `[Sketch · ${Math.round(o.points.length / 2)} points]`;
    case "image":
      return o.alt ? `[Image: ${o.alt}]` : "[Image]";
    case "embed":
      return `[Embed (${o.kind}): ${o.src.slice(0, 60)}]`;
    case "card":
      return (
        o.title +
        (o.description ? `\n${o.description}` : "") +
        (o.assignee ? ` · ${o.assignee}` : "")
      );
    case "kanban":
      return `[Kanban: ${o.label}]`;
    case "timer":
      return o.label ? `[Timer: ${o.label}]` : `[Timer: ${Math.round(o.durationSec)}s]`;
    case "voting":
      return o.question || "[Vote]";
    case "mindMapNode":
      return o.text || "[Mind-map node]";
    case "diagramShape":
      return o.label ? `[${o.kind}: ${o.label}]` : `[${o.kind}]`;
    case "table": {
      // Flatten the grid into one line per row, pipe-separated.
      // Trim trailing empty rows/cells so a half-filled table
      // doesn't bloat the AI prompt or find preview.
      const rows = o.rows ?? [];
      const lines = rows
        .map((r) =>
          r
            .map((cell) =>
              stripRichHtmlTags(cell ?? "")
                .replace(/\s+/g, " ")
                .trim()
            )
            .join(" | ")
        )
        .map((s) => s.replace(/(\s\|\s)+$/, "")) // trim trailing empty cells
        .filter((s) => s.length > 0);
      if (lines.length === 0) return null;
      return `[Table]\n${lines.join("\n")}`;
    }
    default:
      return null;
  }
}

export interface SearchHit {
  /** Object id — used by the UI to pan-zoom + highlight. */
  id: string;
  /** Bbox in WORLD coordinates so fitToRects can centre on it. */
  rect: Rect;
  /** Short preview snippet — the matched substring with ~20 chars of
   * surrounding context. Rendered in the find-bar results list. */
  preview: string;
  /** Object type — used for the icon in the results list. */
  type: WhiteboardObject["type"];
  /** Match position score: lower is better (earlier-in-string wins). */
  score: number;
}

/**
 * Find all objects matching the query string. Case-insensitive
 * substring search; empty query returns []. Hits are scored by:
 *
 *   1. Match position (earlier = better; index 0 wins outright)
 *   2. Whole-word match (a 5-letter query that hits a whole word ranks
 *      ahead of the same 5 letters mid-word)
 *
 * Capped at 50 hits to keep the rendered list scannable on huge boards.
 */
export function searchObjects(objects: readonly WhiteboardObject[], query: string): SearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const needle = trimmed.toLowerCase();
  const hits: SearchHit[] = [];
  for (const o of objects) {
    const text = objectText(o);
    if (!text) continue;
    const hay = text.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx < 0) continue;
    // Score: lower is better. Whole-word bonus: subtract 100 if the
    // char before is a word boundary (start of string or non-alnum).
    let score = idx;
    const prev = idx === 0 ? "" : hay[idx - 1];
    const next = hay[idx + needle.length] ?? "";
    if ((idx === 0 || !/\w/.test(prev)) && !/\w/.test(next)) score -= 100;
    // Build a ~50-char preview centred on the match.
    const start = Math.max(0, idx - 20);
    const end = Math.min(text.length, idx + needle.length + 20);
    const preview =
      (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    hits.push({
      id: o.id,
      rect: { x: o.x, y: o.y, w: o.w, h: o.h },
      preview,
      type: o.type,
      score,
    });
    // R11-fix: do NOT cap before scoring. The previous early-break at
    // 200 raw hits dropped any whole-word match in objects 201+, so
    // on a 1000-object board the user could never find a relevant
    // sticky that scored low (e.g. exact title match) if 200 partial
    // matches scored ahead of it. The pre-sort cap traded a tiny CPU
    // bound for a major UX regression on large boards. Score ALL
    // hits, then truncate after sort.
  }
  hits.sort((a, b) => a.score - b.score);
  // Defensive cap after sorting — keeps the rendered list small even
  // when thousands of matches land on a megaboard.
  return hits.slice(0, 50);
}

const OBJECT_KIND_LABEL: Record<WhiteboardObject["type"], string> = {
  sticky: "Sticky note",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  triangle: "Triangle",
  line: "Line",
  arrow: "Arrow",
  connector: "Connector",
  text: "Text",
  freehand: "Sketch",
  image: "Image",
  frame: "Frame",
  embed: "Embed",
  card: "Card",
  kanban: "Kanban board",
  timer: "Timer",
  table: "Table",
  mindMapNode: "Mind-map node",
  diagramShape: "Diagram shape",
  voting: "Vote",
};

/** The user-visible name of an object (its text, label or title). */
function objectName(o: WhiteboardObject): string {
  switch (o.type) {
    case "sticky":
    case "text":
      return stripRichHtmlTags(o.content);
    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle":
      return o.content ? stripRichHtmlTags(o.content) : "";
    case "frame":
    case "kanban":
    case "diagramShape":
      return o.label;
    case "connector":
    case "timer":
      return o.label ?? "";
    case "image":
      return o.alt ?? "";
    case "card":
      return o.title;
    case "voting":
      return o.question;
    case "mindMapNode":
      return o.text;
    default:
      return "";
  }
}

/**
 * Short spoken description of an object — "Sticky note: Ship it,
 * locked". Canvas objects are pointer surfaces inside the board's
 * role="application", so screen-reader users learn what Tab selected
 * through the selection live region rather than from the DOM.
 */
export function describeObject(o: WhiteboardObject): string {
  const kind = OBJECT_KIND_LABEL[o.type] ?? "Object";
  const name = objectName(o).replace(/\s+/g, " ").trim();
  const clipped = name.length > 80 ? `${name.slice(0, 79)}…` : name;
  return `${kind}${clipped ? `: ${clipped}` : ""}${o.locked ? ", locked" : ""}`;
}

/** Live-region text for the current selection ("" when nothing is selected). */
export function describeSelection(selected: readonly WhiteboardObject[]): string {
  if (selected.length === 0) return "";
  if (selected.length === 1) return `${describeObject(selected[0])}, selected`;
  return `${selected.length} objects selected`;
}
