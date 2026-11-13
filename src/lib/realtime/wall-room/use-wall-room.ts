"use client";

/**
 * Wall rooms: one hook for both ends (built on `use-signed-room.ts`, which
 * holds the keys, the signed states, pinning, kick, end, the idle prompt
 * and the 3-hour limit).
 *
 * Host:
 *  - `openRound(prompt, mode)` puts a prompt on the wall ("live": posts
 *    show as they arrive; "hidden": only a count until `reveal()`), and
 *    `setOpen`, `setMode`, `hide`, `merge`, `lowerHand` run it;
 *  - each request is checked cheaply (seat, removed, a resend), decrypted
 *    in turn, applied by the rules in `host.ts`, and dropped: who wrote or
 *    upvoted what stays in the host's memory only. Its id goes into the
 *    state's acks (or nacks, with why), so the sender knows;
 *  - `view` is what the host's screen may draw: while a round is hidden
 *    until reveal it has the count and no post text;
 *  - `result()` is what the tool may save: the prompt and each post's text
 *    and votes, no ids, no names.
 *
 * Participant:
 *  - `post(text)`, `withdraw(postId)`, `vote(postId)`, `unvote(postId)`,
 *    `raiseHand(up)` each seal one request to the host's key (padded to one
 *    size) and send it, re-sending the same sealed request until the host
 *    acknowledges it, three times at most;
 *  - its own posts (text and the key to take each back) and votes live in
 *    this tab's memory only; `mine` and `myVotes` mark them on the wall.
 *
 * Nothing is written anywhere: the tool saves `result()`, and only when the
 * host asks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { SIGNED_ROOM_VERSION } from "../signed-room";
import { useSignedRoom, type SignedRoom } from "../use-signed-room";
import { cleanText } from "../sanitize";
import type { VisitorIdentity } from "../visitor-rooms";
import type { VoteCrypto } from "../vote-room/crypto";
import {
  WALL_LIMITS,
  WALL_ROOM_EVENTS,
  intentAad,
  lockOf,
  padIntent,
  readIntent,
  readIntentEnvelope,
  readWallState,
  wallControlInput,
  wallStateInput,
  type IntentEnvelope,
  type WallIntent,
  type WallMode,
  type WallPost,
  type WallRefusal,
  type WallRoomTool,
  type WallRoundResult,
  type WallRoundView,
  type WallStateBody,
} from "./protocol";
import {
  applyWallIntent,
  emptyWall,
  hideWallPost,
  hostWallPosts,
  keepPresentHands,
  lowerHand as lowerHandIn,
  mergeWallPosts,
  openWallRound,
  revealWall,
  setWallMode,
  setWallOpen,
  toWallResult,
  wallView,
  type HostWall,
  type HostWallPost,
} from "./host";

/** Participant: the waits before each resend of an unacknowledged request. */
export const WALL_RESEND_DELAYS_MS = [2_000, 4_000, 8_000];

interface WallRoomBaseOptions {
  tool: WallRoomTool;
  code: string;
  identity: VisitorIdentity;
  /** Tests inject a fake. Defaults to WebCrypto (`webVoteCrypto()`); null means none. */
  crypto?: VoteCrypto | null;
}

export interface UseWallRoomHostOptions extends WallRoomBaseOptions {
  role: "host";
  startedAt?: number;
}

export interface UseWallRoomParticipantOptions extends WallRoomBaseOptions {
  role: "participant";
  /** From the join link's `#k=` (`readVoteLinkFragment`). */
  hostFingerprint: string | null;
}

export type UseWallRoomOptions = UseWallRoomHostOptions | UseWallRoomParticipantOptions;

/** The round as a screen draws it. The host's posts carry `hidden`; a participant's never do. */
export interface WallRoundScreen extends Omit<WallRoundView, "posts"> {
  /** Null while the round is hidden until reveal: only `count` may show. */
  posts: (WallPost & { hidden?: boolean })[] | null;
}

export type WallSendResult =
  | "sent"
  | "empty"
  | "too-long"
  | "too-soon"
  | "closed"
  | "not-yours"
  | "failed";

/** One of this tab's own posts. */
export interface MyPost {
  id: string;
  text: string;
  /** "sending" until the host acknowledges it; "refused" (with `why`) or "unconfirmed" if not. */
  status: "sending" | "posted" | "refused" | "unconfirmed" | "withdrawing";
  why?: WallRefusal;
}

export interface WallRoom extends Pick<
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
  /** The round on the wall, or null before the host opens one. */
  round: WallRoundScreen | null;
  /** Members with a raised hand, oldest first, with their names. */
  hands: { id: string; name: string }[];
  // Participant
  /** This tab's posts this round, newest last (in memory only). */
  mine: MyPost[];
  /** Posts this tab upvoted this round. */
  myVotes: ReadonlySet<string>;
  /** This tab's hand is up. */
  handUp: boolean;
  /** The last request the host refused, and why (shown once, then cleared by the next send). */
  lastRefusal: WallRefusal | null;
  post: (text: string) => Promise<WallSendResult>;
  withdraw: (postId: string) => Promise<WallSendResult>;
  vote: (postId: string) => Promise<WallSendResult>;
  unvote: (postId: string) => Promise<WallSendResult>;
  raiseHand: (up: boolean) => Promise<WallSendResult>;
  // Host
  openRound: (prompt: string, mode: WallMode) => boolean;
  setOpen: (open: boolean) => void;
  setMode: (mode: WallMode) => void;
  reveal: () => void;
  hide: (postId: string, hidden: boolean) => void;
  merge: (fromId: string, intoId: string) => void;
  lowerHand: (id: string) => void;
  /** Host: the round as the tool may save it, now (no ids, no names), or null. */
  result: () => WallRoundResult | null;
}

interface PendingIntent {
  iid: string;
  envelope: IntentEnvelope;
  intent: WallIntent;
  resends: number;
}

interface MyEntry {
  post: MyPost;
  key: string;
  round: string;
}

function hostScreen(wall: HostWall): WallRoundScreen | null {
  const view = wallView(wall).round;
  if (!view) return null;
  const posts: HostWallPost[] | null = hostWallPosts(wall);
  return { ...view, posts };
}

export function useWallRoom(opts: UseWallRoomOptions): WallRoom {
  const { tool, role } = opts;
  const selfId = opts.identity.id;

  // Host.
  const wallRef = useRef<HostWall>(emptyWall());
  const acksRef = useRef<string[]>([]);
  const nacksRef = useRef<{ iid: string; why: WallRefusal }[]>([]);
  const [hostView, setHostView] = useState<{ round: WallRoundScreen | null; hands: string[] }>({
    round: null,
    hands: [],
  });
  // Participant.
  const [view, setView] = useState<{ round: WallRoundView | null; hands: string[] }>({
    round: null,
    hands: [],
  });
  const [mineMap, setMineMap] = useState<Map<string, MyEntry>>(new Map());
  const [votes, setVotes] = useState<Map<string, { key: string; round: string }>>(new Map());
  const [lastRefusal, setLastRefusal] = useState<WallRefusal | null>(null);
  const mineRef = useRef(mineMap);
  mineRef.current = mineMap;
  const votesRef = useRef(votes);
  votesRef.current = votes;
  const pendingRef = useRef<Map<string, PendingIntent>>(new Map());
  const resendTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastPostRef = useRef(0);
  const roundIdRef = useRef<string | null>(null);
  // Set below, once the handlers it calls exist; the core calls it only after render.
  const onStateRef = useRef<(msg: WallStateBody) => void>(() => {});

  const core = useSignedRoom<WallStateBody>({
    tool,
    code: opts.code,
    identity: opts.identity,
    role,
    hostFingerprint: opts.role === "participant" ? opts.hostFingerprint : null,
    startedAt: opts.role === "host" ? opts.startedAt : undefined,
    crypto: opts.crypto,
    events: WALL_ROOM_EVENTS,
    stateInput: wallStateInput,
    controlInput: wallControlInput,
    readState: (raw) => readWallState(raw, tool),
    maxStateChars: WALL_LIMITS.maxStateChars,
    stateThrottleMs: WALL_LIMITS.stateThrottleMs,
    buildBody: () => {
      const v = wallView(wallRef.current);
      return {
        round: v.round,
        hands: v.hands,
        acks: acksRef.current.slice(-WALL_LIMITS.maxAcks),
        nacks: nacksRef.current.slice(-WALL_LIMITS.maxNacks),
      };
    },
    onState: (msg) => onStateRef.current(msg),
    tooBigMessage: "The wall is too big to share live. Hide or merge some posts.",
  });
  const { room, activeRef, scheduleState, touch, admitted, removedRef, keysRef, pinnedRef } = core;
  const cryptoImpl = core.crypto;
  const { subscribeToEvent, broadcast } = room;

  // ── Host ─────────────────────────────────────────────────────────

  const publishHost = useCallback(() => {
    const wall = wallRef.current;
    setHostView({ round: hostScreen(wall), hands: wall.hands.map((h) => h.id) });
  }, []);

  const changeWall = useCallback(
    (next: HostWall) => {
      if (next === wallRef.current) return;
      wallRef.current = next;
      publishHost();
      touch();
      scheduleState();
    },
    [publishHost, scheduleState, touch]
  );

  const answer = useCallback((iid: string, why: WallRefusal | null) => {
    if (why === null) {
      acksRef.current = [...acksRef.current.filter((x) => x !== iid), iid].slice(
        -WALL_LIMITS.maxAcks
      );
    } else {
      nacksRef.current = [...nacksRef.current.filter((x) => x.iid !== iid), { iid, why }].slice(
        -WALL_LIMITS.maxNacks
      );
    }
  }, []);

  // Requests are opened one after another, in the order they arrived.
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());
  const waitingRef = useRef(0);

  useEffect(() => {
    if (role !== "host") return;
    return subscribeToEvent(WALL_ROOM_EVENTS.intent, (raw) => {
      if (!activeRef.current || !cryptoImpl) return;
      const env = readIntentEnvelope(raw);
      if (!env || env.by === selfId) return;
      // Cheap checks first, so a flood costs no decryption.
      if (removedRef.current.has(env.by) || !admitted().has(env.by)) return;
      const key = `${env.by}:${env.iid}`;
      if (wallRef.current.recent.includes(key)) {
        scheduleState(); // a resend whose answer went missing
        return;
      }
      if (waitingRef.current >= WALL_LIMITS.maxPostsPerRound) return;
      waitingRef.current += 1;
      openQueueRef.current = openQueueRef.current
        .then(async () => {
          const keys = keysRef.current;
          if (!keys || !activeRef.current) return;
          const plain = await cryptoImpl.open(keys, env, intentAad(env.by, env.iid));
          if (plain === null || !activeRef.current) return;
          const intent = readIntent(plain);
          if (!intent) return;
          const res = applyWallIntent(wallRef.current, env.by, env.iid, intent, {
            admitted: admitted(),
            removed: removedRef.current,
            now: Date.now(),
          });
          if (!res.ok && "duplicate" in res) {
            scheduleState();
            return;
          }
          answer(env.iid, res.ok ? null : res.why);
          wallRef.current = res.wall;
          publishHost();
          if (res.ok) touch();
          scheduleState();
        })
        .catch(() => {})
        .finally(() => {
          waitingRef.current -= 1;
        });
    });
  }, [
    activeRef,
    admitted,
    answer,
    cryptoImpl,
    keysRef,
    publishHost,
    removedRef,
    role,
    scheduleState,
    selfId,
    subscribeToEvent,
    touch,
  ]);

  // People who left take their raised hand with them.
  useEffect(() => {
    if (role !== "host") return;
    const present = new Set(room.members.map((m) => m.id));
    present.add(selfId);
    const next = keepPresentHands(wallRef.current, present);
    if (next !== wallRef.current) {
      wallRef.current = next;
      publishHost();
      scheduleState();
    }
  }, [room.members, role, selfId, publishHost, scheduleState]);

  const openRound = useCallback(
    (prompt: string, mode: WallMode) => {
      if (role !== "host" || !activeRef.current) return false;
      const next = openWallRound(wallRef.current, nanoid(12), prompt, mode);
      if (!next) return false;
      acksRef.current = [];
      nacksRef.current = [];
      changeWall(next);
      return true;
    },
    [activeRef, changeWall, role]
  );

  const hostOnly = useCallback(
    (f: (w: HostWall) => HostWall) => {
      if (role !== "host" || !activeRef.current) return;
      changeWall(f(wallRef.current));
    },
    [activeRef, changeWall, role]
  );

  const setOpen = useCallback((open: boolean) => hostOnly((w) => setWallOpen(w, open)), [hostOnly]);
  const setMode = useCallback(
    (mode: WallMode) => hostOnly((w) => setWallMode(w, mode)),
    [hostOnly]
  );
  const reveal = useCallback(() => hostOnly(revealWall), [hostOnly]);
  const hide = useCallback(
    (postId: string, hidden: boolean) => hostOnly((w) => hideWallPost(w, postId, hidden)),
    [hostOnly]
  );
  const merge = useCallback(
    (fromId: string, intoId: string) => hostOnly((w) => mergeWallPosts(w, fromId, intoId)),
    [hostOnly]
  );
  const lowerHand = useCallback((id: string) => hostOnly((w) => lowerHandIn(w, id)), [hostOnly]);

  const result = useCallback(
    () => (role === "host" ? toWallResult(wallRef.current, tool, new Date().toISOString()) : null),
    [role, tool]
  );

  // ── Participant ──────────────────────────────────────────────────

  const clearResend = useCallback((iid: string) => {
    const t = resendTimersRef.current.get(iid);
    if (t !== undefined) clearTimeout(t);
    resendTimersRef.current.delete(iid);
  }, []);

  useEffect(
    () => () => {
      resendTimersRef.current.forEach((t) => clearTimeout(t));
      resendTimersRef.current.clear();
    },
    []
  );

  const setMine = useCallback((pid: string, change: (e: MyEntry) => MyEntry | null) => {
    setMineMap((prev) => {
      const e = prev.get(pid);
      if (!e) return prev;
      const next = new Map(prev);
      const changed = change(e);
      if (changed) next.set(pid, changed);
      else next.delete(pid);
      return next;
    });
  }, []);

  /** A request this tab sent was answered (or never will be): settle what it was about. */
  const settle = useCallback(
    (p: PendingIntent, outcome: "acked" | WallRefusal | "unconfirmed") => {
      pendingRef.current.delete(p.iid);
      clearResend(p.iid);
      const i = p.intent;
      if (outcome !== "acked" && outcome !== "unconfirmed") setLastRefusal(outcome);
      switch (i.t) {
        case "post":
          setMine(i.pid, (e) => ({
            ...e,
            post: {
              ...e.post,
              status:
                outcome === "acked"
                  ? "posted"
                  : outcome === "unconfirmed"
                    ? "unconfirmed"
                    : "refused",
              why: outcome === "acked" || outcome === "unconfirmed" ? undefined : outcome,
            },
          }));
          break;
        case "withdraw":
          if (outcome === "acked" || outcome === "gone") setMine(i.pid, () => null);
          else setMine(i.pid, (e) => ({ ...e, post: { ...e.post, status: "posted" } }));
          break;
        case "vote":
          // "already": the host has this member's vote (from before a refresh): it stands.
          if (outcome !== "acked" && outcome !== "already") {
            setVotes((prev) => {
              if (!prev.has(i.pid)) return prev;
              const next = new Map(prev);
              next.delete(i.pid);
              return next;
            });
          }
          break;
        case "unvote":
          // Refused: the vote stands (the key didn't open it, or it is gone).
          break;
        case "hand":
          break;
      }
    },
    [clearResend, setMine]
  );

  const scheduleResend = useCallback(
    (p: PendingIntent) => {
      clearResend(p.iid);
      const wait = WALL_RESEND_DELAYS_MS[p.resends];
      if (wait === undefined) return;
      resendTimersRef.current.set(
        p.iid,
        setTimeout(() => {
          resendTimersRef.current.delete(p.iid);
          const now = pendingRef.current.get(p.iid);
          if (!now || !activeRef.current) return;
          if (now.resends >= WALL_RESEND_DELAYS_MS.length - 1) {
            settle(now, "unconfirmed");
            return;
          }
          broadcast(WALL_ROOM_EVENTS.intent, now.envelope);
          now.resends += 1;
          scheduleResend(now);
        }, wait)
      );
    },
    [activeRef, broadcast, clearResend, settle]
  );

  onStateRef.current = (msg) => {
    setView({ round: msg.round, hands: msg.hands });
    // A new round: last round's own posts and votes no longer apply.
    if (msg.round?.id !== roundIdRef.current) {
      roundIdRef.current = msg.round?.id ?? null;
      setMineMap((prev) => {
        const next = new Map(Array.from(prev).filter(([, e]) => e.round === msg.round?.id));
        return next.size === prev.size ? prev : next;
      });
      setVotes((prev) => {
        const next = new Map(Array.from(prev).filter(([, v]) => v.round === msg.round?.id));
        return next.size === prev.size ? prev : next;
      });
    }
    const acks = new Set(msg.acks);
    const nacks = new Map(msg.nacks.map((n) => [n.iid, n.why]));
    pendingRef.current.forEach((p) => {
      if (acks.has(p.iid)) settle(p, "acked");
      else if (nacks.has(p.iid)) settle(p, nacks.get(p.iid)!);
    });
  };

  /** Seal `intent` to the pinned host and send it. */
  const send = useCallback(
    async (intent: WallIntent): Promise<"sent" | "failed" | "closed"> => {
      const pinned = pinnedRef.current;
      if (role !== "participant" || !activeRef.current || !pinned || !cryptoImpl) return "closed";
      const plain = padIntent(intent);
      if (plain === null) return "failed";
      const iid = nanoid(12);
      let sealed: { epk: string; iv: string; ct: string };
      try {
        sealed = await cryptoImpl.seal(pinned.ecdh, intentAad(selfId, iid), plain);
      } catch {
        return "failed";
      }
      if (!activeRef.current || pinnedRef.current?.ecdh !== pinned.ecdh) return "closed";
      const envelope: IntentEnvelope = { v: SIGNED_ROOM_VERSION, by: selfId, iid, ...sealed };
      const pending: PendingIntent = { iid, envelope, intent, resends: 0 };
      pendingRef.current.set(iid, pending);
      setLastRefusal(null);
      broadcast(WALL_ROOM_EVENTS.intent, envelope);
      scheduleResend(pending);
      return "sent";
    },
    [activeRef, broadcast, cryptoImpl, pinnedRef, role, scheduleResend, selfId]
  );

  const currentRound = useCallback((): WallRoundView | null => {
    const r = view.round;
    return r && r.id === roundIdRef.current ? r : null;
  }, [view.round]);

  const post = useCallback(
    async (text: string): Promise<WallSendResult> => {
      const r = currentRound();
      if (!r || !r.open) return "closed";
      if (typeof text !== "string" || text.trim() === "") return "empty";
      const flat = text.replace(/\s+/g, " ").trim();
      if (flat.length > WALL_LIMITS.maxPostChars) return "too-long";
      const clean = cleanText(flat, WALL_LIMITS.maxPostChars);
      if (clean === null) return "empty";
      if (Date.now() - lastPostRef.current < WALL_LIMITS.postIntervalMs) return "too-soon";
      const pid = nanoid(12);
      const key = nanoid(21);
      const res = await send({ t: "post", r: r.id, pid, text: clean, lock: lockOf(key) });
      if (res !== "sent") return res;
      lastPostRef.current = Date.now();
      setMineMap((prev) =>
        new Map(prev).set(pid, {
          post: { id: pid, text: clean, status: "sending" },
          key,
          round: r.id,
        })
      );
      return "sent";
    },
    [currentRound, send]
  );

  const withdraw = useCallback(
    async (postId: string): Promise<WallSendResult> => {
      const e = mineRef.current.get(postId);
      if (!e) return "not-yours";
      const res = await send({ t: "withdraw", r: e.round, pid: postId, key: e.key });
      if (res !== "sent") return res;
      setMine(postId, (x) => ({ ...x, post: { ...x.post, status: "withdrawing" } }));
      return "sent";
    },
    [send, setMine]
  );

  const vote = useCallback(
    async (postId: string): Promise<WallSendResult> => {
      const r = currentRound();
      if (!r || !r.open || !r.posts) return "closed";
      if (mineRef.current.has(postId)) return "not-yours";
      if (votesRef.current.has(postId)) return "sent";
      const key = nanoid(21);
      const res = await send({ t: "vote", r: r.id, pid: postId, lock: lockOf(key) });
      if (res !== "sent") return res;
      setVotes((prev) => new Map(prev).set(postId, { key, round: r.id }));
      return "sent";
    },
    [currentRound, send]
  );

  const unvote = useCallback(
    async (postId: string): Promise<WallSendResult> => {
      const v = votesRef.current.get(postId);
      if (!v) return "not-yours";
      const res = await send({ t: "unvote", r: v.round, pid: postId, key: v.key });
      if (res !== "sent") return res;
      setVotes((prev) => {
        const next = new Map(prev);
        next.delete(postId);
        return next;
      });
      return "sent";
    },
    [send]
  );

  const raiseHand = useCallback(
    async (up: boolean): Promise<WallSendResult> => send({ t: "hand", up }),
    [send]
  );

  // ── What both ends render ────────────────────────────────────────

  const shown = role === "host" ? hostView : { round: view.round, hands: view.hands };
  const nameOf = (id: string) =>
    id === selfId ? opts.identity.name : (room.members.find((m) => m.id === id)?.name ?? null);
  const hands = shown.hands
    .map((id) => ({ id, name: nameOf(id) }))
    .filter((h): h is { id: string; name: string } => h.name !== null);

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
    round: shown.round,
    hands,
    mine: Array.from(mineMap.values()).map((e) => e.post),
    myVotes: new Set(votes.keys()),
    handUp: shown.hands.includes(selfId),
    lastRefusal,
    post,
    withdraw,
    vote,
    unvote,
    raiseHand,
    openRound,
    setOpen,
    setMode,
    reveal,
    hide,
    merge,
    lowerHand,
    result,
  };
}
