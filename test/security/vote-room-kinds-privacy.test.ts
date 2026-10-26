import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor, type RenderHookResult } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { createWebVoteCrypto, fromBase64Url } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS, type VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import { allocationCiphertextChars } from "@/lib/realtime/vote-room/allocation";
import { pairCiphertextChars, pairDraftKey } from "@/lib/realtime/vote-room/pair";
import type { RoundDraft } from "@/lib/realtime/vote-room/kinds";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { ALLOCATION_SHEET, CODE, PAIR_SHEET } from "../realtime/vote-room-fixtures";

/**
 * Whole pair (Kano) and allocation ($100 Test) rounds, host and every
 * participant on real WebCrypto, over a fake Realtime bus that records
 * every message. What must never cross the wire or be kept: anyone's
 * answers or split in the clear, any total, joint or band before Reveal,
 * who answered after it, and, under 5 answers, the spread of a split.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useVoteRoom, type VoteRoom } from "@/lib/realtime/vote-room/use-vote-room";

const crypto = createWebVoteCrypto(webcrypto.subtle as unknown as SubtleCrypto, (n) =>
  webcrypto.getRandomValues(new Uint8Array(n))
);

// Names with a space: they can't turn up by chance inside base64url keys or ids.
const HOST: FakeMember = {
  id: "host_00000000000",
  name: "Hana Ito",
  joinedAt: "2026-10-26T09:00:00Z",
};
const PEOPLE: FakeMember[] = [
  { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-10-26T09:01:00Z" },
  { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-10-26T09:02:00Z" },
  { id: "carol_0000000000", name: "Cy Ray", joinedAt: "2026-10-26T09:03:00Z" },
  { id: "dave0_0000000000", name: "Dee Fox", joinedAt: "2026-10-26T09:04:00Z" },
  { id: "erin0_0000000000", name: "Eve Kim", joinedAt: "2026-10-26T09:05:00Z" },
];

interface Sent {
  from: string;
  event: string;
  payload: unknown;
}

function wire(channels: FakeChannel[], owners: string[], log: Sent[]) {
  channels.forEach((ch, i) => {
    ch.send.mockImplementation(async (m) => {
      log.push({ from: owners[i], event: m.event, payload: JSON.parse(JSON.stringify(m.payload)) });
      for (const other of channels) if (other !== ch) other.deliver(m.event, m.payload);
      return "ok";
    });
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A host and `n` participants in one room, all live. */
async function room(
  tool: VoteRoomTool,
  round: { pairSheet?: typeof PAIR_SHEET; sheet?: typeof ALLOCATION_SHEET },
  n: number,
  log: Sent[]
) {
  const host = renderHook(() =>
    useVoteRoom({
      role: "host",
      tool,
      code: CODE,
      identity: { id: HOST.id, name: HOST.name },
      ...round,
      minN: 3,
      crypto,
    })
  );
  await waitFor(() => expect(host.result.current.joinPath).not.toBeNull());
  const fp = host.result.current.joinPath!.split("#k=")[1];
  const members = PEOPLE.slice(0, n);
  const people = members.map((m) =>
    renderHook(() =>
      useVoteRoom({
        role: "participant",
        tool,
        code: CODE,
        identity: { id: m.id, name: m.name },
        hostFingerprint: fp,
        crypto,
      })
    )
  );
  const channels = [...fakeRealtime.channels];
  wire(channels, [HOST.id, ...members.map((m) => m.id)], log);
  act(() => {
    for (const ch of channels) {
      ch.connect();
      ch.setPresence([HOST, ...members]);
    }
  });
  for (const p of people) {
    await waitFor(() => expect(p.result.current.status).toBe("live"), { timeout: 4000 });
  }
  return { host, people };
}

async function answerAll(
  people: RenderHookResult<VoteRoom, unknown>[],
  drafts: RoundDraft[]
): Promise<void> {
  for (let i = 0; i < people.length; i++) {
    let res = "";
    await act(async () => {
      res = await people[i].result.current.submit(drafts[i]);
    });
    expect(res).toBe("sent");
    window.sessionStorage.clear();
  }
}

/** Whether `bytes` holds `text` in the clear anywhere. */
function containsPlain(ct: string, text: string): boolean {
  const bytes = Array.from(fromBase64Url(ct) ?? []);
  const plain = Array.from(new TextEncoder().encode(text));
  return bytes.some((_, i) => plain.every((p, j) => bytes[i + j] === p));
}

describe("an allocation round's privacy", () => {
  const SPLITS: RoundDraft[] = [
    { search: 40, export: 30, sso: 20, themes: 10 },
    { search: 100 },
    { search: 25, export: 25, sso: 25, themes: 25 },
    { export: 50, sso: 50 },
    { search: 10, export: 20, sso: 30, themes: 40 },
  ];
  const PLAINS = ["040030020010", "100000000000", "025025025025", "000050050000", "010020030040"];

  it("sends only same-size sealed splits, no totals before Reveal, and no spread under 5", async () => {
    const log: Sent[] = [];
    const { host, people } = await room("hundred-dollar-test", { sheet: ALLOCATION_SHEET }, 3, log);
    await answerAll(people, SPLITS.slice(0, 3));
    await waitFor(() => expect(host.result.current.ballots).toBe(3), { timeout: 4000 });

    const states = log.filter((s) => s.event === VOTE_ROOM_EVENTS.state);
    for (const s of states) {
      expect(s.from).toBe(HOST.id);
      expect((s.payload as { revealed: unknown }).revealed).toBeNull();
      expect(JSON.stringify(s.payload)).not.toMatch(/total|bands|backers/);
    }
    const ballots = log.filter((s) => s.event === VOTE_ROOM_EVENTS.ballot);
    for (const b of ballots) {
      const ct = (b.payload as { ct: string }).ct;
      expect(ct).toHaveLength(allocationCiphertextChars(ALLOCATION_SHEET));
      for (const p of PLAINS) expect(containsPlain(ct, p)).toBe(false);
    }
    expect(
      log.filter((s) => s.from !== HOST.id).every((s) => s.event === VOTE_ROOM_EVENTS.ballot)
    ).toBe(true);

    act(() => host.result.current.reveal());
    for (const p of people) {
      await waitFor(() => expect(p.result.current.phase).toBe("revealed"), { timeout: 4000 });
    }
    // Three answers: totals only, every band and backer withheld, for everyone.
    for (const r of [host, ...people]) {
      expect(r.result.current.allocationRevealed!.map((x) => x.total)).toEqual([165, 55, 45, 35]);
      expect(
        r.result.current.allocationRevealed!.every((x) => x.bands === null && x.backers === null)
      ).toBe(true);
    }
    const saved = JSON.stringify(host.result.current.allocationResult);
    for (const m of [HOST, ...PEOPLE]) {
      expect(saved).not.toContain(m.id);
      expect(saved).not.toContain(m.name);
    }
    expect(saved).not.toMatch(/acks|voted|bid/);
  });

  it("shows who backed each item and the bands only once 5 have answered", async () => {
    const log: Sent[] = [];
    const { host, people } = await room("hundred-dollar-test", { sheet: ALLOCATION_SHEET }, 5, log);
    await answerAll(people, SPLITS);
    await waitFor(() => expect(host.result.current.ballots).toBe(5), { timeout: 4000 });
    act(() => host.result.current.reveal());
    for (const p of people) {
      await waitFor(() => expect(p.result.current.phase).toBe("revealed"), { timeout: 4000 });
    }
    const last = log.filter((s) => s.event === VOTE_ROOM_EVENTS.state).at(-1)!.payload as {
      revealed: { total: number; backers: number; bands: number[] }[];
      acks: string[];
    };
    expect(last.acks).toEqual([]);
    expect(last.revealed[0]).toEqual({ total: 175, backers: 4, bands: [1, 1, 1, 1, 1] });
    const json = JSON.stringify(last);
    for (const m of PEOPLE) {
      expect(json).not.toContain(m.id);
      expect(json).not.toContain(m.name);
    }
    // No exact spread rides along: nothing but totals, backers and bands per item.
    for (const r of last.revealed)
      expect(Object.keys(r).sort()).toEqual(["backers", "bands", "total"]);
  });
});

describe("a pair (Kano) round's privacy", () => {
  const pairDraft = (dark: [number, number], exp: [number, number]) => ({
    [pairDraftKey("dark", "first")]: dark[0],
    [pairDraftKey("dark", "second")]: dark[1],
    [pairDraftKey("export", "first")]: exp[0],
    [pairDraftKey("export", "second")]: exp[1],
    [pairDraftKey("emoji", "first")]: null,
    [pairDraftKey("emoji", "second")]: null,
  });

  it("sends one sealed character per feature and keeps only each feature's joint", async () => {
    const log: Sent[] = [];
    const { host, people } = await room("kano-model", { pairSheet: PAIR_SHEET }, 3, log);
    await answerAll(people, [
      pairDraft([0, 4], [1, 1]),
      pairDraft([0, 4], [2, 2]),
      pairDraft([4, 0], [1, 1]),
    ]);
    await waitFor(() => expect(host.result.current.ballots).toBe(3), { timeout: 4000 });
    for (const s of log.filter((x) => x.event === VOTE_ROOM_EVENTS.state)) {
      expect(JSON.stringify(s.payload)).not.toMatch(/joint|responses/);
    }
    for (const b of log.filter((x) => x.event === VOTE_ROOM_EVENTS.ballot)) {
      expect((b.payload as { ct: string }).ct).toHaveLength(pairCiphertextChars(PAIR_SHEET));
    }
    act(() => host.result.current.reveal());
    for (const p of people) {
      await waitFor(() => expect(p.result.current.phase).toBe("revealed"), { timeout: 4000 });
    }
    const rows = people[0].result.current.pairRevealed!;
    expect(rows[0].joint![4]).toBe(2); // like / dislike
    expect(rows[0].joint![20]).toBe(1); // dislike / like
    expect(rows[1].joint![6]).toBe(2);
    expect(rows[1].joint![12]).toBe(1);
    // The skipped optional feature has no answers to show.
    expect(rows[2]).toEqual({ responses: 0, joint: null });
    // The saved result: joint totals per feature, nobody's id or name, nothing linking features.
    const saved = host.result.current.pairResult!;
    expect(Object.keys(saved.items[0]).sort()).toEqual(["id", "joint", "responses", "text"]);
    const json = JSON.stringify(saved);
    for (const m of [HOST, ...PEOPLE]) {
      expect(json).not.toContain(m.id);
      expect(json).not.toContain(m.name);
    }
  });
});
