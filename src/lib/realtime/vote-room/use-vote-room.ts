"use client";

/**
 * Anonymous vote rounds: one hook for both ends of the room.
 *
 * Host (whoever pressed "Run a live round": a visitor, or the owner, see
 * `protocol.ts` for why owners may host these):
 *  - makes the room's signing key and the round's encryption key first
 *    ("preparing"); the channel opens only once they exist;
 *  - sends a signed `vote:state` when something changes (at most every
 *    500 ms), 500 ms after the last of a burst of joins, and every 30 s;
 *  - for each ballot: cheap checks first (round, phase, seat, removed,
 *    duplicate, cap, exact size), then decrypts it, then re-reads the round
 *    (it may have moved on during the await) and folds it into the counts.
 *    The answers are dropped there: the hook has no accessor for counts
 *    before Reveal, only how many ballots arrived;
 *  - Reveal needs minN ballots. It closes the round, withholds questions
 *    under minN, drops the ledger of who answered and the acks, and builds
 *    the `result` the tool may save. New round rotates the encryption key;
 *  - can remove a member (soft: a new tab gets a new id) and end the room.
 *    There's no host migration: the counts exist only in the host's tab.
 *
 * Participant:
 *  - needs the host key fingerprint from the link's `#k=`. Without it the
 *    status is "bad-link" and nothing opens;
 *  - pins the first state whose sender is present, whose signing key
 *    matches the fingerprint, and whose signature verifies; afterwards only
 *    that sender and key, with a rising seq. Kick and end count only when
 *    signed by the pinned key;
 *  - seals its answers to the round key and sends them once per round. It
 *    keeps no copy: sessionStorage records only the round id it answered;
 *  - "host-left" once the pinned host has been missing 10 s.
 *
 * Both: 3-hour hard limit; the host's idle prompt after 30 minutes, then
 * end; "full" when the room already had 20 people; "unavailable" when the
 * channel can't open. A terminal status drops the room code, so `useRoom`
 * closes the channel. Nothing is written to the workspace: the tool saves
 * `result`, and only when the host asks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useRoom, type PresenceMember } from "../use-room";
import { HOST_MIGRATION_DELAY_MS, hostMissingLongEnough } from "../host-election";
import { isWithinJsonSize } from "../sanitize";
import { isRealtimeAvailable } from "../supabase-client";
import {
  VISITOR_LIMITS,
  isVisitorIdentity,
  isVisitorRoomCode,
  visitorRoomsEnabled,
  type VisitorIdentity,
} from "../visitor-rooms";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import { toast } from "@/lib/utils/toast";
import {
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  ballotCiphertextChars,
  encodeAnswers,
  isVoteRoomTool,
  readAnswerString,
  readBallotEnvelope,
  readVoteEnd,
  readVoteKick,
  readVoteState,
  signingInput,
  toWireQuestionnaire,
  type AnswerDraft,
  type Questionnaire,
  type RevealedQuestion,
  type RoundPhase,
  type VoteEndBody,
  type VoteKickBody,
  type VoteRoomTool,
  type VoteStateBody,
  type VoteStateMessage,
} from "./protocol";
import {
  canReveal as tallyCanReveal,
  effectiveMinN,
  emptyLedger,
  emptyTally,
  foldBallot,
  precheckBallot,
  revealTally,
  toRoundResult,
  type BallotLedger,
  type FoldContext,
  type Tally,
  type VoteRoundResult,
} from "./aggregate";
import {
  ballotAad,
  isVoteFingerprint,
  voteJoinUrl,
  webVoteCrypto,
  type HostKeyPair,
  type VoteCrypto,
} from "./crypto";

/** How often the host checks whether the room has gone idle. */
const IDLE_CHECK_MS = 30_000;
/** Ballots the host decrypts at once; more wait for the sender to retry (they don't: they're dropped). */
const MAX_OPENING = 8;

export type VoteRoomRole = "host" | "participant";

export type VoteRoomStatus =
  /** Host: making the room and round keys. No channel yet. */
  | "preparing"
  /** Channel opening. */
  | "connecting"
  /** Participant: connected, waiting for the host's first signed state. */
  | "waiting"
  | "live"
  /** The host ended the room (or, for the host, it ended after going idle). */
  | "ended"
  /** The room reached its 3-hour limit. */
  | "expired"
  /** The host removed this participant. */
  | "kicked"
  /** The room already had 20 people. */
  | "full"
  /** This participant left. */
  | "left"
  /** Participant: the host has been gone 10 s. The round can't continue without it. */
  | "host-left"
  /** No live room here: flag off, no Supabase, no WebCrypto, a refused token, bad options. */
  | "unavailable"
  /** Participant: the link has no (or a malformed) `#k=` host key. */
  | "bad-link";

export type VoteEndReason = "host" | "idle" | "expired" | "host-left";

export type VoteSubmitResult =
  | "sent"
  | "incomplete"
  | "already-answered"
  | "closed"
  | "not-admitted"
  | "failed";

interface VoteRoomBaseOptions {
  tool: VoteRoomTool;
  code: string;
  identity: VisitorIdentity;
  /** Tests inject a fake. Defaults to WebCrypto (`webVoteCrypto()`); null means none. */
  crypto?: VoteCrypto | null;
}

export interface UseVoteRoomHostOptions extends VoteRoomBaseOptions {
  role: "host";
  /** The first round's questions. Later changes need `newRound(next)`. */
  questionnaire: Questionnaire;
  /** Ballots needed to reveal (clamped by `effectiveMinN`). */
  minN?: number;
  /** When the room started (epoch ms). Defaults to mount time. */
  startedAt?: number;
}

export interface UseVoteRoomParticipantOptions extends VoteRoomBaseOptions {
  role: "participant";
  /** From the join link's `#k=` (`readVoteLinkFragment`). */
  hostFingerprint: string | null;
}

export type UseVoteRoomOptions = UseVoteRoomHostOptions | UseVoteRoomParticipantOptions;

export interface VoteRoom {
  status: VoteRoomStatus;
  endReason: VoteEndReason | null;
  role: VoteRoomRole;
  selfId: string;
  /** Host: itself. Participant: the pinned host, once a signed state arrived. */
  hostId: string | null;
  hostName: string | null;
  /** People in the channel, as `useRoom` seats them (at most 20). */
  members: PresenceMember[];
  /** Ids the host removed (host only). */
  removedIds: ReadonlySet<string>;
  questionnaire: Questionnaire | null;
  roundId: string | null;
  phase: RoundPhase | null;
  minN: number;
  /** Ballots counted this round. The only number shown before Reveal. */
  ballots: number;
  /** This client's answers were counted this round (or it answered before a refresh). */
  answered: boolean;
  /** Participant: answers sent, not yet acknowledged by the host. */
  awaitingAck: boolean;
  /** After Reveal: per question, its distribution only from minN answers. */
  revealed: readonly RevealedQuestion[] | null;
  /** When the room closes for everyone (epoch ms), once known. */
  endsAt: number | null;
  /** Send (participant) or count (host) this client's answers for the open round. */
  submit: (draft: AnswerDraft) => Promise<VoteSubmitResult>;
  /** `/join/<tool>/<code>#k=<fingerprint>`, once the host key exists. */
  joinPath: string | null;
  /** Host: Reveal would work now. */
  canReveal: boolean;
  /** Host: why Reveal is off, e.g. "2 of 3 answers. Results show from 3." Null when it's on. */
  revealBlockedReason: string | null;
  /** Host: close the round and show the totals. */
  reveal: () => void;
  /** After Reveal: totals only, ready for the tool's `onSave`. */
  result: VoteRoundResult | null;
  /** Host: start a new round (new round id and key), optionally with new questions. */
  newRound: (next?: Questionnaire) => void;
  /** Host: remove a member (soft). */
  kick: (id: string) => void;
  /** Host: end the room for everyone. */
  end: (reason?: "host" | "idle" | "expired") => void;
  /** Host: the room has been idle 30 minutes and will end unless kept open. */
  idlePrompt: boolean;
  /** Host: answer the idle prompt. */
  keepOpen: () => void;
  /** Leave the room (the host's leave ends it). */
  leave: () => void;
  /** Host: more ballots than different names seen this round: someone may have answered twice. */
  stuffingSuspected: boolean;
}

const TERMINAL: ReadonlySet<VoteRoomStatus> = new Set<VoteRoomStatus>([
  "ended",
  "expired",
  "kicked",
  "full",
  "left",
  "host-left",
  "unavailable",
  "bad-link",
]);

// ── This tab's "already answered" record (round ids only) ────────────

const ANSWERED_KEY_PREFIX = "agile-toolkit:vote-room:answered:";
const MAX_ANSWERED_ROUNDS = 20;
const ROUND_ID_RE = /^[A-Za-z0-9_-]{12}$/;

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage blocked
  }
}

function readAnsweredRounds(code: string): string[] {
  try {
    const raw = sessionStore()?.getItem(`${ANSWERED_KEY_PREFIX}${code}`);
    if (!raw || raw.length > 1024) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((r): r is string => typeof r === "string" && ROUND_ID_RE.test(r))
      : [];
  } catch {
    return [];
  }
}

/** Record that this tab answered round `roundId` in room `code`. Stores the round id only. */
export function markAnswered(code: string, roundId: string): void {
  if (!isVisitorRoomCode(code) || !ROUND_ID_RE.test(roundId)) return;
  const rounds = readAnsweredRounds(code).filter((r) => r !== roundId);
  rounds.push(roundId);
  try {
    sessionStore()?.setItem(
      `${ANSWERED_KEY_PREFIX}${code}`,
      JSON.stringify(rounds.slice(-MAX_ANSWERED_ROUNDS))
    );
  } catch {
    /* storage full or blocked: the host's ledger still refuses a second ballot */
  }
}

/** Whether this tab already answered round `roundId` in room `code` (survives a refresh, not the tab). */
export function hasAnswered(code: string, roundId: string): boolean {
  return isVisitorRoomCode(code) && readAnsweredRounds(code).includes(roundId);
}

// ── Host round ───────────────────────────────────────────────────────

/** Everything the host keeps about the current round. Only `ballots` leaves before Reveal. */
interface HostRound {
  roundId: string;
  questionnaire: Questionnaire;
  phase: RoundPhase;
  tally: Tally;
  ledger: BallotLedger;
  /** Accepted ballot ids, oldest first. */
  acks: string[];
  /** Ballots counted (frozen at Reveal, when the tally is dropped). */
  ballots: number;
  revealed: RevealedQuestion[] | null;
  /** Names (lower-cased) seen in the room this round, for the stuffing warning. */
  namesSeen: Set<string>;
}

function freshRound(q: Questionnaire, names: Iterable<string>): HostRound {
  const roundId = nanoid(12);
  return {
    roundId,
    questionnaire: q,
    phase: "open",
    tally: emptyTally(roundId, q),
    ledger: emptyLedger(),
    acks: [],
    ballots: 0,
    revealed: null,
    namesSeen: new Set(Array.from(names, (n) => n.toLowerCase())),
  };
}

/** What both roles render. */
interface RoundView {
  questionnaire: Questionnaire;
  roundId: string;
  phase: RoundPhase;
  minN: number;
  ballots: number;
  revealed: RevealedQuestion[] | null;
  endsAt: number;
  /** Participant: accepted ballot ids from the host's last state. */
  acks: string[];
  /** Host: whether its own answers are in this round. */
  selfAnswered: boolean;
  /** Host: the stuffing warning. */
  suspicious: boolean;
  /** When this client saw the round revealed (ISO). */
  revealedAt: string | null;
}

function submitResultFor(reason: string): VoteSubmitResult {
  switch (reason) {
    case "duplicate":
      return "already-answered";
    case "closed":
    case "wrong-round":
      return "closed";
    case "removed":
    case "not-admitted":
      return "not-admitted";
    default:
      return "failed";
  }
}

export function useVoteRoom(opts: UseVoteRoomOptions): VoteRoom {
  const { tool, code, identity, role } = opts;
  const selfId = identity.id;
  const hostFingerprint = opts.role === "participant" ? opts.hostFingerprint : null;

  // Fixed at mount: the crypto, the host's first questionnaire and minN.
  const [cryptoImpl] = useState<VoteCrypto | null>(() =>
    opts.crypto !== undefined ? opts.crypto : webVoteCrypto()
  );
  const [firstQuestionnaire] = useState<Questionnaire | null>(() =>
    opts.role === "host" ? toWireQuestionnaire(opts.questionnaire) : null
  );
  const [hostMinN] = useState(() => effectiveMinN(opts.role === "host" ? opts.minN : undefined));

  const [status, setStatus] = useState<VoteRoomStatus>(() => {
    if (role === "participant" && !isVoteFingerprint(hostFingerprint)) return "bad-link";
    if (
      !visitorRoomsEnabled() ||
      !isVoteRoomTool(tool) ||
      !isVisitorRoomCode(code) ||
      !isVisitorIdentity(identity) ||
      !cryptoImpl
    ) {
      return "unavailable";
    }
    if (role === "host") return firstQuestionnaire ? "preparing" : "unavailable";
    return "connecting";
  });
  const [endReason, setEndReason] = useState<VoteEndReason | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [result, setResult] = useState<VoteRoundResult | null>(null);
  const [hostId, setHostId] = useState<string | null>(role === "host" ? selfId : null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [idlePrompt, setIdlePrompt] = useState(false);
  const [removedVersion, setRemovedVersion] = useState(0);
  const [myBallot, setMyBallot] = useState<{ roundId: string; bid: string } | null>(null);

  const active = !TERMINAL.has(status);
  const requested = active && status !== "preparing" ? code : null;
  const room = useRoom<null>(tool, requested, null, { visitor: true, identity });

  // ── Refs read by handlers and timers ─────────────────────────────
  const roomRef = useRef(room);
  roomRef.current = room;
  // Set by the host's `end()` while its signed end is on its way: the room
  // already counts as closed, even if something re-renders before then.
  const closingRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active && !closingRef.current;
  const viewRef = useRef<RoundView | null>(view);
  const keysRef = useRef<HostKeyPair | null>(null);
  const hostRoundRef = useRef<HostRound | null>(null);
  const removedRef = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const endsAtRef = useRef<number>(
    (opts.role === "host" ? (opts.startedAt ?? mountedAtRef.current) : mountedAtRef.current) +
      VISITOR_LIMITS.hardTtlMs
  );
  const lastSentRef = useRef(0);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());
  const sizeWarnedRef = useRef(false);
  const seenMembersRef = useRef<Set<string>>(new Set());
  const openingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  // Participant.
  const pinnedRef = useRef<{ by: string; sigKey: string } | null>(null);
  const lastSeqRef = useRef(-1);
  const pendingStateRef = useRef<VoteStateMessage | null>(null);
  const hostEcdhRef = useRef<string | null>(null);
  const myBallotRef = useRef<{ roundId: string; bid: string } | null>(null);
  const missingSinceRef = useRef<number | null>(null);

  /** Run `task` after every task queued before it: signing and verifying keep their order. */
  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const next = queueRef.current.then(task).catch(() => {});
    queueRef.current = next;
    return next;
  }, []);

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIdlePrompt(false);
  }, []);

  const clearTimers = useCallback(() => {
    if (sendTimerRef.current !== null) clearTimeout(sendTimerRef.current);
    if (joinTimerRef.current !== null) clearTimeout(joinTimerRef.current);
    sendTimerRef.current = null;
    joinTimerRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Close the room on this side with `next` (a terminal status). */
  const stop = useCallback(
    (next: VoteRoomStatus, reason: VoteEndReason | null = null) => {
      activeRef.current = false;
      clearTimers();
      setIdlePrompt(false);
      if (reason) setEndReason(reason);
      setStatus(next);
    },
    [clearTimers]
  );

  // ── Host: the round as the UI sees it ────────────────────────────

  /** Copy the host's round into React state: counts never leave the ref. */
  const publishHost = useCallback(() => {
    const round = hostRoundRef.current;
    if (!round) return;
    const next: RoundView = {
      questionnaire: round.questionnaire,
      roundId: round.roundId,
      phase: round.phase,
      minN: hostMinN,
      ballots: round.ballots,
      revealed: round.revealed,
      endsAt: endsAtRef.current,
      acks: [],
      selfAnswered: round.phase === "open" && round.ledger.voted.has(selfId),
      suspicious: round.ballots > round.namesSeen.size,
      revealedAt: viewRef.current?.roundId === round.roundId ? viewRef.current.revealedAt : null,
    };
    viewRef.current = next;
    setView(next);
  }, [hostMinN, selfId]);

  const foldContext = useCallback((): FoldContext => {
    const round = hostRoundRef.current;
    const admitted = new Set(roomRef.current.members.map((m) => m.id));
    admitted.add(selfId);
    return {
      open: activeRef.current && round?.phase === "open",
      roundId: round?.roundId ?? "",
      admitted,
      removed: removedRef.current,
    };
  }, [selfId]);

  // ── Host: sending ────────────────────────────────────────────────

  const buildState = useCallback((): VoteStateBody | null => {
    const k = keysRef.current;
    const round = hostRoundRef.current;
    if (!k || !round || !isVoteRoomTool(tool)) return null;
    return {
      v: 1,
      by: selfId,
      seq: seqRef.current + 1,
      tool,
      roundId: round.roundId,
      endsAt: endsAtRef.current,
      minN: hostMinN,
      questionnaire: round.questionnaire,
      keys: k.publicKeys,
      phase: round.phase,
      ballots: round.ballots,
      acks: round.phase === "open" ? round.acks.slice(-VOTE_LIMITS.maxAcks) : [],
      revealed: round.phase === "revealed" ? round.revealed : null,
    };
  }, [hostMinN, selfId, tool]);

  /** Sign and send the current state now (after anything already queued). */
  const sendState = useCallback(() => {
    if (role !== "host" || !cryptoImpl) return;
    void enqueue(async () => {
      if (!activeRef.current || !roomRef.current.isConnected) return;
      const k = keysRef.current;
      const body = buildState();
      if (!k || !body) return;
      // Participants refuse anything bigger, so don't spend the quota sending it.
      if (!isWithinJsonSize({ ...body, sig: "x".repeat(86) }, VOTE_LIMITS.maxPayloadChars)) {
        if (!sizeWarnedRef.current) {
          sizeWarnedRef.current = true;
          toast.error(
            "These questions are too long to share live. Shorten them or ask fewer, then start a new round."
          );
        }
        return;
      }
      sizeWarnedRef.current = false;
      const sig = await cryptoImpl.sign(k, signingInput(VOTE_ROOM_EVENTS.state, body));
      if (!activeRef.current) return;
      seqRef.current = body.seq;
      lastSentRef.current = Date.now();
      roomRef.current.broadcast(VOTE_ROOM_EVENTS.state, { ...body, sig });
    });
  }, [buildState, cryptoImpl, enqueue, role]);

  /** Send soon: at once if the last state is 500 ms old, else when it will be. */
  const scheduleState = useCallback(() => {
    if (role !== "host" || sendTimerRef.current !== null) return;
    const wait = Math.max(0, VOTE_LIMITS.stateThrottleMs - (Date.now() - lastSentRef.current));
    sendTimerRef.current = setTimeout(() => {
      sendTimerRef.current = null;
      sendState();
    }, wait);
  }, [role, sendState]);

  /** Sign `body` for `event` and broadcast it, in order after any queued state. */
  const sendSigned = useCallback(
    (
      event: typeof VOTE_ROOM_EVENTS.kick | typeof VOTE_ROOM_EVENTS.end,
      body: VoteKickBody | VoteEndBody
    ) =>
      enqueue(async () => {
        const k = keysRef.current;
        if (!k || !cryptoImpl || !roomRef.current.isConnected) return;
        const sig = await cryptoImpl.sign(k, signingInput(event, body));
        roomRef.current.broadcast(event, { ...body, sig });
      }),
    [cryptoImpl, enqueue]
  );

  // ── Host: keys and the first round ───────────────────────────────

  useEffect(() => {
    if (role !== "host" || status !== "preparing" || !cryptoImpl || !firstQuestionnaire) return;
    let cancelled = false;
    cryptoImpl
      .createHostKeys()
      .then((k) => {
        if (cancelled) return;
        keysRef.current = k;
        hostRoundRef.current = freshRound(firstQuestionnaire, [identity.name]);
        setFingerprint(k.fingerprint);
        publishHost();
        setStatus((s) => (s === "preparing" ? "connecting" : s));
      })
      .catch(() => {
        if (!cancelled) stop("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [role, status, cryptoImpl, firstQuestionnaire, identity.name, publishHost, stop]);

  // ── Host: ending ─────────────────────────────────────────────────

  const end = useCallback(
    (reason: "host" | "idle" | "expired" = "host") => {
      if (role !== "host" || !activeRef.current) return;
      closingRef.current = true;
      activeRef.current = false;
      clearTimers();
      setIdlePrompt(false);
      const finish = () => {
        setEndReason(reason);
        setStatus(reason === "expired" ? "expired" : "ended");
      };
      // Tell the room first (signed), then close the channel.
      void sendSigned(VOTE_ROOM_EVENTS.end, { v: 1, by: selfId, reason }).then(finish);
    },
    [clearTimers, role, selfId, sendSigned]
  );

  // ── Inbound ──────────────────────────────────────────────────────

  const present = useCallback((id: string) => roomRef.current.members.some((m) => m.id === id), []);

  /** Participant: show a verified state from the pinned host. */
  const applyState = useCallback((msg: VoteStateMessage) => {
    const prev = viewRef.current;
    const sameRound = prev?.roundId === msg.roundId;
    const next: RoundView = {
      questionnaire: msg.questionnaire,
      roundId: msg.roundId,
      phase: msg.phase,
      minN: msg.minN,
      ballots: msg.ballots,
      revealed: msg.revealed,
      endsAt: msg.endsAt,
      acks: msg.acks,
      selfAnswered: false,
      suspicious: false,
      revealedAt:
        msg.phase === "revealed"
          ? sameRound && prev?.revealedAt
            ? prev.revealedAt
            : new Date().toISOString()
          : null,
    };
    viewRef.current = next;
    setView(next);
    hostEcdhRef.current = msg.keys.ecdh;
    setHostId(msg.by);
    if (myBallotRef.current && myBallotRef.current.roundId !== msg.roundId) {
      myBallotRef.current = null;
      setMyBallot(null);
    }
    missingSinceRef.current = null;
    setStatus((s) => (s === "connecting" || s === "waiting" ? "live" : s));
  }, []);

  /** Participant: verify `msg` (pinning the host on first use), then apply it. */
  const acceptState = useCallback(
    (msg: VoteStateMessage) =>
      enqueue(async () => {
        if (!activeRef.current || !cryptoImpl) return;
        const pinned = pinnedRef.current;
        if (pinned) {
          if (msg.by !== pinned.by || msg.keys.sig !== pinned.sigKey) return;
          if (msg.seq <= lastSeqRef.current) return;
        } else {
          if (!present(msg.by)) return;
          let fp: string;
          try {
            fp = await cryptoImpl.fingerprint(msg.keys.sig);
          } catch {
            return;
          }
          if (fp !== hostFingerprint) return;
        }
        const { sig, ...body } = msg;
        const ok = await cryptoImpl.verify(
          msg.keys.sig,
          signingInput(VOTE_ROOM_EVENTS.state, body),
          sig
        );
        if (!ok || !activeRef.current) return;
        const now = pinnedRef.current;
        if (now && (now.by !== msg.by || now.sigKey !== msg.keys.sig)) return;
        if (msg.seq <= lastSeqRef.current) return;
        pinnedRef.current = { by: msg.by, sigKey: msg.keys.sig };
        lastSeqRef.current = msg.seq;
        pendingStateRef.current = null;
        applyState(msg);
      }),
    [applyState, cryptoImpl, enqueue, hostFingerprint, present]
  );

  /** Participant: whether a signed control message is the pinned host's. */
  const fromPinnedHost = useCallback(
    async (event: VoteRoomEventControl, body: VoteKickBody | VoteEndBody, sig: string) => {
      const pinned = pinnedRef.current;
      if (!pinned || body.by !== pinned.by || !cryptoImpl) return false;
      return cryptoImpl.verify(pinned.sigKey, signingInput(event, body), sig);
    },
    [cryptoImpl]
  );

  useEffect(() => {
    const r = roomRef.current;
    const offBallot = r.subscribeToEvent(VOTE_ROOM_EVENTS.ballot, (raw) => {
      if (role !== "host" || !activeRef.current || !cryptoImpl) return;
      const env = readBallotEnvelope(raw);
      if (!env || env.by === selfId) return;
      const round = hostRoundRef.current;
      const keys = keysRef.current;
      if (!round || !keys) return;
      // Everything cheap before anything is decrypted.
      if (precheckBallot(env, round.ledger, round.tally, foldContext())) return;
      if (env.ct.length !== ballotCiphertextChars(round.questionnaire.questions.length)) return;
      const opening = openingRef.current;
      if (opening.has(env.by) || opening.size >= MAX_OPENING) return;
      opening.add(env.by);
      void cryptoImpl
        .open(keys, env, ballotAad(env.roundId, env.by, env.bid))
        .then((plain) => {
          // The round, its key, the phase or the seats may have changed meanwhile.
          const now = hostRoundRef.current;
          if (plain === null || !now || now.roundId !== round.roundId || keysRef.current !== keys) {
            return;
          }
          const answers = readAnswerString(plain, now.questionnaire);
          if (!answers) return;
          const res = foldBallot(now.tally, now.ledger, env.by, answers, foldContext());
          if (!res.ok) return;
          hostRoundRef.current = {
            ...now,
            tally: res.tally,
            ledger: res.ledger,
            ballots: res.tally.ballots,
            acks: [...now.acks, env.bid].slice(-VOTE_LIMITS.maxAcks),
          };
          touch();
          publishHost();
          scheduleState();
        })
        .catch(() => {})
        .finally(() => opening.delete(env.by));
    });
    const offState = r.subscribeToEvent(VOTE_ROOM_EVENTS.state, (raw) => {
      // The host's own round is the only truth: inbound state is never applied.
      if (role !== "participant" || !activeRef.current || !isVoteRoomTool(tool)) return;
      const msg = readVoteState(raw, tool);
      if (!msg || msg.by === selfId) return;
      const pinned = pinnedRef.current;
      if (pinned) {
        if (msg.by !== pinned.by || msg.keys.sig !== pinned.sigKey) return;
        if (msg.seq <= lastSeqRef.current) return;
      } else if (!present(msg.by)) {
        // A first state that beat its sender's presence entry: held until it shows up.
        pendingStateRef.current = msg;
        return;
      }
      void acceptState(msg);
    });
    const offKick = r.subscribeToEvent(VOTE_ROOM_EVENTS.kick, (raw) => {
      if (role !== "participant" || !activeRef.current) return;
      const msg = readVoteKick(raw);
      if (!msg || msg.id !== selfId) return;
      const { sig, ...body } = msg;
      void enqueue(async () => {
        if (!activeRef.current) return;
        if (await fromPinnedHost(VOTE_ROOM_EVENTS.kick, body, sig)) stop("kicked");
      });
    });
    const offEnd = r.subscribeToEvent(VOTE_ROOM_EVENTS.end, (raw) => {
      if (role !== "participant" || !activeRef.current) return;
      const msg = readVoteEnd(raw);
      if (!msg) return;
      const { sig, ...body } = msg;
      void enqueue(async () => {
        if (!activeRef.current) return;
        if (!(await fromPinnedHost(VOTE_ROOM_EVENTS.end, body, sig))) return;
        if (body.reason === "expired") stop("expired", "expired");
        else stop("ended", body.reason);
      });
    });
    return () => {
      offBallot();
      offState();
      offKick();
      offEnd();
    };
  }, [
    acceptState,
    cryptoImpl,
    enqueue,
    foldContext,
    fromPinnedHost,
    present,
    publishHost,
    role,
    scheduleState,
    selfId,
    stop,
    tool,
    touch,
  ]);

  // A first state that beat its sender's presence entry: check it once the sender shows up.
  useEffect(() => {
    const pending = pendingStateRef.current;
    if (role !== "participant" || !pending || pinnedRef.current) return;
    if (room.members.some((m) => m.id === pending.by)) {
      pendingStateRef.current = null;
      void acceptState(pending);
    }
  }, [room.members, role, acceptState]);

  // ── Status from the channel ──────────────────────────────────────

  useEffect(() => {
    if (room.roomFull && active) stop("full");
  }, [room.roomFull, active, stop]);

  useEffect(() => {
    if (active && requested !== null && room.isLocalOnly) stop("unavailable");
  }, [active, requested, room.isLocalOnly, stop]);

  useEffect(() => {
    if (!room.isConnected) return;
    if (role === "host") setStatus((s) => (s === "connecting" ? "live" : s));
    else setStatus((s) => (s === "connecting" ? "waiting" : s));
  }, [role, room.isConnected]);

  // ── Host: send on join, as a keepalive, and track who was seen ───

  useEffect(() => {
    if (role !== "host" || !active || !room.isConnected) return;
    const ids = new Set(room.members.map((m) => m.id));
    let joined = false;
    ids.forEach((id) => {
      if (!seenMembersRef.current.has(id)) joined = true;
    });
    const left = Array.from(seenMembersRef.current).some((id) => !ids.has(id));
    seenMembersRef.current = ids;
    const round = hostRoundRef.current;
    if (round) {
      const before = round.namesSeen.size;
      for (const m of room.members) round.namesSeen.add(m.name.toLowerCase());
      if (round.namesSeen.size !== before) publishHost();
    }
    if (joined || left) touch();
    if (joined) {
      // One send after the last of a burst of joins.
      if (joinTimerRef.current !== null) clearTimeout(joinTimerRef.current);
      joinTimerRef.current = setTimeout(() => {
        joinTimerRef.current = null;
        sendState();
      }, VOTE_LIMITS.joinDebounceMs);
    }
  }, [room.members, room.isConnected, role, active, touch, sendState, publishHost]);

  useEffect(() => {
    if (role !== "host" || !active || !room.isConnected || fingerprint === null) return;
    scheduleState();
    const id = setInterval(sendState, VISITOR_LIMITS.keepaliveMs);
    return () => clearInterval(id);
  }, [role, active, room.isConnected, fingerprint, scheduleState, sendState]);

  // ── Host: idle prompt, then end ──────────────────────────────────

  useEffect(() => {
    if (role !== "host" || !active) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= VISITOR_LIMITS.idleMs) setIdlePrompt(true);
    }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, [role, active]);

  useEffect(() => {
    if (!idlePrompt || role !== "host" || !active) return;
    const t = setTimeout(() => end("idle"), VISITOR_LIMITS.idleGraceMs);
    return () => clearTimeout(t);
  }, [idlePrompt, role, active, end]);

  // ── Everyone: the hard TTL ───────────────────────────────────────

  const viewEndsAt = view?.endsAt ?? null;
  useEffect(() => {
    if (!active) return;
    const ownLimit = mountedAtRef.current + VISITOR_LIMITS.hardTtlMs;
    const deadline =
      role === "host" ? endsAtRef.current : Math.min(ownLimit, viewEndsAt ?? Infinity);
    const t = setTimeout(
      () => {
        if (role === "host") end("expired");
        else stop("expired", "expired");
      },
      Math.max(0, deadline - Date.now())
    );
    return () => clearTimeout(t);
  }, [active, role, viewEndsAt, end, stop]);

  // ── Participant: the host left ───────────────────────────────────

  useEffect(() => {
    if (role !== "participant" || !active || !room.isConnected) return;
    const pinned = pinnedRef.current;
    if (!pinned) return;
    if (room.members.some((m) => m.id === pinned.by)) {
      missingSinceRef.current = null;
      return;
    }
    if (missingSinceRef.current === null) missingSinceRef.current = Date.now();
    const wait = Math.max(0, HOST_MIGRATION_DELAY_MS - (Date.now() - missingSinceRef.current));
    const t = setTimeout(() => {
      if (roomRef.current.members.some((m) => m.id === pinned.by)) return;
      if (!hostMissingLongEnough(missingSinceRef.current, Date.now())) return;
      stop("host-left", "host-left");
    }, wait);
    return () => clearTimeout(t);
  }, [room.members, room.isConnected, role, active, stop]);

  // ── Actions ──────────────────────────────────────────────────────

  const submit = useCallback(
    async (draft: AnswerDraft): Promise<VoteSubmitResult> => {
      const v = viewRef.current;
      if (!activeRef.current || !v || v.phase !== "open") return "closed";

      if (role === "host") {
        const round = hostRoundRef.current;
        if (!round || round.roundId !== v.roundId) return "closed";
        const answerString = encodeAnswers(draft, round.questionnaire);
        if (answerString === null) return "incomplete";
        const answers = readAnswerString(answerString, round.questionnaire);
        if (!answers) return "incomplete";
        const res = foldBallot(round.tally, round.ledger, selfId, answers, foldContext());
        if (!res.ok) return submitResultFor(res.reason);
        hostRoundRef.current = {
          ...round,
          tally: res.tally,
          ledger: res.ledger,
          ballots: res.tally.ballots,
        };
        touch();
        publishHost();
        scheduleState();
        return "sent";
      }

      if (myBallotRef.current?.roundId === v.roundId || hasAnswered(code, v.roundId)) {
        return "already-answered";
      }
      const answers = encodeAnswers(draft, v.questionnaire);
      if (answers === null) return "incomplete";
      if (!present(selfId)) return "not-admitted";
      const hostKey = hostEcdhRef.current;
      if (!hostKey || !cryptoImpl) return "closed";
      const bid = nanoid(12);
      let sealed: { epk: string; iv: string; ct: string };
      try {
        sealed = await cryptoImpl.seal(hostKey, ballotAad(v.roundId, selfId, bid), answers);
      } catch {
        return "failed";
      }
      // The round may have closed or moved on while sealing.
      const now = viewRef.current;
      if (
        !activeRef.current ||
        !now ||
        now.roundId !== v.roundId ||
        now.phase !== "open" ||
        hostEcdhRef.current !== hostKey
      ) {
        return "closed";
      }
      roomRef.current.broadcast(VOTE_ROOM_EVENTS.ballot, {
        v: 1,
        by: selfId,
        roundId: v.roundId,
        bid,
        epk: sealed.epk,
        iv: sealed.iv,
        ct: sealed.ct,
      });
      const mine = { roundId: v.roundId, bid };
      myBallotRef.current = mine;
      setMyBallot(mine);
      markAnswered(code, v.roundId);
      return "sent";
    },
    [code, cryptoImpl, foldContext, present, publishHost, role, scheduleState, selfId, touch]
  );

  const reveal = useCallback(() => {
    const round = hostRoundRef.current;
    if (role !== "host" || !activeRef.current || !round || round.phase !== "open") return;
    if (!tallyCanReveal(round.tally, hostMinN)) return;
    const revealed = revealTally(round.tally, hostMinN);
    const closedAt = new Date().toISOString();
    setResult(
      toRoundResult(round.questionnaire, revealed, {
        tool,
        roundId: round.roundId,
        closedAt,
        minN: hostMinN,
        ballots: round.tally.ballots,
        source: "live",
      })
    );
    // The counts behind withheld questions, the ledger and the acks go now.
    hostRoundRef.current = {
      ...round,
      phase: "revealed",
      revealed,
      ballots: round.tally.ballots,
      tally: emptyTally(round.roundId, round.questionnaire),
      ledger: emptyLedger(),
      acks: [],
    };
    viewRef.current = viewRef.current ? { ...viewRef.current, revealedAt: closedAt } : null;
    touch();
    publishHost();
    if (sendTimerRef.current !== null) {
      clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
    sendState();
  }, [hostMinN, publishHost, role, sendState, tool, touch]);

  const newRound = useCallback(
    (next?: Questionnaire) => {
      const keys = keysRef.current;
      const current = hostRoundRef.current;
      if (role !== "host" || !activeRef.current || !keys || !current || !cryptoImpl) return;
      let q = current.questionnaire;
      if (next) {
        const wire = toWireQuestionnaire(next);
        if (!wire) {
          toast.error("These questions can't be shared live. Check that every question has text.");
          return;
        }
        q = wire;
      }
      cryptoImpl
        .rotateRoundKey(keys)
        .then((k) => {
          if (!activeRef.current) return;
          keysRef.current = k;
          hostRoundRef.current = freshRound(
            q,
            roomRef.current.members.map((m) => m.name).concat(identity.name)
          );
          setResult(null);
          touch();
          publishHost();
          sendState();
        })
        .catch(() => toast.error("Couldn't start a new round. Try again."));
    },
    [cryptoImpl, identity.name, publishHost, role, sendState, touch]
  );

  const kick = useCallback(
    (id: string) => {
      if (role !== "host" || !activeRef.current || id === selfId) return;
      removedRef.current.add(id);
      setRemovedVersion((n) => n + 1);
      touch();
      void sendSigned(VOTE_ROOM_EVENTS.kick, { v: 1, by: selfId, id });
    },
    [role, selfId, sendSigned, touch]
  );

  const leave = useCallback(() => {
    if (!activeRef.current) return;
    if (role === "host") end("host");
    else stop("left");
  }, [end, role, stop]);

  const keepOpen = useCallback(() => touch(), [touch]);

  // ── Result ───────────────────────────────────────────────────────

  const participantResult = useMemo(() => {
    if (role !== "participant" || !view || view.phase !== "revealed" || !view.revealed) return null;
    if (!isVoteRoomTool(tool)) return null;
    return toRoundResult(view.questionnaire, view.revealed, {
      tool,
      roundId: view.roundId,
      closedAt: view.revealedAt ?? new Date().toISOString(),
      minN: view.minN,
      ballots: view.ballots,
      source: "live",
    });
  }, [role, tool, view]);

  const minN = view?.minN ?? (role === "host" ? hostMinN : VOTE_LIMITS.minNFloor);
  const ballots = view?.ballots ?? 0;
  const phase = view?.phase ?? null;
  const roundId = view?.roundId ?? null;
  const storedAnswer = useMemo(
    () => (role === "participant" && roundId ? hasAnswered(code, roundId) : false),
    // `myBallot` re-reads storage after this tab answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, code, roundId, myBallot]
  );
  const acked =
    myBallot !== null &&
    myBallot.roundId === roundId &&
    (view?.acks.includes(myBallot.bid) ?? false);
  const answered =
    role === "host" ? (view?.selfAnswered ?? false) : acked || (storedAnswer && myBallot === null);
  const awaitingAck =
    role === "participant" && myBallot !== null && myBallot.roundId === roundId && !acked;

  const hostCanReveal = role === "host" && active && phase === "open" && ballots >= minN;
  let revealBlockedReason: string | null = null;
  if (role === "host" && !hostCanReveal) {
    if (!active) revealBlockedReason = "The room has closed.";
    else if (phase === "revealed") revealBlockedReason = "This round's results are showing.";
    else if (phase === null) revealBlockedReason = "The round hasn't started yet.";
    else {
      revealBlockedReason = `${ballots} of ${minN} answers. Results show from ${minN}.`;
    }
  }

  const hostName =
    hostId === null
      ? null
      : hostId === selfId
        ? identity.name
        : (room.members.find((m) => m.id === hostId)?.name ?? null);
  // `removedVersion` re-renders the member list after a kick.
  const removedIds = useMemo(
    () => new Set(removedRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removedVersion]
  );

  const joinPath = isVoteRoomTool(tool)
    ? role === "host"
      ? fingerprint
        ? voteJoinUrl(tool, code, fingerprint)
        : null
      : isVoteFingerprint(hostFingerprint)
        ? voteJoinUrl(tool, code, hostFingerprint)
        : null
    : null;

  return {
    status,
    endReason,
    role,
    selfId,
    hostId,
    hostName,
    members: room.members,
    removedIds,
    questionnaire: view?.questionnaire ?? null,
    roundId,
    phase,
    minN,
    ballots,
    answered,
    awaitingAck,
    revealed: view?.revealed ?? null,
    endsAt: role === "host" ? endsAtRef.current : (view?.endsAt ?? null),
    submit,
    joinPath,
    canReveal: hostCanReveal,
    revealBlockedReason,
    reveal,
    result: role === "host" ? result : participantResult,
    newRound,
    kick,
    end,
    idlePrompt,
    keepOpen,
    leave,
    stuffingSuspected: role === "host" && (view?.suspicious ?? false),
  };
}

type VoteRoomEventControl = typeof VOTE_ROOM_EVENTS.kick | typeof VOTE_ROOM_EVENTS.end;

// ── Availability ─────────────────────────────────────────────────────

export interface VoteRoomsAvailability {
  available: boolean;
  /**
   * Why not: the flag is off, Supabase isn't configured, this browser has no
   * WebCrypto or isn't on HTTPS, the viewer is a squad guest (guests don't
   * host), or the owner check / browser check is still running.
   */
  reason: "flag-off" | "no-realtime" | "no-crypto" | "guest" | "auth-pending" | null;
}

/**
 * Whether this viewer can host a live vote round here. Reads the browser
 * only after mount, so the server render and the first client render agree
 * ("auth-pending"). `crypto` lets tests inject a fake (undefined: WebCrypto).
 */
export function useVoteRoomsAvailable(crypto?: VoteCrypto | null): VoteRoomsAvailability {
  const guest = useGuestProfile();
  const { settled, unverified } = useOwnerState();
  const [browser, setBrowser] = useState<{ realtime: boolean; crypto: boolean } | null>(null);
  useEffect(() => {
    setBrowser({
      realtime: isRealtimeAvailable(),
      crypto: crypto !== undefined ? crypto !== null : webVoteCrypto() !== null,
    });
  }, [crypto]);

  if (!visitorRoomsEnabled()) return { available: false, reason: "flag-off" };
  if (guest !== null) return { available: false, reason: "guest" };
  if (!browser || !settled || unverified) return { available: false, reason: "auth-pending" };
  if (!browser.realtime) return { available: false, reason: "no-realtime" };
  if (!browser.crypto) return { available: false, reason: "no-crypto" };
  return { available: true, reason: null };
}
