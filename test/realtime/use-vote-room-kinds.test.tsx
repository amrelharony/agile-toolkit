import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ballotAad, type HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import {
  VOTE_LIMITS,
  VOTE_ROOM_EVENTS,
  ballotCiphertextChars,
  signingInput,
} from "@/lib/realtime/vote-room/protocol";
import {
  allocationCiphertextChars,
  type AllocationStateMessage,
} from "@/lib/realtime/vote-room/allocation";
import { pairDraftKey, type PairStateMessage } from "@/lib/realtime/vote-room/pair";
import { fakeRealtime, type FakeChannel, type FakeMember } from "./fake-realtime";
import {
  ALLOCATION_SHEET,
  BUY_SHEET,
  CODE,
  NOW,
  PAIR_SHEET,
  QUESTIONNAIRE,
  ROUND,
  allocationStateBody,
  allocationString,
  fakeVoteCrypto,
  pairStateBody,
  pairString,
  signedKindState,
  signedState,
  type FakeVoteCrypto,
} from "./vote-room-fixtures";

/**
 * The room hook running pair (Kano) and allocation (Buy-a-Feature, $100
 * Test) rounds, against a fake Realtime channel and a fake VoteCrypto: the
 * host's options must match the tool's kind, every ballot has the round's
 * one size, nothing is shared before Reveal, the reveal and spread rules
 * hold, New round can't change the kind, and a participant reads only its
 * tool's kind of state.
 */

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import {
  useVoteRoom,
  type UseVoteRoomHostOptions,
  type UseVoteRoomParticipantOptions,
} from "@/lib/realtime/vote-room/use-vote-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy", joinedAt: "2026-10-26T09:03:00Z" };
const D: FakeMember = { id: "dave0_0000000000", name: "Dee", joinedAt: "2026-10-26T09:04:00Z" };
const E: FakeMember = { id: "erin0_0000000000", name: "Eve", joinedAt: "2026-10-26T09:05:00Z" };

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
  sig: string;
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

async function startHost(
  opts: Omit<UseVoteRoomHostOptions, "role" | "code" | "identity">,
  present: FakeMember[]
) {
  const crypto = (opts.crypto as FakeVoteCrypto | undefined) ?? fakeVoteCrypto();
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
    ch.setPresence(present);
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
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useVoteRoom: the host's options must match the tool's kind", () => {
  it.each<[string, Partial<UseVoteRoomHostOptions>]>([
    [
      "an allocation tool given questions",
      { tool: "hundred-dollar-test", questionnaire: QUESTIONNAIRE },
    ],
    ["an allocation tool given a pair sheet", { tool: "buy-a-feature", pairSheet: PAIR_SHEET }],
    [
      "an allocation tool given two rounds",
      { tool: "hundred-dollar-test", sheet: ALLOCATION_SHEET, questionnaire: QUESTIONNAIRE },
    ],
    [
      "an allocation tool given a sheet it can't share",
      { tool: "hundred-dollar-test", sheet: { ...ALLOCATION_SHEET, budget: 5 } },
    ],
    ["a scale tool given a sheet", { tool: "health-check", sheet: ALLOCATION_SHEET }],
    ["Kano given an allocation sheet", { tool: "kano-model", sheet: ALLOCATION_SHEET }],
    ["Kano given nothing", { tool: "kano-model" }],
  ])("opens nothing for %s", async (_label, over) => {
    const { result } = renderHook(() =>
      useVoteRoom({
        role: "host",
        tool: "hundred-dollar-test",
        code: CODE,
        identity: ident(HOST),
        crypto: fakeVoteCrypto(),
        ...over,
      } as UseVoteRoomHostOptions)
    );
    await flush();
    expect(result.current.status).toBe("unavailable");
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });
});

describe("useVoteRoom: an allocation round, host side", () => {
  const people = [HOST, A, B, C, D, E];
  const SPLITS = [
    [40, 30, 20, 10],
    [100, 0, 0, 0],
    [25, 25, 25, 25],
    [0, 50, 50, 0],
    [10, 20, 30, 40],
  ];

  it("shares a signed v2 state with the sheet and no totals before Reveal", async () => {
    const { ch, crypto, result } = await startHost(
      { tool: "hundred-dollar-test", sheet: ALLOCATION_SHEET },
      people
    );
    expect(result.current.status).toBe("live");
    expect(result.current.kind).toBe("allocation");
    expect(result.current.sheet).toEqual(ALLOCATION_SHEET);
    expect(result.current.questionnaire).toBeNull();
    expect(ch.name).toBe(`visitor:hundred-dollar-test:${CODE}`);
    const s = lastState(ch);
    expect(s).toMatchObject({
      v: 2,
      kind: "allocation",
      tool: "hundred-dollar-test",
      revealed: null,
    });
    const { sig, ...body } = s;
    expect(
      await crypto.verify(s.keys.sig, signingInput(VOTE_ROOM_EVENTS.state, body as never), sig)
    ).toBe(true);
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, A.id, allocationString(SPLITS[0], 3))
    );
    await tick(VOTE_LIMITS.stateThrottleMs);
    const after = lastState(ch);
    expect(after.ballots).toBe(1);
    expect(JSON.stringify(after)).not.toMatch(/total|bands|backers/);
    expect(result.current.allocationRevealed).toBeNull();
    expect(JSON.stringify(result.current)).not.toMatch(/"totals"|"bands"/);
  });

  it("counts only ballots of the round's one size, then reveals totals at 3 with the spread withheld", async () => {
    const { ch, crypto, result } = await startHost(
      { tool: "hundred-dollar-test", sheet: ALLOCATION_SHEET },
      people
    );
    const s = lastState(ch);
    const ok = await ballotFor(crypto, s, A.id, allocationString(SPLITS[0], 3));
    expect(ok.ct).toHaveLength(allocationCiphertextChars(ALLOCATION_SHEET));
    // The wrong size never reaches decryption.
    const opens = crypto.calls.open;
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, { ...ok, ct: `${ok.ct}AAAA` });
    expect(crypto.calls.open).toBe(opens);
    // The right size with a split that breaks the sheet's rules is dropped after opening.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, allocationString([50, 0, 0, 0], 3))
    );
    expect(result.current.ballots).toBe(0);
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, ok);
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, allocationString(SPLITS[1], 3))
    );
    expect(result.current.canReveal).toBe(false);
    expect(result.current.revealBlockedReason).toBe("2 of 3 answers. Results show from 3.");
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, C.id, allocationString(SPLITS[2], 3))
    );
    expect(result.current.ballots).toBe(3);
    act(() => result.current.reveal());
    await flush();
    expect(result.current.phase).toBe("revealed");
    expect(result.current.allocationRevealed).toEqual([
      { total: 165, backers: null, bands: null },
      { total: 55, backers: null, bands: null },
      { total: 45, backers: null, bands: null },
      { total: 35, backers: null, bands: null },
    ]);
    expect(result.current.result).toBeNull();
    expect(result.current.allocationResult).toMatchObject({
      kind: "allocation",
      ballots: 3,
      source: "live",
      tool: "hundred-dollar-test",
    });
    const revealedState = lastState(ch);
    expect(revealedState).toMatchObject({ phase: "revealed", acks: [], ballots: 3 });
    expect(revealedState.revealed).toEqual(result.current.allocationRevealed);
  });

  it("shows who backed each item and the bands from 5, the host's own split counted the same way", async () => {
    const { ch, crypto, result } = await startHost(
      { tool: "hundred-dollar-test", sheet: ALLOCATION_SHEET },
      people
    );
    const s = lastState(ch);
    // The host's own split goes through the same encoding and fold.
    let res = "";
    await act(async () => {
      res = await result.current.submit({ search: 50 });
    });
    expect(res).toBe("incomplete");
    await act(async () => {
      res = await result.current.submit({ search: 40, export: 30, sso: 20, themes: 10 });
    });
    expect(res).toBe("sent");
    expect(result.current.answered).toBe(true);
    for (const [m, split] of [
      [A, SPLITS[1]],
      [B, SPLITS[2]],
      [C, SPLITS[3]],
      [D, SPLITS[4]],
    ] as const) {
      await deliver(
        ch,
        VOTE_ROOM_EVENTS.ballot,
        await ballotFor(crypto, s, m.id, allocationString([...split], 3))
      );
    }
    expect(result.current.ballots).toBe(5);
    act(() => result.current.reveal());
    await flush();
    expect(result.current.allocationRevealed).toEqual([
      { total: 175, backers: 4, bands: [1, 1, 1, 1, 1] },
      { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
      { total: 125, backers: 4, bands: [1, 0, 2, 2, 0] },
      { total: 75, backers: 3, bands: [2, 1, 1, 1, 0] },
    ]);
    expect(result.current.allocationResult?.items[0].bands).toEqual([1, 1, 1, 1, 1]);
  });

  it("starts a new round with a fresh key, refusing a change of kind", async () => {
    const { ch, result } = await startHost({ tool: "buy-a-feature", sheet: BUY_SHEET }, people);
    const first = lastState(ch);
    act(() => result.current.newRound(QUESTIONNAIRE));
    await flush();
    expect(toastMock.error).toHaveBeenCalledWith(
      "This round can't be shared live. This tool runs another kind of round."
    );
    expect(result.current.roundId).toBe(first.roundId);
    const next = { ...BUY_SHEET, id: "buy:round-2", budget: 30, items: BUY_SHEET.items.slice(1) };
    act(() => result.current.newRound(next));
    await flush();
    await tick(VOTE_LIMITS.stateThrottleMs);
    const s = lastState(ch);
    expect(s.roundId).not.toBe(first.roundId);
    expect(s.keys.ecdh).not.toBe(first.keys.ecdh);
    expect(s.sheet).toEqual(next);
    expect(result.current.sheet).toEqual(next);
  });
});

describe("useVoteRoom: an allocation round, participant side", () => {
  let crypto: FakeVoteCrypto;
  let keys: HostKeyPair;

  beforeEach(async () => {
    crypto = fakeVoteCrypto();
    keys = await crypto.createHostKeys();
  });

  async function joined(tool: "hundred-dollar-test" | "buy-a-feature" = "hundred-dollar-test") {
    const opts: UseVoteRoomParticipantOptions = {
      role: "participant",
      tool,
      code: CODE,
      identity: ident(A),
      hostFingerprint: keys.fingerprint,
      crypto,
    };
    const view = renderHook(() => useVoteRoom(opts));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, A, B, C]);
    });
    await flush();
    return { ...view, ch };
  }

  it("reads only its tool's kind of state", async () => {
    const { result, ch } = await joined();
    // A scale state for this tool, a pair state, and another allocation tool's state: all ignored.
    await deliver(ch, VOTE_ROOM_EVENTS.state, {
      ...(await signedState(crypto, HOST.id, keys)),
      tool: "hundred-dollar-test",
    });
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, pairStateBody(HOST.id, keys))
    );
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(
        crypto,
        keys,
        allocationStateBody(HOST.id, keys, { tool: "buy-a-feature", sheet: BUY_SHEET })
      )
    );
    expect(result.current.status).toBe("waiting");
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, allocationStateBody(HOST.id, keys))
    );
    expect(result.current.status).toBe("live");
    expect(result.current.kind).toBe("allocation");
    expect(result.current.sheet).toEqual(ALLOCATION_SHEET);
  });

  it("seals a split to the round's one size, refuses a bad one, and shows the revealed totals", async () => {
    const { result, ch } = await joined();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, allocationStateBody(HOST.id, keys))
    );
    let res = "";
    await act(async () => {
      res = await result.current.submit({ search: 60 });
    });
    expect(res).toBe("incomplete");
    expect(ch.sent(VOTE_ROOM_EVENTS.ballot)).toHaveLength(0);
    await act(async () => {
      res = await result.current.submit({ search: 60, export: 40 });
    });
    expect(res).toBe("sent");
    const [ballot] = ch.sent(VOTE_ROOM_EVENTS.ballot) as { ct: string; bid: string }[];
    expect(ballot.ct).toHaveLength(allocationCiphertextChars(ALLOCATION_SHEET));
    expect(JSON.stringify(ballot)).not.toContain("060040000000");
    const revealed = [
      { total: 160, backers: null, bands: null },
      { total: 70, backers: null, bands: null },
      { total: 50, backers: null, bands: null },
      { total: 20, backers: null, bands: null },
    ];
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(
        crypto,
        keys,
        allocationStateBody(HOST.id, keys, { seq: 2, phase: "revealed", ballots: 3, revealed })
      )
    );
    expect(result.current.phase).toBe("revealed");
    expect(result.current.allocationRevealed).toEqual(revealed);
    expect(result.current.allocationResult).toMatchObject({ kind: "allocation", ballots: 3 });
    expect(result.current.result).toBeNull();
  });

  it("ignores a revealed state that shows the spread from fewer than 5", async () => {
    const { result, ch } = await joined();
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, allocationStateBody(HOST.id, keys))
    );
    const sneaky = allocationStateBody(HOST.id, keys, {
      seq: 2,
      phase: "revealed",
      ballots: 3,
      revealed: [
        { total: 300, backers: 3, bands: [0, 0, 0, 0, 3] },
        { total: 0, backers: 0, bands: [3, 0, 0, 0, 0] },
        { total: 0, backers: 0, bands: [3, 0, 0, 0, 0] },
        { total: 0, backers: 0, bands: [3, 0, 0, 0, 0] },
      ],
    });
    await deliver(ch, VOTE_ROOM_EVENTS.state, await signedKindState(crypto, keys, sneaky));
    expect(result.current.phase).toBe("open");
    expect(result.current.allocationRevealed).toBeNull();
  });
});

describe("useVoteRoom: a pair (Kano) round", () => {
  const both = (f: number, s: number, f2: number, s2: number) => ({
    [pairDraftKey("dark", "first")]: f,
    [pairDraftKey("dark", "second")]: s,
    [pairDraftKey("export", "first")]: f2,
    [pairDraftKey("export", "second")]: s2,
    [pairDraftKey("emoji", "first")]: null,
    [pairDraftKey("emoji", "second")]: null,
  });

  it("host: v2 pair states, one-size ballots, and per-item joints from 3 answers", async () => {
    const { ch, crypto, result } = await startHost({ tool: "kano-model", pairSheet: PAIR_SHEET }, [
      HOST,
      A,
      B,
      C,
    ]);
    expect(result.current.kind).toBe("pair");
    expect(result.current.pairSheet).toEqual(PAIR_SHEET);
    const s = lastState(ch);
    expect(s).toMatchObject({ v: 2, kind: "pair", tool: "kano-model", revealed: null });
    const a = await ballotFor(crypto, s, A.id, pairString([4, 6, 0]));
    expect(a.ct).toHaveLength(ballotCiphertextChars(PAIR_SHEET.items.length));
    await deliver(ch, VOTE_ROOM_EVENTS.ballot, a);
    // A skipped required item is dropped.
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, pairString([-1, 6, 0]))
    );
    expect(result.current.ballots).toBe(1);
    await deliver(
      ch,
      VOTE_ROOM_EVENTS.ballot,
      await ballotFor(crypto, s, B.id, pairString([4, 7, -1]))
    );
    let res = "";
    await act(async () => {
      res = await result.current.submit(both(4, 0, 1, 1));
    });
    expect(res).toBe("sent");
    await tick(VOTE_LIMITS.stateThrottleMs);
    expect(JSON.stringify(lastState(ch))).not.toMatch(/joint|responses/);
    act(() => result.current.reveal());
    await flush();
    const rows = result.current.pairRevealed!;
    expect(rows[0].responses).toBe(3);
    expect(rows[0].joint![4]).toBe(2);
    expect(rows[0].joint![20]).toBe(1);
    expect(rows[2]).toEqual({ responses: 1, joint: null });
    expect(result.current.pairResult).toMatchObject({
      kind: "pair",
      tool: "kano-model",
      ballots: 3,
    });
    expect(result.current.result).toBeNull();
    expect(result.current.allocationResult).toBeNull();
  });

  it("participant: reads the pair state, sends both answers per item, and reads the reveal", async () => {
    const crypto = fakeVoteCrypto();
    const keys = await crypto.createHostKeys();
    const view = renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool: "kano-model",
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
      await signedKindState(crypto, keys, pairStateBody(HOST.id, keys))
    );
    expect(view.result.current.status).toBe("live");
    expect(view.result.current.pairSheet).toEqual(PAIR_SHEET);
    let res = "";
    await act(async () => {
      res = await view.result.current.submit({
        ...both(0, 4, 1, 1),
        [pairDraftKey("export", "second")]: null,
      });
    });
    expect(res).toBe("incomplete");
    await act(async () => {
      res = await view.result.current.submit(both(0, 4, 1, 1));
    });
    expect(res).toBe("sent");
    const [ballot] = ch.sent(VOTE_ROOM_EVENTS.ballot) as { ct: string }[];
    expect(ballot.ct).toHaveLength(ballotCiphertextChars(3));
    const joint = new Array<number>(25).fill(0);
    joint[4] = 3;
    const revealed = [
      { responses: 3, joint },
      { responses: 3, joint },
      { responses: 0, joint: null },
    ];
    const state: PairStateMessage = await signedKindState(
      crypto,
      keys,
      pairStateBody(HOST.id, keys, { seq: 2, phase: "revealed", ballots: 3, revealed })
    );
    await deliver(ch, VOTE_ROOM_EVENTS.state, state);
    expect(view.result.current.pairRevealed).toEqual(revealed);
    expect(view.result.current.pairResult?.items[0].joint).toEqual(joint);
    expect(view.result.current.revealed).toBeNull();
  });
});

describe("useVoteRoom: allocation states of an older or foreign build", () => {
  it("are never read as a scale tool's states, nor scale states as an allocation tool's", async () => {
    const crypto = fakeVoteCrypto();
    const keys = await crypto.createHostKeys();
    const view = renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool: "health-check",
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
    const alloc: AllocationStateMessage = await signedKindState(
      crypto,
      keys,
      allocationStateBody(HOST.id, keys, { roundId: ROUND })
    );
    await deliver(ch, VOTE_ROOM_EVENTS.state, { ...alloc, tool: "health-check" });
    expect(view.result.current.status).toBe("waiting");
    await deliver(ch, VOTE_ROOM_EVENTS.state, await signedState(crypto, HOST.id, keys));
    expect(view.result.current.status).toBe("live");
    expect(view.result.current.kind).toBe("scale");
    expect(view.result.current.sheet).toBeNull();
  });
});
