/**
 * Show rooms: the frame parsers, per tool and kind. A parser turns a
 * payload (parsed from its JSON text) into exactly what the renderer may
 * draw, rebuilding it field by field with every string checked, or null.
 *
 * The host runs the same parser on its own payload before sending (so it
 * never sends what participants would refuse), and participants run it on
 * what arrives. A kind with no parser for the tool is refused on both
 * sides.
 *
 * Every tool gets "text" (`{ title, body }`), a generic frame for testing
 * and for anything simple. Each tool adds its own kinds in its own file
 * under `frames/` (`picker.ts`, `team-mixer.ts`, `card-decks.ts`), so the
 * tools' builders never edit this one.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import { cleanText } from "../sanitize";
import { obj } from "../vote-room/wire";
import { SHOW_LIMITS, isFrameKind, isShowRoomTool, type ShowRoomTool } from "./protocol";
import { CARD_DECKS_FRAMES } from "./frames/card-decks";
import { PICKER_FRAMES } from "./frames/picker";
import { TEAM_MIXER_FRAMES } from "./frames/team-mixer";

/** A payload as the wire carried it (already parsed from JSON) → what may be drawn, or null. */
export type ShowFrameParser<P = unknown> = (raw: unknown) => P | null;

/** A tool's frame kinds and their parsers. */
export type ShowFrameParsers = Readonly<Record<string, ShowFrameParser>>;

// ── The generic text frame ───────────────────────────────────────────

export const TEXT_FRAME_KIND = "text";

export const TEXT_FRAME_LIMITS = { maxTitleChars: 120, maxBodyChars: 1_000 } as const;

/** The generic frame: a title and a line of text. */
export interface TextFrame {
  title: string;
  /** May be "". */
  body: string;
}

/** A text frame, or null: a title of 1 to 120 characters and a body of up to 1,000, one line each. */
export function parseTextFrame(raw: unknown): TextFrame | null {
  const m = obj(raw);
  if (!m) return null;
  const title = cleanText(m.title, TEXT_FRAME_LIMITS.maxTitleChars);
  if (!title || title !== m.title) return null;
  if (m.body === "" || m.body === undefined) return { title, body: "" };
  const body = cleanText(m.body, TEXT_FRAME_LIMITS.maxBodyChars);
  if (!body || body !== m.body) return null;
  return { title, body };
}

/**
 * A text frame from the host's own words: cleaned and cut to the caps
 * rather than refused (it is the host's text). Null when the title is blank.
 */
export function textFrame(title: string, body = ""): TextFrame | null {
  const t = cleanText(title, TEXT_FRAME_LIMITS.maxTitleChars);
  if (!t) return null;
  return { title: t, body: cleanText(body, TEXT_FRAME_LIMITS.maxBodyChars) ?? "" };
}

// ── The registry ─────────────────────────────────────────────────────

const PARSERS: Readonly<Record<ShowRoomTool, ShowFrameParsers>> = {
  picker: { ...PICKER_FRAMES, [TEXT_FRAME_KIND]: parseTextFrame },
  "team-mixer": { ...TEAM_MIXER_FRAMES, [TEXT_FRAME_KIND]: parseTextFrame },
  "card-decks": { ...CARD_DECKS_FRAMES, [TEXT_FRAME_KIND]: parseTextFrame },
};

/** The parser for `tool`'s frames of `kind`, or null when there is none. */
export function showFrameParser(tool: unknown, kind: unknown): ShowFrameParser | null {
  if (!isShowRoomTool(tool) || !isFrameKind(kind)) return null;
  const parsers = PARSERS[tool];
  return Object.prototype.hasOwnProperty.call(parsers, kind) ? parsers[kind] : null;
}

/** The frame kinds `tool` can show. */
export function showFrameKinds(tool: ShowRoomTool): string[] {
  return Object.keys(PARSERS[tool]).filter(isFrameKind);
}

/**
 * A frame's payload from its JSON text, through the tool's parser, or null:
 * an unknown kind, text too long or not JSON, or a payload the parser
 * refuses.
 */
export function parseShowPayload(tool: unknown, kind: unknown, data: unknown): unknown | null {
  const parse = showFrameParser(tool, kind);
  if (!parse || typeof data !== "string" || data.length > SHOW_LIMITS.maxPayloadChars) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  try {
    return parse(raw);
  } catch {
    return null;
  }
}

/**
 * What the host sends for `payload`: the parser's version of it as JSON
 * text, or null when the parser refuses it or it is too long.
 */
export function encodeShowPayload(
  tool: ShowRoomTool,
  kind: string,
  payload: unknown
): string | null {
  const parse = showFrameParser(tool, kind);
  if (!parse) return null;
  let clean: unknown;
  try {
    clean = parse(JSON.parse(JSON.stringify(payload ?? null)));
  } catch {
    return null;
  }
  if (clean === null) return null;
  const data = JSON.stringify(clean);
  return data.length <= SHOW_LIMITS.maxPayloadChars ? data : null;
}
