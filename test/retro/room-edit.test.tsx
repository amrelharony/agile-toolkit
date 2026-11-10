import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import { HOST_MIGRATION_DELAY_MS } from "@/lib/realtime/host-election";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import type { RoomSnapshot } from "@/app/(tools)/retro/room/protocol";
import { toRoomSnapshot } from "@/app/(tools)/retro/room/snapshot";
import { fakeRealtime, type FakeMember } from "./fake-realtime";

/**
 * Editing a card in a Retro visitor room. The starting host edits through
 * its own Board; a member promoted to host edits its in-memory board, and
 * the next snapshot carries the change (no new message). A participant's
 * edit does nothing and sends nothing; it may only delete its own card.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("./fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useRetroRoom } from "@/app/(tools)/retro/room/use-retro-room";

const CODE = "ABCDEFGHJKMN";
const NOW = Date.parse("2026-10-19T10:00:00.000Z");
const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-19T09:00:00Z" };
const ME: FakeMember = { id: "self_00000000000", name: "Pat", joinedAt: "2026-10-19T09:01:00Z" };
const OTHER: FakeMember = { id: "other_0000000000", name: "Olu", joinedAt: "2026-10-19T09:02:00Z" };

function card(id: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey: "start",
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

const board: BoardState = {
  format: retroFormats[0],
  phase: "write",
  cards: [card("c1"), card("c2", { columnKey: "stop" })],
  userVotes: 0,
  timerSeconds: 300,
  timerRunning: false,
  discussingIndex: 0,
};

function snap(by: string): RoomSnapshot {
  return JSON.parse(
    JSON.stringify(
      toRoomSnapshot(board, {
        by,
        seq: 7,
        endsAt: NOW + VISITOR_LIMITS.hardTtlMs,
        members: [HOST, ME, OTHER].map(({ id, name }) => ({ id, name })),
        votesUsed: {},
        timer: { running: false, remaining: 300 },
        now: Date.now(),
        hideWhileWriting: false,
        votesPerPerson: 3,
      })
    )
  ) as RoomSnapshot;
}

function joinedParticipant() {
  const view = renderHook(() =>
    useRetroRoom({ code: CODE, identity: { id: ME.id, name: ME.name }, role: "participant" })
  );
  const ch = fakeRealtime.last();
  act(() => {
    ch.connect();
    ch.setPresence([HOST, ME, OTHER]);
  });
  act(() => ch.deliver("retro:state", snap(HOST.id)));
  return { ...view, ch };
}

const sentStates = (ch: ReturnType<typeof fakeRealtime.last>) =>
  ch.sent("retro:state") as RoomSnapshot[];

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  useWorkspaceStore.setState({ retroBoards: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useRetroRoom: editing a card", () => {
  it("a participant can't edit: nothing changes and nothing is sent", () => {
    const { result, ch } = joinedParticipant();
    let ok = true;
    act(() => {
      ok = result.current.editCard("c1", "Sneaky edit");
    });
    expect(ok).toBe(false);
    expect(result.current.board?.cards[0].text).toBe("Card c1");
    expect(ch.sent("retro:intent")).toEqual([]);
    expect(sentStates(ch)).toEqual([]);
  });

  it("a participant can't edit even its own card, but may delete it in Write", () => {
    const { result, ch } = joinedParticipant();
    act(() => {
      result.current.addCard("start", "Typo here");
    });
    const [added] = ch.sent("retro:intent") as { intent: { iid: string } }[];
    const id = added.intent.iid;
    let ok = true;
    act(() => {
      ok = result.current.editCard(id, "Fixed");
    });
    expect(ok).toBe(false);
    expect(ch.sent("retro:intent")).toHaveLength(1);
    act(() => {
      ok = result.current.deleteCard(id);
    });
    expect(ok).toBe(true);
    expect(ch.sent("retro:intent").at(-1)).toMatchObject({
      intent: { t: "card:delete", cardId: id },
    });
    expect(sentStates(ch)).toEqual([]);
  });

  it("a promoted host edits its in-memory board and the next snapshot carries it", () => {
    const { result, ch } = joinedParticipant();
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.promoted).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    const before = sentStates(ch).length;

    let ok = false;
    act(() => {
      ok = result.current.editCard("c1", "  Fixed\ntypo ");
    });
    expect(ok).toBe(true);
    expect(result.current.board?.cards.map((c) => c.text)).toEqual(["Fixed typo", "Card c2"]);

    act(() => vi.advanceTimersByTime(600));
    const latest = sentStates(ch).at(-1)!;
    expect(sentStates(ch).length).toBeGreaterThan(before);
    expect(latest.cards.map((c) => c.text)).toEqual(["Fixed typo", "Card c2"]);
    // Still nothing in the workspace.
    expect(useWorkspaceStore.getState().retroBoards).toEqual([]);
  });

  it("refuses empty text, hidden characters and a card that has gone", () => {
    const { result, ch } = joinedParticipant();
    act(() => ch.setPresence([ME, OTHER]));
    act(() => vi.advanceTimersByTime(HOST_MIGRATION_DELAY_MS));
    expect(result.current.isHost).toBe(true);
    const results: boolean[] = [];
    act(() => {
      results.push(result.current.editCard("c1", "   "));
      results.push(result.current.editCard("c1", "bad‮text"));
      results.push(result.current.editCard("nope", "Fine"));
    });
    expect(results).toEqual([false, false, false]);
    expect(result.current.board?.cards[0].text).toBe("Card c1");
  });
});
