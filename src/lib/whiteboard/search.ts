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
 * Reduce a whiteboard object to a single text line for prompts +
 * search. Returns null when the object truly has no textual handle
 * (e.g. an empty line/arrow with no label). Connector edges return
 * a synthetic "A → B" descriptor so graph topology is preserved in
 * search results.
 *
 * NOTE: kept in sync with the version previously inlined in
 * ai-prompts/canvas.ts. AI prompts now import from here.
 */
export function objectText(o: WhiteboardObject): string | null {
  switch (o.type) {
    case "sticky":
    case "text":
      return o.content || null;
    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle":
      return o.content ?? null;
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
      return o.title + (o.description ? `\n${o.description}` : "") + (o.assignee ? ` · ${o.assignee}` : "");
    case "kanban":
      return `[Kanban: ${o.label}]`;
    case "timer":
      return o.label ? `[Timer: ${o.label}]` : `[Timer: ${Math.round(o.durationSec)}s]`;
    case "voting":
      return o.question || "[Vote]";
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
export function searchObjects(
  objects: readonly WhiteboardObject[],
  query: string,
): SearchHit[] {
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
    const preview = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    hits.push({
      id: o.id,
      rect: { x: o.x, y: o.y, w: o.w, h: o.h },
      preview,
      type: o.type,
      score,
    });
    if (hits.length >= 200) break; // hard cap before sort to bound CPU
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, 50);
}
