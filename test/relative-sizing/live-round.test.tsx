import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ballotAad, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS, type VoteStateMessage } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { answerString, fakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * Relative Sizing's live round on the vote kit: a scale round named for
 * the tool, the anchor in its title, every phone placing the stories
 * privately (skips allowed), Reveal showing where the room put each story,
 * the withheld line from the round's minN, and Save handing the page
 * totals only, which become placements.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

import { LiveRound } from "@/app/(tools)/relative-sizing/live-round";
import { placementsFromRound } from "@/lib/relative-sizing/live";
import { bucketsFor, middleBucket, newBoard, withAnchor } from "@/lib/relative-sizing/model";
import type { SizingBoard } from "@/lib/relative-sizing/state";

const A: FakeMember = { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy Ray", joinedAt: "2026-10-26T09:03:00Z" };

const NOW = "2026-11-23T10:00:00.000Z";

function board(): SizingBoard {
  const b = newBoard(
    {
      title: "Checkout",
      bucketSet: "fibonacci",
      buckets: bucketsFor("fibonacci"),
      items: [
        { title: "Pay with a saved card", storyId: "a" },
        { title: "Refund a payment", storyId: "b" },
        { title: "Email a receipt", storyId: "c" },
        { title: "Split the bill", storyId: "d" },
      ],
    },
    "sizing_a",
    NOW,
    (i) => `c${i + 1}`
  );
  return withAnchor(b, "c1", middleBucket(b).id, NOW);
}

beforeAll(() => import("@/components/collab/vote-room/host-vote-room"));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  window.sessionStorage.clear();
});
afterEach(() => vi.unstubAllEnvs());

const onStart = vi.fn();

async function startRound(onSave: (r: VoteRoundResult) => void | false | (() => void)) {
  onStart.mockClear();
  const crypto = fakeVoteCrypto();
  const view = (b: SizingBoard) => (
    <LiveAnnouncerProvider>
      <LiveRound board={b} onSave={onSave} onStart={onStart} crypto={crypto} />
    </LiveAnnouncerProvider>
  );
  const { rerender } = render(view(board()));
  fireEvent.click(await screen.findByRole("button", { name: "Run a live round" }));
  const dialog = screen.getByRole("dialog", { name: "Start a live Relative Sizing room" });
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
  await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
  const ch = fakeRealtime.last();
  expect(ch.name).toMatch(/^visitor:relative-sizing:[23456789A-HJKMNP-Z]{12}$/);
  const code = ch.name.split(":")[2];
  const hostId = JSON.parse(
    window.sessionStorage.getItem(`agile-toolkit:visitor-room:${code}`) ?? "{}"
  ).id as string;
  act(() => {
    ch.connect();
    ch.setPresence([{ id: hostId, name: "Hana", joinedAt: "2026-10-26T09:00:00Z" }, A, B, C]);
  });
  await waitFor(() => expect(ch.sent(VOTE_ROOM_EVENTS.state).length).toBeGreaterThan(0));
  return { ch, crypto, rerender: (b: SizingBoard) => rerender(view(b)) };
}

/** The test board with every story placed in a bucket. */
function allPlaced(): SizingBoard {
  const b = board();
  return { ...b, items: b.items.map((i) => ({ ...i, bucketId: i.bucketId ?? "b3" })) };
}

async function answer(
  ch: FakeChannel,
  crypto: VoteCrypto,
  m: FakeMember,
  bid: string,
  picks: number[]
) {
  const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as VoteStateMessage;
  const sealed = await crypto.seal(
    s.keys.ecdh,
    ballotAad(s.roundId, m.id, bid),
    answerString(picks)
  );
  await act(async () => {
    ch.deliver(VOTE_ROOM_EVENTS.ballot, { v: 1, by: m.id, roundId: s.roundId, bid, ...sealed });
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("Relative Sizing's live round", () => {
  it("asks about the stories not placed, the anchor in the title, every story skippable", async () => {
    const { ch } = await startRound(() => undefined);
    const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as VoteStateMessage;
    const wire = JSON.stringify(s);
    expect(wire).toContain("Checkout · “Pay with a saved card” is a 5");
    expect(wire).toContain("Refund a payment");
    // The anchor is placed already: it isn't asked about.
    expect(wire.match(/Pay with a saved card/g)).toHaveLength(1);
    // The page logs the round's start with how many stories it asks about.
    expect(onStart).toHaveBeenCalledWith(3);
  });

  it("reveals where the room put each story, withholds what too few placed, and saves totals only", async () => {
    const saves: VoteRoundResult[] = [];
    const { ch, crypto } = await startRound((r) => {
      saves.push(r);
      return () => {};
    });
    // Three stories (b, c, d) on seven buckets: index 2 is "3", 4 is "8", 6 is "21".
    await answer(ch, crypto, A, "bid_00000001", [4, 0, 2]);
    await answer(ch, crypto, B, "bid_00000002", [4, 0, 6]);
    await answer(ch, crypto, C, "bid_00000003", [4, -1, 2]);
    const reveal = await screen.findByRole("button", { name: "Reveal results" });
    await waitFor(() => expect(reveal).toBeEnabled());
    fireEvent.click(reveal);
    const results = await screen.findByRole("list", { name: "Where the room placed each story" });
    expect(results).toHaveTextContent("Full consensus: it goes in 8.");
    // Two people placed "Email a receipt": fewer than the round's 3.
    expect(results).toHaveTextContent("Fewer than 3 placed it.");
    expect(results).toHaveTextContent("Discussion needed: from 3 to 21. It goes to Talk about it.");
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(saves).toHaveLength(1);
    const json = JSON.stringify(saves[0]);
    for (const m of [A, B, C]) {
      expect(json).not.toContain(m.id);
      expect(json).not.toContain(m.name);
    }
    // The page turns the totals into placements.
    const r = placementsFromRound(saves[0], board(), NOW);
    expect([r.placed, r.outliers, r.withheld]).toEqual([1, 1, 1]);
    expect(r.board.items.find((i) => i.id === "c2")?.bucketId).toBe("b5");
    expect(r.board.items.find((i) => i.id === "c4")?.contested).toBe(true);
  });

  it("keeps an open room until the host ends it, even once every story is placed", async () => {
    const { rerender } = await startRound(() => () => {});
    expect(screen.getByRole("region", { name: "Live Relative Sizing round" })).toBeInTheDocument();
    // Save round (or the last card dragged into a bucket) leaves nothing to ask about.
    rerender(allPlaced());
    expect(screen.getByRole("region", { name: "Live Relative Sizing round" })).toBeInTheDocument();
    expect(screen.getByText(/Every story is placed\./)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Stories to ask about/ })).not.toBeInTheDocument();
  });

  it("makes each story row and the skip toggle a 44 px target on touch screens", () => {
    render(
      <LiveAnnouncerProvider>
        <LiveRound board={board()} onSave={() => undefined} crypto={fakeVoteCrypto()} />
      </LiveAnnouncerProvider>
    );
    const rows = [
      screen.getByRole("checkbox", { name: "Refund a payment" }),
      screen.getByRole("checkbox", { name: /Let people skip/ }),
    ];
    for (const box of rows) {
      expect(box.closest("label")).toHaveClass("flex", "min-h-11");
      expect(box).toHaveClass("shrink-0");
    }
  });

  it("says every story is placed, with no room to run, when none is open", () => {
    render(
      <LiveAnnouncerProvider>
        <LiveRound board={allPlaced()} onSave={() => undefined} crypto={fakeVoteCrypto()} />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText(/Every story is placed\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).not.toBeInTheDocument();
  });
});
