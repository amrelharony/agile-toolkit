/**
 * Shared runtime validator for WhiteboardObject shapes.
 *
 * This is the single trust boundary for any path that ingests an
 * object from an untrusted source — Supabase Realtime peers (a
 * compromised account / mismatched client version / browser extension
 * injecting traffic), the system clipboard, drag-and-drop, JSON import,
 * etc. Both `use-canvas-room.ts` and `clipboard.ts` route through this
 * function so a payload that the realtime layer would reject also gets
 * rejected at paste time, and vice versa.
 *
 * Returns the value typed as WhiteboardObject if and only if every
 * required field is present, well-typed, and within the per-field caps
 * documented below. Anything that fails is dropped silently — callers
 * are responsible for swallowing nulls and continuing with the rest of
 * a batch (we never want one hostile entry to lose an entire paste /
 * patch).
 */

import type { WhiteboardObject, WhiteboardObjectKind } from "@/lib/stores/workspace-types";

/** Whitelist of valid WhiteboardObjectKind values. Hostile peers can
 * send any string for `type`; without this set, a "type: 'pwned'"
 * payload would pass validation and reach the workspace store as an
 * unrenderable ghost row. Keep in sync with the WhiteboardObjectKind
 * union in workspace-types.ts. */
export const VALID_OBJECT_TYPES: ReadonlySet<WhiteboardObjectKind> = new Set<WhiteboardObjectKind>([
  "sticky", "rect", "ellipse", "diamond", "triangle",
  "line", "arrow", "connector", "text", "freehand",
  "image", "frame", "embed",
  "card", "kanban", "timer", "voting",
]);

/** Connector routing whitelist — must match ConnectorRouting in workspace-types.ts. */
const VALID_CONNECTOR_ROUTING: ReadonlySet<string> = new Set(["straight", "orthogonal", "curved"]);

// ─── Per-field caps for incoming peer payloads ─────────────────────
// Hostile peers can send `{content: "A".repeat(50_000_000)}` and blow
// every receiver's localStorage quota. These caps reject such payloads
// before they reach the workspace store. Numbers chosen to be > any
// legitimate user-typed value but small enough that a 10k-object board
// stays well under localStorage's ~5 MB ceiling.
export const MAX_ID_LEN = 200;
export const MAX_TEXT_LEN = 50_000;     // sticky/text/shape inner content + card description
export const MAX_TITLE_LEN = 2_000;     // card title / frame label / voting question / etc.
export const MAX_SHORT_LEN = 200;       // assignee, alt, status, status keys, etc.
export const MAX_COLOR_LEN = 64;        // hex / rgba / css colour name
export const MAX_TAG_LEN = 64;
export const MAX_TAGS_PER_OBJ = 16;
export const MAX_COORD = 1e7;           // anything outside ±10M world units is hostile
/** Rotation clamp — anything beyond ±3 full turns is hostile / nonsense.
 * Without the cap, `rotation: 1e8` deg passes Number.isFinite and the
 * renderer's matrix math hits floating-point precision cliffs. */
export const MAX_ROTATION_DEG = 1080;
/** Version cap — must fit in a uint32 so a hostile peer can't send
 * Number.MAX_SAFE_INTEGER and lock an object forever (no future write
 * can win the LWW comparison). 2^32 is plenty for a per-object monotonic
 * counter — at 1 bump/ms that's 49 days of continuous edits. */
export const MAX_VERSION = 0xFFFFFFFF;

/** Helper: validate an optional string ≤ cap. Empty strings ARE valid
 * (callers requiring non-empty must check separately) — except where
 * explicitly noted, like `sourceRef.tool` / `sourceRef.entityId` where
 * an empty string is meaningless and a hostile peer could use empty
 * strings to bypass cross-tool entity validation. */
const optStr = (v: unknown, cap = MAX_SHORT_LEN): boolean =>
  v === undefined || (typeof v === "string" && v.length <= cap);

/** Helper: optional string that, when present, must be NON-EMPTY. */
const optStrNonEmpty = (v: unknown, cap = MAX_SHORT_LEN): boolean =>
  v === undefined || (typeof v === "string" && v.length > 0 && v.length <= cap);

/** Helper: validate an optional finite-number with optional bounds. */
const optNum = (v: unknown, min = -MAX_COORD, max = MAX_COORD): boolean =>
  v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max);

/** Kinds where w/h represent endpoint deltas rather than bbox size. For
 * line/arrow, dx/dy may be 0 (vertical line of zero horizontal span);
 * for connector, w/h are typically ignored entirely. All other kinds
 * MUST have positive w/h — division-by-zero in fitToRect, NaN scale in
 * resize handles, and zero-area hit-test bugs trace back to w === 0. */
const ZERO_SIZE_OK: ReadonlySet<string> = new Set(["line", "arrow", "connector"]);

/**
 * Validate a runtime payload as a WhiteboardObject. Returns a type
 * predicate — callers can use `if (isValidObject(o)) o.fooField` and the
 * compiler narrows.
 *
 * This is the SHARED check imported by both the realtime patch handler
 * and the clipboard / drag-drop ingest. Keep validation pure (no
 * side-effects, no logging) so it's safe to run on a hot path.
 */
export function isValidObject(o: unknown): o is WhiteboardObject {
  if (!o || typeof o !== "object") return false;
  const r = o as Record<string, unknown>;
  if (
    typeof r.id !== "string" || r.id.length === 0 || r.id.length > MAX_ID_LEN ||
    typeof r.boardId !== "string" || r.boardId.length === 0 || r.boardId.length > MAX_ID_LEN ||
    typeof r.type !== "string" || !VALID_OBJECT_TYPES.has(r.type as WhiteboardObjectKind) ||
    typeof r.x !== "number" || !Number.isFinite(r.x) || Math.abs(r.x) > MAX_COORD ||
    typeof r.y !== "number" || !Number.isFinite(r.y) || Math.abs(r.y) > MAX_COORD ||
    typeof r.w !== "number" || !Number.isFinite(r.w) || r.w < 0 || r.w > MAX_COORD ||
    typeof r.h !== "number" || !Number.isFinite(r.h) || r.h < 0 || r.h > MAX_COORD ||
    typeof r.z !== "number" || !Number.isFinite(r.z) || Math.abs(r.z) > 1e9 ||
    typeof r.version !== "number" || !Number.isInteger(r.version) || r.version < 0 || r.version > MAX_VERSION
  ) return false;
  // For all shape kinds (everything except line/arrow/connector), w and h must
  // be strictly positive. Zero-width/height objects produce division-by-zero
  // in fitToRect, NaN scaling in resize handles, and degenerate hit-test
  // rectangles that swallow pointer events board-wide.
  if (!ZERO_SIZE_OK.has(r.type)) {
    if (r.w <= 0 || r.h <= 0) return false;
  }
  // Common optional base fields.
  if (r.rotation !== undefined) {
    if (
      typeof r.rotation !== "number" ||
      !Number.isFinite(r.rotation) ||
      r.rotation < -MAX_ROTATION_DEG ||
      r.rotation > MAX_ROTATION_DEG
    ) return false;
  }
  if (r.locked !== undefined && typeof r.locked !== "boolean") return false;
  if (!optStr(r.groupId, MAX_ID_LEN)) return false;
  if (!optStr(r.frameId, MAX_ID_LEN)) return false;
  if (!optStr(r.updatedBy, MAX_ID_LEN)) return false;
  if (!optStr(r.createdBy, MAX_ID_LEN)) return false;
  if (!optStr(r.updatedAt, MAX_SHORT_LEN)) return false;
  if (!optStr(r.createdAt, MAX_SHORT_LEN)) return false;
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags)) return false;
    if (r.tags.length > MAX_TAGS_PER_OBJ) return false;
    for (const t of r.tags) {
      if (typeof t !== "string" || t.length === 0 || t.length > MAX_TAG_LEN) return false;
    }
  }
  if (r.sourceRef !== undefined) {
    if (!r.sourceRef || typeof r.sourceRef !== "object") return false;
    const sr = r.sourceRef as Record<string, unknown>;
    // Empty string here is meaningless and could be used to side-step
    // a downstream "linked to tool X / entity Y" lookup. Require
    // non-empty when present.
    if (!optStrNonEmpty(sr.tool, MAX_SHORT_LEN) || !optStrNonEmpty(sr.entityId, MAX_ID_LEN)) return false;
  }
  // Common style fields on most object kinds.
  if (!optStr(r.color, MAX_COLOR_LEN)) return false;
  if (!optStr(r.stroke, MAX_COLOR_LEN)) return false;
  if (!optStr(r.fill, MAX_COLOR_LEN)) return false;
  if (!optStr(r.textColor, MAX_COLOR_LEN)) return false;
  if (!optStr(r.fontFamily, MAX_SHORT_LEN)) return false;
  if (!optNum(r.strokeWidth, 0, 1000)) return false;
  if (!optNum(r.fontSize, 0, 1000)) return false;
  if (!optNum(r.fontWeight, 0, 1000)) return false;
  if (r.dashed !== undefined && typeof r.dashed !== "boolean") return false;
  if (!optStr(r.content, MAX_TEXT_LEN)) return false;
  // Type-specific field validation. A hostile peer can send
  // `{type:"timer", durationSec:"hello"}` — the base check passes but
  // the timer renderer assumes durationSec is a finite number. We
  // reject malformed type-specific fields here so the workspace store
  // never sees garbage values.
  switch (r.type) {
    case "sticky":
    case "text":
      // content was already validated above.
      break;
    case "timer":
      if (typeof r.durationSec !== "number" || !Number.isFinite(r.durationSec) || r.durationSec < 0 || r.durationSec > 86_400) return false;
      if (r.running !== undefined && typeof r.running !== "boolean") return false;
      if (r.startedAt !== undefined && (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt))) return false;
      if (r.remainingSec !== undefined && (typeof r.remainingSec !== "number" || !Number.isFinite(r.remainingSec))) return false;
      if (!optStr(r.label, MAX_TITLE_LEN)) return false;
      break;
    case "voting":
      if (typeof r.question !== "string" || r.question.length > MAX_TITLE_LEN) return false;
      if (!Array.isArray(r.options)) return false;
      if (r.options.length > 50) return false; // cap option count
      if (r.options.some((opt: unknown) => typeof opt !== "string" || (opt as string).length > 100)) return false;
      // CRITICAL: votes must be a plain object, not an Array. Arrays
      // pass `typeof === "object"` AND are non-null, so without the
      // explicit Array.isArray guard a hostile peer can send
      // `votes: ["a","b",...]` whose Object.entries() coerces indices
      // into string keys and pollutes the vote map.
      if (typeof r.votes !== "object" || r.votes === null || Array.isArray(r.votes)) return false;
      {
        const voteEntries = Object.entries(r.votes as Record<string, unknown>);
        if (voteEntries.length > 5_000) return false; // sane cap for vote count
        for (const [k, v] of voteEntries) {
          if (typeof k !== "string" || k.length === 0 || k.length > MAX_ID_LEN) return false;
          if (typeof v !== "string" || v.length > 100) return false;
        }
      }
      if (typeof r.revealed !== "boolean") return false;
      break;
    case "card":
      if (typeof r.title !== "string" || r.title.length > MAX_TITLE_LEN) return false;
      if (!optStr(r.description, MAX_TEXT_LEN)) return false;
      if (!optStr(r.assignee, MAX_SHORT_LEN)) return false;
      if (!optStr(r.due, MAX_SHORT_LEN)) return false;
      if (r.points !== undefined && (typeof r.points !== "number" || !Number.isFinite(r.points) || r.points < 0 || r.points > 1_000_000)) return false;
      if (!optStr(r.status, MAX_SHORT_LEN)) return false;
      // r.color was validated above.
      break;
    case "kanban":
      if (typeof r.label !== "string" || r.label.length > MAX_TITLE_LEN) return false;
      if (!Array.isArray(r.columns)) return false;
      if (r.columns.length > 20) return false;
      if (r.columns.some((c: unknown) => typeof c !== "string" || (c as string).length > MAX_SHORT_LEN)) return false;
      if (r.columnLabels !== undefined) {
        if (!Array.isArray(r.columnLabels)) return false;
        if (r.columnLabels.length > 20) return false;
        if ((r.columnLabels as unknown[]).some((c) => typeof c !== "string" || (c as string).length > MAX_SHORT_LEN)) return false;
      }
      break;
    case "connector":
      if (typeof r.fromId !== "string" || r.fromId.length === 0 || r.fromId.length > MAX_ID_LEN) return false;
      if (typeof r.toId !== "string" || r.toId.length === 0 || r.toId.length > MAX_ID_LEN) return false;
      // Self-loop connectors are degenerate — routing math divides by
      // (toPos - fromPos) and produces NaN coords. Reject them at
      // ingest so they never reach the renderer.
      if (r.fromId === r.toId) return false;
      if (typeof r.stroke !== "string" || r.stroke.length > MAX_COLOR_LEN) return false;
      if (typeof r.strokeWidth !== "number" || !Number.isFinite(r.strokeWidth) || r.strokeWidth < 0 || r.strokeWidth > 1000) return false;
      if (!optStr(r.label, MAX_TITLE_LEN)) return false;
      // Routing must match the ConnectorRouting union. Without this
      // check, a hostile `routing: "spiral"` reaches the connector
      // renderer which has no switch-default and silently produces an
      // empty path.
      if (typeof r.routing !== "string" || !VALID_CONNECTOR_ROUTING.has(r.routing)) return false;
      break;
    case "freehand":
      if (!Array.isArray(r.points)) return false;
      if (r.points.length > 10_000) return false;
      // Freehand points are flat [x0,y0,x1,y1,...] — odd-length arrays
      // produce a trailing orphan coord that the SVG path builder
      // renders as garbage (or NaN). Reject at ingest.
      if (r.points.length % 2 !== 0) return false;
      if ((r.points as unknown[]).some((p) => typeof p !== "number" || !Number.isFinite(p))) return false;
      break;
    case "image":
    case "embed":
      if (typeof r.src !== "string") return false;
      if (r.src.length > 8 * 1024 * 1024) return false; // 8 MB data URL cap
      if (!optStr(r.alt, MAX_TITLE_LEN)) return false;
      if (r.fit !== undefined && r.fit !== "cover" && r.fit !== "contain") return false;
      if (r.type === "embed" && !optStr(r.kind, MAX_SHORT_LEN)) return false;
      break;
    case "frame":
      if (!optStr(r.label, MAX_TITLE_LEN)) return false;
      break;
    case "line":
    case "arrow":
    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle":
      // All optional style fields validated above.
      break;
  }
  return true;
}
