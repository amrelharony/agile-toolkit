"use client";

/**
 * Show rooms: one hook for both ends (built on `use-signed-room.ts`, which
 * holds the keys, the signed states, pinning, kick, end, the idle prompt
 * and the 3-hour limit).
 *
 * Host:
 *  - `show(kind, payload)` puts a frame on everyone's screen: the payload
 *    goes through the tool's parser first (`frames.ts`) and is refused
 *    (false) when the parser refuses it, the kind is unknown, or it is too
 *    big. Each frame gets the next number, so the same spin twice is two
 *    frames. `clear()` takes it down; numbers keep rising after a Clear, so
 *    a phone that missed the Clear still sees the next frame as new;
 *  - counts who said "I'm here": the ids are kept in memory only, to count
 *    each seat once, and only seats still in the room count.
 *
 * Participant:
 *  - renders the pinned host's latest frame, its payload parsed by the
 *    tool's parser (a kind this page doesn't know shows `unsupported`); a
 *    state carrying the frame on screen again (a keepalive) keeps it, and
 *    anything else in it (number, kind, payload or time) makes a new frame;
 *  - `sayHere(here)` tells the host "I'm here" (or not any more). That is
 *    all a participant sends.
 *
 * A late joiner gets the latest frame with the state the host sends 500 ms
 * after anyone joins. Nothing is written anywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SIGNED_ROOM_VERSION } from "../signed-room";
import { useSignedRoom, type SignedRoom } from "../use-signed-room";
import type { VisitorIdentity } from "../visitor-rooms";
import type { VoteCrypto } from "../vote-room/crypto";
import {
  SHOW_LIMITS,
  SHOW_ROOM_EVENTS,
  readShowHere,
  readShowState,
  showControlInput,
  showStateInput,
  type ShowFrameWire,
  type ShowRoomTool,
  type ShowStateBody,
} from "./protocol";
import { encodeShowPayload, parseShowPayload } from "./frames";

/** The frame on screen, as both ends see it. */
export interface ShowFrame {
  n: number;
  kind: string;
  /** What the tool's parser made of the payload; null when this page can't draw it. */
  payload: unknown;
  /** True when the payload parsed: a renderer may draw it. */
  supported: boolean;
  /** Host clock (epoch ms) when it was shown. */
  at: number;
}

interface ShowRoomBaseOptions {
  tool: ShowRoomTool;
  code: string;
  identity: VisitorIdentity;
  /** Tests inject a fake. Defaults to WebCrypto (`webVoteCrypto()`); null means none. */
  crypto?: VoteCrypto | null;
}

export interface UseShowRoomHostOptions extends ShowRoomBaseOptions {
  role: "host";
  /** When the room started (epoch ms). Defaults to mount time. */
  startedAt?: number;
}

export interface UseShowRoomParticipantOptions extends ShowRoomBaseOptions {
  role: "participant";
  /** From the join link's `#k=` (`readVoteLinkFragment`). */
  hostFingerprint: string | null;
}

export type UseShowRoomOptions = UseShowRoomHostOptions | UseShowRoomParticipantOptions;

export interface ShowRoom extends Pick<
  SignedRoom,
  | "status"
  | "endReason"
  | "role"
  | "selfId"
  | "hostId"
  | "hostName"
  | "members"
  | "removedIds"
  | "joinPath"
  | "endsAt"
  | "idlePrompt"
  | "keepOpen"
  | "kick"
  | "end"
  | "leave"
  | "extras"
> {
  /** The frame on screen, or null before the host shows anything. */
  frame: ShowFrame | null;
  /** People in the room who said "I'm here". */
  hereCount: number;
  /** Participant: this tab said "I'm here". */
  iAmHere: boolean;
  /** Participant: tell the host "I'm here" (or, with false, not any more). */
  sayHere: (here?: boolean) => void;
  /**
   * Host: show a frame. False when it can't be shown: the room isn't live,
   * the kind has no parser for this tool, the parser refuses the payload,
   * or it is too big.
   */
  show: (kind: string, payload: unknown) => boolean;
  /** Host: take the frame down. */
  clear: () => void;
}

/** The same frame as it travels: number, kind, payload and time all match. */
function sameWire(a: ShowFrameWire, b: ShowFrameWire): boolean {
  return a.n === b.n && a.kind === b.kind && a.data === b.data && a.at === b.at;
}

function frameOf(tool: ShowRoomTool, wire: ShowFrameWire): ShowFrame {
  const payload = parseShowPayload(tool, wire.kind, wire.data);
  return { n: wire.n, kind: wire.kind, payload, supported: payload !== null, at: wire.at };
}

export function useShowRoom(opts: UseShowRoomOptions): ShowRoom {
  const { tool, role } = opts;
  // Host: the frame as sent, the last frame number used (never reset, not
  // even by Clear), and the seats that said "I'm here".
  const frameRef = useRef<ShowFrameWire | null>(null);
  const lastNRef = useRef(0);
  // Participant: the frame on screen as it came, to tell a keepalive from a new frame.
  const wireRef = useRef<ShowFrameWire | null>(null);
  const hereRef = useRef<Set<string>>(new Set());
  const [frame, setFrame] = useState<ShowFrame | null>(null);
  const [hereCount, setHereCount] = useState(0);
  const [iAmHere, setIAmHere] = useState(false);
  const membersRef = useRef<Set<string>>(new Set());

  /** "I'm here" seats still in the room. */
  const countHere = useCallback(() => {
    let n = 0;
    hereRef.current.forEach((id) => {
      if (membersRef.current.has(id)) n++;
    });
    return n;
  }, []);

  const core = useSignedRoom<ShowStateBody>({
    tool,
    code: opts.code,
    identity: opts.identity,
    role,
    hostFingerprint: opts.role === "participant" ? opts.hostFingerprint : null,
    startedAt: opts.role === "host" ? opts.startedAt : undefined,
    crypto: opts.crypto,
    events: SHOW_ROOM_EVENTS,
    stateInput: showStateInput,
    controlInput: showControlInput,
    readState: (raw) => readShowState(raw, tool),
    maxStateChars: SHOW_LIMITS.maxStateChars,
    stateThrottleMs: SHOW_LIMITS.stateThrottleMs,
    buildBody: () => ({ here: countHere(), frame: frameRef.current }),
    onState: (msg) => {
      setHereCount(msg.here);
      const next = msg.frame;
      const prev = wireRef.current;
      // The same frame again (a keepalive): keep the parsed one.
      if (next && prev && sameWire(prev, next)) return;
      wireRef.current = next;
      setFrame(next ? frameOf(tool, next) : null);
    },
    tooBigMessage: "That's too much to show live. Show less at once.",
  });
  const { room, activeRef, scheduleState, touch, admitted, removedRef, selfId } = core;
  const { subscribeToEvent, broadcast } = room;

  // Host: keep the seat list current, so "I'm here" counts only people still in.
  useEffect(() => {
    membersRef.current = new Set(room.members.map((m) => m.id));
    if (role !== "host") return;
    const n = countHere();
    setHereCount((prev) => (prev === n ? prev : n));
  }, [room.members, role, countHere]);

  // Host: "I'm here" from participants.
  useEffect(() => {
    if (role !== "host") return;
    return subscribeToEvent(SHOW_ROOM_EVENTS.here, (raw) => {
      if (!activeRef.current) return;
      const msg = readShowHere(raw);
      if (!msg || msg.by === selfId) return;
      if (removedRef.current.has(msg.by) || !admitted().has(msg.by)) return;
      const had = hereRef.current.has(msg.by);
      if (had === msg.here) return;
      if (msg.here) hereRef.current.add(msg.by);
      else hereRef.current.delete(msg.by);
      setHereCount(countHere());
      scheduleState();
    });
  }, [activeRef, admitted, countHere, removedRef, role, scheduleState, selfId, subscribeToEvent]);

  const show = useCallback(
    (kind: string, payload: unknown): boolean => {
      if (role !== "host" || !activeRef.current) return false;
      const data = encodeShowPayload(tool, kind, payload);
      if (data === null) return false;
      lastNRef.current += 1;
      const wire: ShowFrameWire = {
        n: lastNRef.current,
        kind,
        data,
        at: Date.now(),
      };
      frameRef.current = wire;
      setFrame(frameOf(tool, wire));
      touch();
      scheduleState();
      return true;
    },
    [activeRef, role, scheduleState, tool, touch]
  );

  const clear = useCallback(() => {
    if (role !== "host" || !activeRef.current || frameRef.current === null) return;
    frameRef.current = null;
    setFrame(null);
    touch();
    scheduleState();
  }, [activeRef, role, scheduleState, touch]);

  const sayHere = useCallback(
    (here = true) => {
      if (role !== "participant" || !activeRef.current) return;
      broadcast(SHOW_ROOM_EVENTS.here, { v: SIGNED_ROOM_VERSION, by: selfId, here });
      setIAmHere(here);
    },
    [activeRef, broadcast, role, selfId]
  );

  return {
    status: core.status,
    endReason: core.endReason,
    role: core.role,
    selfId: core.selfId,
    hostId: core.hostId,
    hostName: core.hostName,
    members: core.members,
    removedIds: core.removedIds,
    joinPath: core.joinPath,
    endsAt: core.endsAt,
    idlePrompt: core.idlePrompt,
    keepOpen: core.keepOpen,
    kick: core.kick,
    end: core.end,
    leave: core.leave,
    extras: core.extras,
    frame,
    hereCount,
    iAmHere,
    sayHere,
    show,
    clear,
  };
}
