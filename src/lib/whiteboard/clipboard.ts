/**
 * Copy / cut / paste / duplicate for whiteboard objects.
 *
 * Strategy: serialise to a JSON envelope under our schema name and stash
 * it on the system clipboard via `navigator.clipboard.writeText`. Pasting
 * reads the same text, recognises our envelope, and offsets all IDs +
 * positions so it doesn't collide with the original. Falls back to an
 * internal in-memory ring buffer if the Clipboard API is unavailable
 * (Safari < 13.4, file:// pages, browsers in incognito with permissions
 * denied).
 */

import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import { isValidObject } from "./object-validator";

const SCHEMA = "agile-toolkit/canvas-clipboard/v1";
const PASTE_OFFSET = 24;

/**
 * Stable whiteboard-object id helper. Shared across clipboard /
 * templates / imports so we get a single source of truth.
 *
 * - Prefer `crypto.randomUUID()` (always 32 hex chars after stripping
 *   hyphens — collision-resistant on a busy board).
 * - Fall back to a timestamp-anchored hybrid that is always ≥ 16 chars
 *   total (Date.now is ~8 chars in base36 + padded 7-char random tail).
 *   The previous `Math.random().toString(36).slice(2, 11)` form could
 *   produce as little as 1 character when the random encoding was short.
 */
export function wbId(prefix = "wb"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9).padEnd(7, "0")}`;
}

interface ClipboardEnvelope {
  schema: typeof SCHEMA;
  objects: WhiteboardObject[];
}

/**
 * Validate one object from an untrusted source (clipboard, drag-drop, JSON
 * import). Returns the object cast to WhiteboardObject if it passes, else
 * null.
 *
 * Body delegates to {@link isValidObject} — the same shared validator the
 * realtime patch handler uses — so a payload hostile enough to be
 * rejected over the wire is ALSO rejected at paste time, and vice
 * versa. Without parity, an attacker can side-step the realtime guards
 * by encoding a malicious envelope and luring a user into pasting it.
 *
 * Image / embed `src` gets an extra URI-scheme whitelist on top of the
 * shared shape check — paste is a high-blast-radius surface for XSS
 * because the renderer will fetch the URL and the SVG export bakes it
 * into an attribute. The realtime path doesn't currently re-fetch a
 * remote peer's data URL, so this stricter check belongs here.
 *
 * This is the trust boundary between system-clipboard text and the
 * workspace store. Any object that survives this function is treated
 * as schema-clean.
 */
function validateClipboardObject(raw: unknown): WhiteboardObject | null {
  if (!isValidObject(raw)) return null;
  // Image / embed URLs are the highest-risk path because the renderer
  // will fetch them and the SVG export will bake the URL into an
  // attribute. Apply the stricter clipboard-only URI whitelist.
  if (raw.type === "image" || raw.type === "embed") {
    if (typeof raw.src !== "string" || !isSafeUrl(raw.src)) return null;
  }
  // Connectors must reference known endpoint IDs but we don't check that
  // here — the id-remapping in readClipboardObjects already drops
  // connectors whose endpoints aren't in the paste set.
  return raw;
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  // Whitelist of raster image data-URLs only. SVG data-URLs are an XSS
  // vector — embedded <script> tags execute when the SVG loads as an
  // image inside an <img> *or* an <object>, and our SVG export will
  // bake the entire data-URL into a `xlink:href` attribute. Allow only
  // formats that have no script-execution surface.
  if (/^data:image\/(png|jpe?g|webp|gif|avif)[;,]/i.test(trimmed)) return true;
  // Reject everything else: javascript:/vbscript:/data:text/html/
  // data:image/svg+xml/file:/etc.
  return false;
}

let fallbackBuffer: ClipboardEnvelope | null = null;

// Most browsers cap clipboard.writeText at a few MB; image-data-URLs can
// easily exceed that. We always populate the in-memory fallback first so
// same-tab paste keeps working even when the system clipboard write
// would fail or be silently truncated.
const CLIPBOARD_TEXT_LIMIT = 4 * 1024 * 1024; // 4 MB

export async function copyObjects(objects: readonly WhiteboardObject[]): Promise<void> {
  const env: ClipboardEnvelope = { schema: SCHEMA, objects: objects.map((o) => ({ ...o })) };
  fallbackBuffer = env;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  const serialised = JSON.stringify(env);
  if (serialised.length > CLIPBOARD_TEXT_LIMIT) return;
  try {
    await navigator.clipboard.writeText(serialised);
  } catch {
    /* fall through — fallbackBuffer already holds the data */
  }
}

/**
 * Returns objects to paste at the new position. IDs are regenerated;
 * positions are offset by `PASTE_OFFSET` from their original (and from
 * any subsequent paste). The caller is responsible for upserting them
 * via the store action.
 *
 * If a target world point is supplied, the pasted bbox center lands at
 * that point (used by "paste here" right-click action).
 */
export async function readClipboardObjects(
  targetBoardId: string,
  options: { offsetIndex?: number; pasteAt?: { x: number; y: number } } = {},
): Promise<WhiteboardObject[]> {
  let env: ClipboardEnvelope | null = null;
  if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
    try {
      const raw = await navigator.clipboard.readText();
      // Cap the raw text size — protects against accidentally JSON.parse'ing
      // a huge non-canvas payload that happens to start with `{"schema":`.
      if (raw.length <= CLIPBOARD_TEXT_LIMIT) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schema === SCHEMA && Array.isArray(parsed.objects)) {
          // Validate each object before trusting the envelope. Anything
          // that fails validation is filtered out silently — pasting a
          // partially-malicious envelope still preserves the clean items.
          const validated: WhiteboardObject[] = [];
          for (const candidate of parsed.objects as unknown[]) {
            const v = validateClipboardObject(candidate);
            if (v) validated.push(v);
          }
          if (validated.length > 0) {
            env = { schema: SCHEMA, objects: validated };
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  if (!env) env = fallbackBuffer;
  if (!env) return [];

  const offsetMult = options.offsetIndex ?? 1;
  let dx = PASTE_OFFSET * offsetMult;
  let dy = PASTE_OFFSET * offsetMult;
  if (options.pasteAt) {
    // Compute bbox center of source then derive dx/dy to land it on target.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of env.objects) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x + o.w > maxX) maxX = o.x + o.w;
      if (o.y + o.h > maxY) maxY = o.y + o.h;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    dx = options.pasteAt.x - cx;
    dy = options.pasteAt.y - cy;
  }

  // Remap connector endpoint IDs to the new pasted IDs so connectors
  // continue to land on their pasted copies (not the originals).
  const idMap = new Map<string, string>();
  for (const o of env.objects) idMap.set(o.id, wbId());

  const now = new Date().toISOString();
  return env.objects.map((o) => {
    const next: WhiteboardObject = {
      ...o,
      id: idMap.get(o.id)!,
      boardId: targetBoardId,
      x: o.x + dx,
      y: o.y + dy,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (next.type === "connector") {
      const mappedFrom = idMap.get(next.fromId);
      const mappedTo = idMap.get(next.toId);
      if (mappedFrom) next.fromId = mappedFrom;
      if (mappedTo) next.toId = mappedTo;
      // If the endpoint wasn't in the paste set, drop the connector.
      if (!mappedFrom || !mappedTo) return null;
    }
    return next;
  }).filter((x): x is WhiteboardObject => x !== null);
}

/** Synchronous duplicate — used by Cmd+D. Bypasses the system clipboard. */
export function duplicateObjects(
  objects: readonly WhiteboardObject[],
  targetBoardId: string,
): WhiteboardObject[] {
  const idMap = new Map<string, string>();
  for (const o of objects) idMap.set(o.id, wbId());
  const now = new Date().toISOString();
  return objects.map((o) => {
    const next: WhiteboardObject = {
      ...o,
      id: idMap.get(o.id)!,
      boardId: targetBoardId,
      x: o.x + PASTE_OFFSET,
      y: o.y + PASTE_OFFSET,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (next.type === "connector") {
      const mappedFrom = idMap.get(next.fromId) ?? next.fromId;
      const mappedTo = idMap.get(next.toId) ?? next.toId;
      next.fromId = mappedFrom;
      next.toId = mappedTo;
    }
    return next;
  });
}
