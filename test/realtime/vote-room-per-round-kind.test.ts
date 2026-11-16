import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ballotAad, type HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  KIND_STATE_VERSION,
  PER_ROUND_STATE_VERSION,
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  VOTE_ROOM_PROTOCOL_VERSION,
  VOTE_ROOM_TOOLS,
  VOTE_ROUND_KINDS,
  defaultRoundKind,
  isAllocationRoomTool,
  isChoiceRoomTool,
  isNumberRoomTool,
  isPairRoomTool,
  isRankRoomTool,
  isScaleRoomTool,
  roundKindsOf,
  signingInput,
  stateVersionOf,
  toolRunsKind,
} from "@/lib/realtime/vote-room/protocol";
import {
  readRoundState,
  roundKindOf,
  specOf,
  stateBodyFor,
  wireSpec,
  wireSpecFor,
  type RoundStateHead,
} from "@/lib/realtime/vote-room/kinds";
import { choiceCiphertextChars } from "@/lib/realtime/vote-room/choice";
import { rankCiphertextChars } from "@/lib/realtime/vote-room/rank";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import {
  ALLOCATION_SHEET,
  CODE,
  NOW,
  PAIR_SHEET,
  QUESTIONNAIRE,
  allocationStateBody,
  fakeVoteCrypto,
  pairStateBody,
  signedKindState,
  signedState,
  stateBody,
  type FakeVoteCrypto,
} from "./vote-room-fixtures";
import {
  DOTS_SHEET,
  NUMBER_SHEET,
  POLL_SHEET,
  RANK_SHEET,
  choiceStateBody,
  rankStateBody,
  signedV3,
} from "./vote-room-kind-fixtures";

/**
 * Round kinds chosen per round: a tool lists the kinds it may run. The six
 * tools from before keep exactly their one kind, so their states and
 * signatures are as they were (v1 scale, v2 pair and allocation); Quick
 * Vote may run scale, choice, rank, number and pair rounds, one per round,
 * and its participants follow the host from one kind to the next. A state
 * of a kind its tool doesn't list is never read.
 */

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { useVoteRoom, type UseVoteRoomHostOptions } from "@/lib/realtime/vote-room/use-vote-room";

const HOST_ID = "host_00000000000";
const KEYS = {
  publicKeys: { sig: `B${"A".repeat(86)}`, ecdh: `B${"C".repeat(86)}` },
} as unknown as HostKeyPair;
const SIG = "s".repeat(86);
const wire = (body: object) => JSON.parse(JSON.stringify({ ...body, sig: SIG })) as unknown;

describe("the kinds each tool may run", () => {
  it("keeps the six tools from before on exactly their one kind", () => {
    expect(VOTE_ROUND_KINDS).toEqual({
      "health-check": ["scale"],
      "psych-safety": ["scale"],
      "mood-tracker": ["scale"],
      "kano-model": ["pair"],
      "buy-a-feature": ["allocation"],
      "hundred-dollar-test": ["allocation"],
      "quick-vote": ["scale", "choice", "rank", "number", "pair"],
    });
    expect(Object.keys(VOTE_ROUND_KINDS)).toEqual([...VOTE_ROOM_TOOLS]);
  });

  it("answers 'may this tool run kind K' for every pair, and nothing outside the kit", () => {
    for (const tool of VOTE_ROOM_TOOLS) {
      const kinds: readonly string[] = VOTE_ROUND_KINDS[tool];
      for (const kind of ["scale", "pair", "allocation", "choice", "rank", "number"]) {
        expect(toolRunsKind(tool, kind), `${tool} ${kind}`).toBe(kinds.includes(kind));
      }
      expect(roundKindsOf(tool)).toEqual(kinds);
      expect(defaultRoundKind(tool)).toBe(kinds[0]);
      expect(roundKindOf(tool)).toBe(kinds[0]);
    }
    expect(toolRunsKind("retro", "scale")).toBe(false);
    expect(toolRunsKind("quick-vote", "allocation")).toBe(false);
    expect(toolRunsKind("quick-vote", "bogus")).toBe(false);
    expect(roundKindsOf("retro")).toEqual([]);
    expect(defaultRoundKind(null)).toBeNull();
  });

  it("makes the guards 'may run' guards: Quick Vote is a scale, pair, choice, rank and number tool", () => {
    expect(isScaleRoomTool("quick-vote")).toBe(true);
    expect(isPairRoomTool("quick-vote")).toBe(true);
    expect(isChoiceRoomTool("quick-vote")).toBe(true);
    expect(isRankRoomTool("quick-vote")).toBe(true);
    expect(isNumberRoomTool("quick-vote")).toBe(true);
    expect(isAllocationRoomTool("quick-vote")).toBe(false);
    for (const t of ["health-check", "kano-model", "buy-a-feature"]) {
      expect(isChoiceRoomTool(t)).toBe(false);
      expect(isRankRoomTool(t)).toBe(false);
      expect(isNumberRoomTool(t)).toBe(false);
    }
  });

  it("keeps scale at v1, pair and allocation at v2, and puts the new kinds at v3", () => {
    expect(stateVersionOf("scale")).toBe(VOTE_ROOM_PROTOCOL_VERSION);
    expect(stateVersionOf("pair")).toBe(KIND_STATE_VERSION);
    expect(stateVersionOf("allocation")).toBe(KIND_STATE_VERSION);
    for (const k of ["choice", "rank", "number"] as const) {
      expect(stateVersionOf(k)).toBe(PER_ROUND_STATE_VERSION);
    }
    expect([VOTE_ROOM_PROTOCOL_VERSION, KIND_STATE_VERSION, PER_ROUND_STATE_VERSION]).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("states, per round", () => {
  const head = (tool: RoundStateHead["tool"]): RoundStateHead => ({
    by: HOST_ID,
    seq: 1,
    tool,
    roundId: "round_000001",
    endsAt: NOW + 1000,
    minN: 3,
    keys: KEYS.publicKeys,
    phase: "open",
    ballots: 0,
    acks: [],
  });

  it("builds the six tools' states exactly as before, and refuses a kind they don't list", () => {
    const scale = stateBodyFor(
      { kind: "scale", questionnaire: QUESTIONNAIRE },
      head("health-check"),
      null
    );
    expect(scale).toEqual(stateBody(HOST_ID, KEYS, { endsAt: NOW + 1000 }));
    expect(scale).not.toHaveProperty("kind");
    expect(Object.keys(scale!)).toEqual(
      Object.keys(stateBody(HOST_ID, KEYS, { endsAt: NOW + 1000 }))
    );
    const pair = stateBodyFor({ kind: "pair", sheet: PAIR_SHEET }, head("kano-model"), null);
    expect(pair).toEqual(pairStateBody(HOST_ID, KEYS, { endsAt: NOW + 1000 }));
    expect(Object.keys(pair!)).toEqual(
      Object.keys(pairStateBody(HOST_ID, KEYS, { endsAt: NOW + 1000 }))
    );
    expect(stateBodyFor({ kind: "choice", sheet: POLL_SHEET }, head("health-check"), null)).toBe(
      null
    );
    expect(
      stateBodyFor({ kind: "scale", questionnaire: QUESTIONNAIRE }, head("kano-model"), null)
    ).toBeNull();
    expect(
      stateBodyFor({ kind: "allocation", sheet: ALLOCATION_SHEET }, head("quick-vote"), null)
    ).toBeNull();
  });

  it("builds Quick Vote's rounds of each kind it lists, naming the kind", () => {
    const qv = head("quick-vote");
    expect(stateBodyFor({ kind: "scale", questionnaire: QUESTIONNAIRE }, qv, null)).toMatchObject({
      v: 1,
      tool: "quick-vote",
    });
    expect(stateBodyFor({ kind: "pair", sheet: PAIR_SHEET }, qv, null)).toMatchObject({
      v: 2,
      kind: "pair",
      tool: "quick-vote",
    });
    for (const spec of [
      { kind: "choice" as const, sheet: POLL_SHEET },
      { kind: "rank" as const, sheet: RANK_SHEET },
      { kind: "number" as const, sheet: NUMBER_SHEET },
    ]) {
      expect(stateBodyFor(spec, qv, null)).toMatchObject({ v: 3, kind: spec.kind });
    }
  });

  it("reads only states of a kind the page's tool lists", () => {
    const hc = wire(stateBody(HOST_ID, KEYS));
    const qvScale = wire(stateBody(HOST_ID, KEYS, { tool: "quick-vote" }));
    const kanoPair = wire(pairStateBody(HOST_ID, KEYS));
    const qvPair = wire({ ...pairStateBody(HOST_ID, KEYS), tool: "quick-vote" });
    const qvChoice = wire(choiceStateBody(HOST_ID, KEYS));
    const qvRank = wire(rankStateBody(HOST_ID, KEYS));
    const allocation = wire(allocationStateBody(HOST_ID, KEYS));

    expect(readRoundState(hc, "health-check")).not.toBeNull();
    expect(readRoundState(kanoPair, "kano-model")).not.toBeNull();
    expect(readRoundState(allocation, "hundred-dollar-test")).not.toBeNull();
    // The six tools never read a new kind, nor another tool's state.
    for (const raw of [qvChoice, qvRank, qvScale, qvPair]) {
      expect(readRoundState(raw, "health-check")).toBeNull();
      expect(readRoundState(raw, "kano-model")).toBeNull();
    }
    expect(readRoundState({ ...(qvChoice as object), tool: "health-check" }, "health-check")).toBe(
      null
    );
    // Quick Vote reads each of its kinds, and nothing else.
    expect(readRoundState(qvScale, "quick-vote")).toMatchObject({ v: 1 });
    expect(readRoundState(qvPair, "quick-vote")).toMatchObject({ v: 2, kind: "pair" });
    expect(readRoundState(qvChoice, "quick-vote")).toMatchObject({ v: 3, kind: "choice" });
    expect(readRoundState(qvRank, "quick-vote")).toMatchObject({ v: 3, kind: "rank" });
    expect(
      readRoundState({ ...(allocation as object), tool: "quick-vote" }, "quick-vote")
    ).toBeNull();
    // A v3 state claiming a v2 kind, or v2 claiming a new kind, is refused.
    expect(readRoundState({ ...(qvChoice as object), v: 2 }, "quick-vote")).toBeNull();
    expect(readRoundState({ ...(qvPair as object), v: 3 }, "quick-vote")).toBeNull();
  });

  it("signs each version under its own domain, so none passes for another", () => {
    const v1 = JSON.parse(signingInput(VOTE_ROOM_EVENTS.state, stateBody(HOST_ID, KEYS)));
    const v2 = JSON.parse(signingInput(VOTE_ROOM_EVENTS.state, pairStateBody(HOST_ID, KEYS)));
    const v3 = JSON.parse(signingInput(VOTE_ROOM_EVENTS.state, choiceStateBody(HOST_ID, KEYS)));
    expect(v1[0]).toBe("agile-toolkit:vote-room:v1");
    expect(v2[0]).toBe("agile-toolkit:vote-room:v2");
    expect(v3[0]).toBe("agile-toolkit:vote-room:v3");
    expect(v3).toContain("choice");
    // The sheet is in the signed text: changing an option changes the signature input.
    const other = choiceStateBody(HOST_ID, KEYS, {
      sheet: { ...POLL_SHEET, options: POLL_SHEET.options.slice(0, 2) },
    });
    expect(signingInput(VOTE_ROOM_EVENTS.state, other)).not.toBe(
      signingInput(VOTE_ROOM_EVENTS.state, choiceStateBody(HOST_ID, KEYS))
    );
  });

  it("checks a round's sheet against the kinds the tool may run", () => {
    expect(wireSpecFor("quick-vote", { kind: "choice", sheet: POLL_SHEET })).toMatchObject({
      ok: true,
    });
    expect(wireSpecFor("health-check", { kind: "choice", sheet: POLL_SHEET })).toEqual({
      ok: false,
      problem: "This tool doesn't run that kind of round.",
    });
    expect(wireSpecFor("quick-vote", specOf("allocation", ALLOCATION_SHEET))).toMatchObject({
      ok: false,
    });
    // A sheet of the wrong shape for its named kind is refused too.
    expect(wireSpec("rank", QUESTIONNAIRE)).toMatchObject({ ok: false });
    expect(wireSpec("number", POLL_SHEET)).toMatchObject({ ok: false });
  });
});

// ── The hook ────────────────────────────────────────────────────────

const HOST: FakeMember = { id: HOST_ID, name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy", joinedAt: "2026-10-26T09:03:00Z" };
const ident = (m: FakeMember) => ({ id: m.id, name: m.name });

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

async function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

type AnyState = Record<string, unknown> & {
  roundId: string;
  keys: { sig: string; ecdh: string };
};

function lastState(ch: FakeChannel): AnyState {
  const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as AnyState | undefined;
  if (!s) throw new Error("the host sent no state");
  return s;
}

let bidCounter = 0;
async function ballotFor(crypto: FakeVoteCrypto, state: AnyState, by: string, plain: string) {
  const bid = `bid_${String(++bidCounter).padStart(8, "0")}`;
  const sealed = await crypto.seal(state.keys.ecdh, ballotAad(state.roundId, by, bid), plain);
  return { v: 1, by, roundId: state.roundId, bid, ...sealed };
}

async function deliver(ch: FakeChannel, event: string, payload: unknown) {
  act(() => ch.deliver(event, payload));
  await flush();
}

async function startHost(opts: Omit<UseVoteRoomHostOptions, "role" | "code" | "identity">) {
  const crypto = fakeVoteCrypto();
  const full: UseVoteRoomHostOptions = {
    role: "host",
    code: CODE,
    identity: ident(HOST),
    startedAt: NOW,
    minN: 3,
    ...opts,
    crypto,
  };
  const view = renderHook(() => useVoteRoom(full));
  await flush();
  const ch = fakeRealtime.last();
  act(() => {
    ch.connect();
    ch.setPresence([HOST, A, B, C]);
  });
  await flush();
  await tick(600);
  return { ...view, ch, crypto };
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useVoteRoom: Quick Vote runs a kind per round", () => {
  it("opens with a named round, counts it, then switches kind on New round", async () => {
    const { ch, crypto, result } = await startHost({
      tool: "quick-vote",
      round: { kind: "choice", sheet: POLL_SHEET },
    });
    expect(result.current.status).toBe("live");
    expect(result.current.kind).toBe("choice");
    expect(result.current.spec).toEqual({ kind: "choice", sheet: POLL_SHEET });
    const s = lastState(ch);
    expect(s).toMatchObject({ v: 3, kind: "choice", tool: "quick-vote", revealed: null });
    for (const [m, pick] of [
      [A, "100"],
      [B, "010"],
      [C, "100"],
    ] as const) {
      const ballot = await ballotFor(crypto, s, m.id, pick);
      expect(ballot.ct).toHaveLength(choiceCiphertextChars(POLL_SHEET));
      await deliver(ch, VOTE_ROOM_EVENTS.ballot, ballot);
    }
    expect(result.current.ballots).toBe(3);
    act(() => result.current.reveal());
    await flush();
    expect(result.current.revealedRound).toEqual({
      kind: "choice",
      rows: [
        { total: 2, backers: null },
        { total: 1, backers: null },
        { total: 0, backers: null },
      ],
    });
    expect(result.current.roundResult).toMatchObject({ kind: "choice", ballots: 3 });
    expect(result.current.result).toBeNull();

    act(() => result.current.newRound({ kind: "rank", sheet: RANK_SHEET }));
    await flush();
    await tick(VOTE_LIMITS.stateThrottleMs);
    const next = lastState(ch);
    expect(next).toMatchObject({ v: 3, kind: "rank", phase: "open", ballots: 0 });
    expect(next.roundId).not.toBe(s.roundId);
    expect(next.keys.ecdh).not.toBe(s.keys.ecdh);
    expect(result.current.kind).toBe("rank");
    expect(result.current.roundResult).toBeNull();
    const ballot = await ballotFor(crypto, next, A.id, "2013");
    expect(ballot.ct).toHaveLength(rankCiphertextChars(RANK_SHEET));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, ballot);
    expect(result.current.ballots).toBe(1);
  });

  it("refuses a kind the tool doesn't list, at the start and on New round", async () => {
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "host",
        tool: "quick-vote",
        code: CODE,
        identity: ident(HOST),
        crypto: fakeVoteCrypto(),
        round: { kind: "allocation", sheet: ALLOCATION_SHEET },
      })
    );
    await flush();
    expect(result.current.status).toBe("unavailable");

    fakeRealtime.reset();
    const started = await startHost({
      tool: "quick-vote",
      round: { kind: "number", sheet: NUMBER_SHEET },
    });
    const first = lastState(started.ch);
    act(() => started.result.current.newRound({ kind: "allocation", sheet: ALLOCATION_SHEET }));
    await flush();
    expect(toastMock.error).toHaveBeenCalledWith(
      "This round can't be shared live. This tool doesn't run that kind of round."
    );
    expect(started.result.current.roundId).toBe(first.roundId);
    expect(started.result.current.kind).toBe("number");
  });

  it("keeps a tool from before on its one kind: Health Check can't start a choice round", async () => {
    const { ch, result } = await startHost({ tool: "health-check", questionnaire: QUESTIONNAIRE });
    const first = lastState(ch);
    expect(first).toMatchObject({ v: 1, tool: "health-check" });
    expect(first).not.toHaveProperty("kind");
    act(() => result.current.newRound({ kind: "choice", sheet: DOTS_SHEET }));
    await flush();
    expect(result.current.roundId).toBe(first.roundId);
    expect(result.current.kind).toBe("scale");
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe("useVoteRoom: a Quick Vote participant follows the host's kind", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  it("reads a choice round, then a rank round, then a scale round, and seals each to its size", async () => {
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool: "quick-vote",
        code: CODE,
        identity: ident(A),
        hostFingerprint: keys.fingerprint,
        crypto,
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A, B, C]);
    });
    await flush();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedV3(crypto, keys, choiceStateBody(HOST.id, keys))
    );
    expect(result.current.status).toBe("live");
    expect(result.current.kind).toBe("choice");
    let res = "";
    await act(async () => {
      res = await result.current.submit({ room: 1, cafe: 1 });
    });
    expect(res).toBe("incomplete");
    await act(async () => {
      res = await result.current.submit({ cafe: 1 });
    });
    expect(res).toBe("sent");
    const [ballot] = ch.sent(VOTE_ROOM_EVENTS.ballot) as { ct: string }[];
    expect(ballot.ct).toHaveLength(choiceCiphertextChars(POLL_SHEET));

    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedV3(
        crypto,
        keys,
        rankStateBody(HOST.id, keys, { seq: 2, roundId: "round_000002" })
      )
    );
    expect(result.current.kind).toBe("rank");
    expect(result.current.spec).toEqual({ kind: "rank", sheet: RANK_SHEET });
    expect(result.current.answered).toBe(false);

    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, {
        seq: 3,
        roundId: "round_000003",
        tool: "quick-vote",
      })
    );
    expect(result.current.kind).toBe("scale");
    expect(result.current.questionnaire).toEqual(QUESTIONNAIRE);
  });

  it("ignores another tool's state and a kind Quick Vote doesn't list", async () => {
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool: "quick-vote",
        code: CODE,
        identity: ident(A),
        hostFingerprint: keys.fingerprint,
        crypto,
      })
    );
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A]);
    });
    await flush();
    await deliver(ch, VOTE_ROOM_EVENTS.state, await signedState(crypto, HOST.id, keys));
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, {
        ...allocationStateBody(HOST.id, keys),
        tool: "quick-vote" as never,
      })
    );
    expect(result.current.status).toBe("waiting");
  });
});
