import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { createWebVoteCrypto, fromBase64Url } from "@/lib/realtime/vote-room/crypto";
import {
  VOTE_ROOM_EVENTS,
  ballotCiphertextChars,
  type VoteStateMessage,
} from "@/lib/realtime/vote-room/protocol";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { CODE, QUESTIONNAIRE } from "../realtime/vote-room-fixtures";

/**
 * A whole vote round, host and three participants, on real WebCrypto and a
 * fake Realtime bus that records every message anyone sends. What must
 * never cross the wire or be kept: answers in the clear, distributions or
 * per-question counts before Reveal, who-answered after it.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useVoteRoom } from "@/lib/realtime/vote-room/use-vote-room";

const crypto = createWebVoteCrypto(webcrypto.subtle as unknown as SubtleCrypto, (n) =>
  webcrypto.getRandomValues(new Uint8Array(n))
);

// Names with a space: they can't turn up by chance inside base64url keys,
// signatures or nanoid ids, so "not.toContain(name)" can't flake.
const HOST: FakeMember = {
  id: "host_00000000000",
  name: "Hana Ito",
  joinedAt: "2026-10-26T09:00:00Z",
};
const PEOPLE: FakeMember[] = [
  { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-10-26T09:01:00Z" },
  { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-10-26T09:02:00Z" },
  { id: "carol_0000000000", name: "Cy Ray", joinedAt: "2026-10-26T09:03:00Z" },
];
// Each person's answers (point values): Green 2 / Yellow 1 / Red 0; learning optional.
const DRAFTS = [
  { fun: 2, speed: 0, learning: 1 },
  { fun: 1, speed: 0, learning: null },
  { fun: 2, speed: 1, learning: null },
];
const ANSWER_STRINGS = ["021", "12-", "01-"];

interface Sent {
  from: string;
  event: string;
  payload: unknown;
}

/** Every channel delivers what it sends to every other channel, and logs it. */
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

describe("a vote round's privacy", () => {
  it("never sends or keeps an answer, a distribution before Reveal, or who answered after it", async () => {
    const log: Sent[] = [];
    const host = renderHook(() =>
      useVoteRoom({
        role: "host",
        tool: "health-check",
        code: CODE,
        identity: { id: HOST.id, name: HOST.name },
        questionnaire: QUESTIONNAIRE,
        minN: 3,
        crypto,
      })
    );
    await waitFor(() => expect(host.result.current.joinPath).not.toBeNull());
    const fp = host.result.current.joinPath!.split("#k=")[1];
    const people = PEOPLE.map((m) =>
      renderHook(() =>
        useVoteRoom({
          role: "participant",
          tool: "health-check",
          code: CODE,
          identity: { id: m.id, name: m.name },
          hostFingerprint: fp,
          crypto,
        })
      )
    );
    const channels = [...fakeRealtime.channels];
    expect(channels.map((c) => c.name)).toEqual(Array(4).fill(`visitor:health-check:${CODE}`));
    wire(channels, [HOST.id, ...PEOPLE.map((m) => m.id)], log);
    act(() => {
      for (const ch of channels) {
        ch.connect();
        ch.setPresence([HOST, ...PEOPLE]);
      }
    });

    for (const p of people) {
      await waitFor(() => expect(p.result.current.status).toBe("live"), { timeout: 4000 });
    }
    // sessionStorage is per tab in a browser; here the "tabs" share one, so
    // keep what each wrote and clear it before the next one answers.
    const storage: string[] = [];
    for (let i = 0; i < people.length; i++) {
      let res = "";
      await act(async () => {
        res = await people[i].result.current.submit(DRAFTS[i]);
      });
      expect(res).toBe("sent");
      for (const k of Object.keys(window.sessionStorage)) {
        storage.push(`${k}=${window.sessionStorage.getItem(k)}`);
      }
      window.sessionStorage.clear();
    }
    await waitFor(() => expect(host.result.current.ballots).toBe(3), { timeout: 4000 });
    for (const p of people) {
      await waitFor(() => expect(p.result.current.answered).toBe(true), { timeout: 4000 });
    }

    // ── Before Reveal ──
    const before = log.length;
    const statesBefore = log.filter((s) => s.event === VOTE_ROOM_EVENTS.state);
    expect(statesBefore.length).toBeGreaterThan(0);
    for (const s of statesBefore) {
      const st = s.payload as VoteStateMessage;
      expect(s.from).toBe(HOST.id);
      expect(st.revealed).toBeNull();
      expect(JSON.stringify(st)).not.toMatch(/distribution|responses|counts/);
    }
    // Ballots: ciphertext only, from their sender, never the answers. One per
    // person; a resend (if an ack was slow) is the same ballot, byte for byte.
    const ballots = log.filter((s) => s.event === VOTE_ROOM_EVENTS.ballot);
    const byBid = new Map<string, string>();
    for (const b of ballots) {
      const { bid } = b.payload as { bid: string };
      const json = JSON.stringify(b.payload);
      expect(byBid.get(bid) ?? json).toBe(json);
      byBid.set(bid, json);
    }
    expect(byBid.size).toBe(3);
    expect(new Set(ballots.map((b) => b.from)).size).toBe(3);
    for (const b of ballots) {
      expect(Object.keys(b.payload as object).sort()).toEqual([
        "bid",
        "by",
        "ct",
        "epk",
        "iv",
        "roundId",
        "v",
      ]);
      // Every ballot is the same size, and its bytes don't hold an answer string in the clear.
      const ct = (b.payload as { ct: string }).ct;
      expect(ct).toHaveLength(ballotCiphertextChars(QUESTIONNAIRE.questions.length));
      const bytes = Array.from(fromBase64Url(ct) ?? []);
      for (const a of ANSWER_STRINGS) {
        const plain = Array.from(new TextEncoder().encode(a));
        const found = bytes.some((_, i) => plain.every((p, j) => bytes[i + j] === p));
        expect(found).toBe(false);
      }
    }
    // Participants send nothing but ballots.
    expect(
      log.filter((s) => s.from !== HOST.id).every((s) => s.event === VOTE_ROOM_EVENTS.ballot)
    ).toBe(true);
    // Nobody's hook shows counts before Reveal.
    for (const r of [host, ...people]) {
      expect(r.result.current.revealed).toBeNull();
      expect(JSON.stringify(r.result.current)).not.toMatch(/distribution|counts/);
    }

    // ── Reveal ──
    act(() => host.result.current.reveal());
    for (const p of people) {
      await waitFor(() => expect(p.result.current.phase).toBe("revealed"), { timeout: 4000 });
    }
    const after = log.slice(before).filter((s) => s.event === VOTE_ROOM_EVENTS.state);
    expect(after.length).toBeGreaterThan(0);
    for (const s of after) {
      const st = s.payload as VoteStateMessage;
      expect(st.acks).toEqual([]);
      const json = JSON.stringify(st);
      // The host's own id signs the state; nobody else's id appears.
      for (const m of PEOPLE) {
        expect(json).not.toContain(m.id);
        expect(json).not.toContain(m.name);
      }
    }
    expect((after.at(-1)!.payload as VoteStateMessage).revealed).toEqual([
      { responses: 3, distribution: [2, 1, 0] },
      { responses: 3, distribution: [0, 1, 2] },
      { responses: 1, distribution: null },
    ]);

    // ── What anyone could keep ──
    const saved = host.result.current.result;
    expect(saved).not.toBeNull();
    const savedJson = JSON.stringify(saved);
    for (const m of [HOST, ...PEOPLE]) {
      expect(savedJson).not.toContain(m.id);
      expect(savedJson).not.toContain(m.name);
    }
    expect(savedJson).not.toMatch(/acks|voted|ballotId|bid/);
    // Each tab kept ids only: the round's and its own ballot's, nothing else.
    // Checked field by field (random ids could contain "021" or "Red" by chance).
    expect(storage).toHaveLength(people.length);
    const roundId = (after.at(-1)!.payload as VoteStateMessage).roundId;
    for (const entry of storage) {
      const [key, value] = [
        entry.slice(0, entry.indexOf("=")),
        entry.slice(entry.indexOf("=") + 1),
      ];
      expect(key).toBe(`agile-toolkit:vote-room:answered:${CODE}`);
      const rounds = JSON.parse(value) as unknown[];
      expect(rounds).toHaveLength(1);
      const [rec] = rounds as Record<string, unknown>[];
      expect(Object.keys(rec).sort()).toEqual(["b", "c", "r"]);
      expect(rec.r).toBe(roundId);
      expect(typeof rec.c).toBe("boolean");
      expect(rec.b).toHaveLength(1);
      expect(byBid.has((rec.b as string[])[0])).toBe(true);
    }
  });
});
