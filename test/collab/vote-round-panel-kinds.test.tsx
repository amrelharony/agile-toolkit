import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ballotAad, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS } from "@/lib/realtime/vote-room/protocol";
import type { AllocationRoundResult, AllocationSheet } from "@/lib/realtime/vote-room/allocation";
import type { PairRoundResult, PairSheet } from "@/lib/realtime/vote-room/pair";
import type { SaveAllocationRound, SavePairRound } from "@/components/collab/vote-room/save-round";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import {
  ALLOCATION_SHEET,
  BUY_SHEET,
  PAIR_SHEET,
  allocationString,
  fakeVoteCrypto,
  pairString,
} from "../realtime/vote-room-fixtures";

/**
 * The panel for the new kinds of round: an allocation tool ($100 Test,
 * Buy-a-Feature) and Kano. Count entry of the right kind when live rounds
 * are off or the sheet can't be shared, the tool's own hold-back reason,
 * then a live room that sends its kind's state, reveals, previews with the
 * tool's renderResults and saves the kind's result once.
 */

const h = vi.hoisted(() => ({ realtime: true }));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() })
);
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => h.realtime, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { VoteRoundPanel } from "@/components/collab/vote-room/vote-round-panel";

const A: FakeMember = { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy Ray", joinedAt: "2026-10-26T09:03:00Z" };
const D: FakeMember = { id: "dylan_0000000000", name: "Di Fox", joinedAt: "2026-10-26T09:04:00Z" };
const E: FakeMember = { id: "erinn_0000000000", name: "Ed Lam", joinedAt: "2026-10-26T09:05:00Z" };

function renderAllocation(
  props: {
    sheet?: AllocationSheet | null;
    blockedReason?: string | null;
    crypto?: VoteCrypto | null;
    tool?: "hundred-dollar-test" | "buy-a-feature";
  } = {}
) {
  const onSave = vi.fn<SaveAllocationRound>(() => undefined);
  const renderResults = vi.fn((r: AllocationRoundResult) => (
    <p>Tool preview: {r.ballots} splits</p>
  ));
  const crypto = props.crypto === undefined ? fakeVoteCrypto() : props.crypto;
  render(
    <LiveAnnouncerProvider>
      <VoteRoundPanel
        tool={props.tool ?? "hundred-dollar-test"}
        toolName="$100 Test"
        sheet={props.sheet === undefined ? ALLOCATION_SHEET : props.sheet}
        blockedReason={props.blockedReason}
        onSave={onSave}
        renderResults={renderResults}
        crypto={crypto}
      />
    </LiveAnnouncerProvider>
  );
  return { onSave, renderResults, crypto };
}

function renderPair(props: { sheet?: PairSheet | null; crypto?: VoteCrypto | null } = {}) {
  const onSave = vi.fn<SavePairRound>(() => undefined);
  const renderResults = vi.fn((r: PairRoundResult) => (
    <p>Kano preview: {r.items.length} features</p>
  ));
  const crypto = props.crypto === undefined ? fakeVoteCrypto() : props.crypto;
  render(
    <LiveAnnouncerProvider>
      <VoteRoundPanel
        tool="kano-model"
        toolName="Kano survey"
        sheet={props.sheet === undefined ? PAIR_SHEET : props.sheet}
        onSave={onSave}
        renderResults={renderResults}
        crypto={crypto}
      />
    </LiveAnnouncerProvider>
  );
  return { onSave, renderResults, crypto };
}

/** Consent, then a live room with `present` in it; returns the host's channel. */
async function goLive(toolName: string, present: FakeMember[] = [A, B, C]): Promise<FakeChannel> {
  fireEvent.click(await screen.findByRole("button", { name: "Run a live round" }));
  const dialog = screen.getByRole("dialog", { name: `Start a live ${toolName} room` });
  expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
  await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
  const ch = fakeRealtime.last();
  const code = ch.name.split(":")[2];
  const hostId = JSON.parse(
    window.sessionStorage.getItem(`agile-toolkit:visitor-room:${code}`) ?? "{}"
  ).id as string;
  act(() => {
    ch.connect();
    ch.setPresence([{ id: hostId, name: "Hana", joinedAt: "2026-10-26T09:00:00Z" }, ...present]);
  });
  await waitFor(() => expect(ch.sent(VOTE_ROOM_EVENTS.state).length).toBeGreaterThan(0));
  return ch;
}

async function sendBallot(
  ch: FakeChannel,
  crypto: VoteCrypto,
  m: FakeMember,
  bid: string,
  plain: string
) {
  const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as { roundId: string; keys: { ecdh: string } };
  const sealed = await crypto.seal(s.keys.ecdh, ballotAad(s.roundId, m.id, bid), plain);
  await act(async () => {
    ch.deliver(VOTE_ROOM_EVENTS.ballot, { v: 1, by: m.id, roundId: s.roundId, bid, ...sealed });
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.realtime = true;
  fakeRealtime.reset();
  toastMock.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VoteRoundPanel: an allocation tool", () => {
  it("offers paper splits when live rounds are off", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    renderAllocation();
    expect(await screen.findByText(/Live rounds are off on this site/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paper splits" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add split" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
  });

  it("shows the tool's reason instead of the buttons when it holds the round back", () => {
    renderAllocation({ blockedReason: "Set the players and their budget first." });
    expect(screen.getByText("Set the players and their budget first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter counts instead" })).toBeNull();
  });

  it("asks for items when there's nothing to split", () => {
    renderAllocation({ sheet: null });
    expect(
      screen.getByText("Add at least two items to split between first, then run a round.")
    ).toBeInTheDocument();
  });

  it("says why a sheet can't be shared live, before any consent, and offers paper splits", async () => {
    renderAllocation({ sheet: { ...ALLOCATION_SHEET, unit: "dollars" } });
    expect(
      await screen.findByText(
        "This round can't be shared live: The unit can be at most 4 characters, like $ or pts. Collect paper answers and enter them here."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add split" })).toBeInTheDocument();
  });

  it("offers nothing for a sheet that can't be counted even by hand, saying why", () => {
    // Buy-a-Feature's later round: the leftover pool split evenly can fall under 10 each.
    renderAllocation({ tool: "buy-a-feature", sheet: { ...BUY_SHEET, budget: 6 } });
    expect(
      screen.getByText(
        "This round can't run, live or on paper: Each person's budget needs to be a whole number from 10 to 9,999."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add split" })).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("says before Reveal that who backed what, and the spread, wait for 5", async () => {
    const { crypto } = renderAllocation();
    expect(
      await screen.findByText(
        /the totals once 3 have\. Who gave each item something, and how the amounts were spread, show only from 5 answers, and Reveal closes the round: wait for 5 if you want them\./
      )
    ).toBeInTheDocument();
    const ch = await goLive("$100 Test", [A, B, C, D, E]);
    const splits = [
      [40, 30, 20, 10],
      [100, 0, 0, 0],
      [25, 25, 25, 25],
      [0, 50, 50, 0],
      [10, 20, 30, 40],
    ];
    const people = [A, B, C, D, E];
    for (let i = 0; i < 3; i++) {
      await sendBallot(
        ch,
        crypto!,
        people[i],
        `bid_0000000${i + 1}`,
        allocationString(splits[i], 3)
      );
    }
    const reveal = screen.getByRole("button", { name: "Reveal results" });
    expect(reveal).toBeEnabled();
    expect(reveal).toHaveAccessibleDescription(/show only from 5 answers/);
    for (let i = 3; i < 5; i++) {
      await sendBallot(
        ch,
        crypto!,
        people[i],
        `bid_0000000${i + 1}`,
        allocationString(splits[i], 3)
      );
    }
    expect(screen.getByRole("button", { name: "Reveal results" })).not.toHaveAccessibleDescription(
      /show only from 5/
    );
    expect(screen.queryByText(/show only from 5 answers, and Reveal closes/)).toBeNull();
  });

  it("runs a live round: v2 state, sealed splits, totals at 3, the tool's preview, and one save", async () => {
    const { crypto, onSave, renderResults } = renderAllocation();
    const ch = await goLive("$100 Test");
    expect(ch.name).toMatch(/^visitor:hundred-dollar-test:/);
    expect(ch.sent(VOTE_ROOM_EVENTS.state).at(-1)).toMatchObject({ v: 2, kind: "allocation" });
    await sendBallot(ch, crypto!, A, "bid_00000001", allocationString([40, 30, 20, 10], 3));
    await sendBallot(ch, crypto!, B, "bid_00000002", allocationString([100, 0, 0, 0], 3));
    await sendBallot(ch, crypto!, C, "bid_00000003", allocationString([25, 25, 25, 25], 3));
    expect(screen.getByText(/^3 people have answered\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal results" }));
    expect(await screen.findByRole("heading", { name: "Results" })).toHaveFocus();
    expect(
      screen.getByText(
        "3 people split $100 each. Search got the most: $165 in all, $55 on average."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Tool preview: 3 splits")).toBeInTheDocument();
    expect(renderResults).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    fireEvent.click(screen.getByRole("button", { name: "Round saved" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      kind: "allocation",
      tool: "hundred-dollar-test",
      ballots: 3,
      source: "live",
    });
    expect(JSON.stringify(onSave.mock.calls[0][0])).not.toMatch(/alice|bobby|carol|Alex|bid_/);
  });

  it("lets the host give their own split through the same form", async () => {
    renderAllocation({ tool: "buy-a-feature", sheet: BUY_SHEET });
    await goLive("$100 Test");
    fireEvent.click(screen.getByRole("button", { name: "Answer too" }));
    fireEvent.change(screen.getByLabelText(/Exports/), { target: { value: "30" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Count my split" }));
    });
    expect(await screen.findByText("Your own answers are counted.")).toBeInTheDocument();
    expect(screen.getByText(/^1 person has answered\./)).toBeInTheDocument();
  });
});

describe("VoteRoundPanel: Kano", () => {
  it("offers the 5 × 5 count entry when live rounds are off", async () => {
    renderPair({ crypto: null });
    expect(await screen.findByText(/can't encrypt answers/)).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(75);
  });

  it("says why a sheet can't be shared live, before any consent", async () => {
    renderPair({ sheet: { ...PAIR_SHEET, answers: ["Yes"] } });
    expect(
      await screen.findByText(
        "This round can't be shared live: The questions need 2 to 5 answers to pick from. Collect paper answers and enter them here."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
  });

  it("runs a live round: pair state, joints per feature, the preview, and one save", async () => {
    const { crypto, onSave } = renderPair();
    const ch = await goLive("Kano survey");
    expect(ch.name).toMatch(/^visitor:kano-model:/);
    expect(ch.sent(VOTE_ROOM_EVENTS.state).at(-1)).toMatchObject({ v: 2, kind: "pair" });
    await sendBallot(ch, crypto!, A, "bid_00000001", pairString([4, 6, -1]));
    await sendBallot(ch, crypto!, B, "bid_00000002", pairString([4, 6, -1]));
    await sendBallot(ch, crypto!, C, "bid_00000003", pairString([20, 12, -1]));
    fireEvent.click(screen.getByRole("button", { name: "Reveal results" }));
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "1. Dark mode" })).toHaveAccessibleDescription(
      "Most common pair: I like it / I dislike it (2 of 3)."
    );
    expect(screen.getByText("Kano preview: 3 features")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ kind: "pair", tool: "kano-model", ballots: 3 });
    expect(saved.items[2].joint).toBeNull();
  });
});
