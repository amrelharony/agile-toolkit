/**
 * Show rooms (Picker's spin, Team Mixer's groups, Card Decks' dealt card):
 * the host broadcasts, everyone watches. The wire protocol, version 1.
 *
 *   host → everyone      "show:state"  Signed<ShowStateBody>  (throttled
 *                                      300 ms, 500 ms after a join, 30 s
 *                                      keepalive: a late joiner gets the
 *                                      latest frame within half a second)
 *   participant → host   "show:here"   ShowHereBody           ("I'm here",
 *                                      or not any more)
 *   host → everyone      "show:kick"   Signed<RoomKickBody>
 *   host → everyone      "show:end"    Signed<RoomEndBody>
 *
 * The host shows typed frames: `{ n, kind, data, at }`, where `kind` names
 * the frame (a spin result, a groups reveal, a dealt card; "text" for any
 * tool) and `data` is its payload as JSON text. Payloads are small and
 * validated by the tool's parser (`frames.ts`): the host never sends one
 * its own parser refuses, and a participant renders only a payload its
 * parser accepts, through the renderer registered for the tool and kind
 * (`renderers/`). A frame of a kind the participant's page doesn't know
 * (a newer build) shows a "reload" line instead. The payload travels as
 * text so the signature covers exactly what was sent.
 *
 * Security model (see RUNBOOK "Show and wall rooms"): a show room is a
 * visitor room, so the 12-character code keeps strangers out. The host
 * signs every message with its room key (`signed-room.ts`); participants
 * pin it through the link's `#k=`, so nobody else in the room can show
 * them anything, kick them or end the room. Participants send nothing but
 * "I'm here"; the host keeps who said so in memory, to count them, and
 * nothing anyone sends is saved.
 *
 * Every reader treats its input as hostile: size first, then a strict
 * shape, rebuilt field by field so unknown fields are dropped. Pure and
 * server-safe: no React, no browser globals.
 */

import { isWithinJsonSize } from "../sanitize";
import { VISITOR_LIMITS, isVisitorMemberId, type VisitorTool } from "../visitor-rooms";
import {
  SIGNED_ROOM_VERSION,
  controlInput,
  headTuple,
  readSignedHead,
  type RoomEndBody,
  type RoomKickBody,
  type Signed,
  type SignedRoomHead,
} from "../signed-room";
import { obj } from "../vote-room/wire";

// ── Tools, events, limits ────────────────────────────────────────────

/** The tools that run show rooms (their `VISITOR_ROOM_KIND` is "show"). */
export const SHOW_ROOM_TOOLS = [
  "picker",
  "team-mixer",
  "card-decks",
] as const satisfies readonly VisitorTool[];
export type ShowRoomTool = (typeof SHOW_ROOM_TOOLS)[number];

export function isShowRoomTool(v: unknown): v is ShowRoomTool {
  return typeof v === "string" && (SHOW_ROOM_TOOLS as readonly string[]).includes(v);
}

export const SHOW_ROOM_EVENTS = {
  state: "show:state",
  here: "show:here",
  kick: "show:kick",
  end: "show:end",
} as const;

export const SHOW_LIMITS = {
  /** A frame kind: lower-case letters, digits and dashes, starting with a letter. */
  maxFrameKindChars: 32,
  /** A frame's payload, as JSON text. */
  maxPayloadChars: 8_000,
  /** Largest show message accepted or sent, in JSON characters. */
  maxStateChars: 12_000,
  /** Shortest gap between two states from the host. */
  stateThrottleMs: 300,
} as const;

const FRAME_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** A well-formed frame kind ("text", "spin", "groups"). */
export function isFrameKind(v: unknown): v is string {
  return typeof v === "string" && FRAME_KIND_RE.test(v);
}

// ── Shapes ───────────────────────────────────────────────────────────

/** One frame as it travels: the payload is JSON text, validated by the tool's parser. */
export interface ShowFrameWire {
  /** Rises with every frame the host shows (a new spin is a new frame). */
  n: number;
  kind: string;
  /** The payload as JSON text. */
  data: string;
  /** Host clock (epoch ms) when the frame was shown. */
  at: number;
}

export interface ShowStateBody extends SignedRoomHead {
  tool: ShowRoomTool;
  /** People in the room who said "I'm here". */
  here: number;
  /** The frame on screen; null before the host shows anything (or after Clear). */
  frame: ShowFrameWire | null;
}

export type ShowStateMessage = Signed<ShowStateBody>;

/** "I'm here" (or not any more), from a participant. */
export interface ShowHereBody {
  v: typeof SIGNED_ROOM_VERSION;
  by: string;
  here: boolean;
}

// ── Signing ──────────────────────────────────────────────────────────

export const SHOW_SIGNING_DOMAIN = "agile-toolkit:show-room:v1";

/** The text the host signs for a state. */
export function showStateInput(body: ShowStateBody): string {
  const f = body.frame;
  return JSON.stringify([
    SHOW_SIGNING_DOMAIN,
    SHOW_ROOM_EVENTS.state,
    ...headTuple(body),
    body.here,
    f === null ? null : [f.n, f.kind, f.data, f.at],
  ]);
}

/** The text the host signs for a kick or an end. */
export function showControlInput(event: string, body: RoomKickBody | RoomEndBody): string {
  return controlInput(SHOW_SIGNING_DOMAIN, event, body);
}

// ── Readers ──────────────────────────────────────────────────────────

const isWhole = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** A frame from the wire, or null. Its payload is checked by the tool's parser after. */
export function readShowFrame(raw: unknown): ShowFrameWire | null {
  const f = obj(raw);
  if (!f || !isWhole(f.n, Number.MAX_SAFE_INTEGER) || f.n < 1) return null;
  if (!isFrameKind(f.kind)) return null;
  if (typeof f.data !== "string" || f.data.length > SHOW_LIMITS.maxPayloadChars) return null;
  if (typeof f.at !== "number" || !Number.isFinite(f.at) || f.at <= 0) return null;
  return { n: f.n, kind: f.kind, data: f.data, at: f.at };
}

/**
 * A host state for this page's `tool`, or null. Checks shape and caps;
 * whether the signature is the pinned host's is the hook's call (it needs
 * WebCrypto), and so is the payload (the tool's parser).
 */
export function readShowState(raw: unknown, tool: ShowRoomTool): ShowStateMessage | null {
  if (!isWithinJsonSize(raw, SHOW_LIMITS.maxStateChars)) return null;
  const m = obj(raw);
  if (!m || !isShowRoomTool(tool)) return null;
  const head = readSignedHead(m, tool);
  if (!head) return null;
  if (!isWhole(m.here, VISITOR_LIMITS.maxMembers)) return null;
  let frame: ShowFrameWire | null = null;
  if (m.frame !== null) {
    frame = readShowFrame(m.frame);
    if (!frame) return null;
  }
  return { ...head, tool, here: m.here, frame };
}

/** A participant's "I'm here", or null. Whether the sender holds a seat is the host's call. */
export function readShowHere(raw: unknown): ShowHereBody | null {
  if (!isWithinJsonSize(raw, 512)) return null;
  const m = obj(raw);
  if (!m || m.v !== SIGNED_ROOM_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.here !== "boolean") return null;
  return { v: SIGNED_ROOM_VERSION, by: m.by, here: m.here };
}
