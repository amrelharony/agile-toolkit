import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { VOTE_ROOM_CONSENT_TEXT } from "@/components/collab/visitor-room-consent";
import { VOTE_ROOM_EVENTS } from "@/lib/realtime/vote-room/protocol";
import { ballotAad, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { encodeChoice, type ChoiceSheet } from "@/lib/realtime/vote-room/choice";
import type { RankSheet } from "@/lib/realtime/vote-room/rank";
import type { RoundResult } from "@/lib/realtime/vote-room/kinds";
import { toast } from "@/lib/utils/toast";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { fakeVoteCrypto } from "../realtime/vote-room-fixtures";
import {
  DOTS_SHEET,
  NUMBER_SHEET,
  POLL_SHEET,
  RANK_SHEET,
} from "../realtime/vote-room-kind-fixtures";

/**
 * VoteRoundPanel for Quick Vote's kinds: a choice, rank or number round
 * runs live only (no count entry), says why when live rounds are off, warns
 * of a dot or number round's second threshold, and starts a host room of
 * the named kind after consent.
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

import {
  VoteRoundPanel,
  type PairVoteRoundPanelProps,
} from "@/components/collab/vote-room/vote-round-panel";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

const A: FakeMember = { id: "alice_0000000000", name: "Alex Ng", joinedAt: "2026-11-12T10:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo Li", joinedAt: "2026-11-12T10:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy Ray", joinedAt: "2026-11-12T10:03:00Z" };

type AnyState = Record<string, unknown> & {
  kind?: string;
  roundId: string;
  keys: { sig: string; ecdh: string };
};

const lastState = (ch: FakeChannel) => ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as AnyState;

let bidN = 0;
/** One person's pick in the running choice round, sealed to the host. */
async function pick(ch: FakeChannel, crypto: VoteCrypto, m: FakeMember, option: string) {
  const s = lastState(ch);
  const draft = Object.fromEntries(POLL_SHEET.options.map((o) => [o.id, o.id === option ? 1 : 0]));
  const bid = `bid_${String(++bidN).padStart(8, "0")}`;
  const sealed = await crypto.seal(
    s.keys.ecdh,
    ballotAad(s.roundId, m.id, bid),
    encodeChoice(draft, POLL_SHEET)!
  );
  await act(async () => {
    ch.deliver(VOTE_ROOM_EVENTS.ballot, { v: 1, by: m.id, roundId: s.roundId, bid, ...sealed });
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("VoteRoundPanel: Quick Vote's kinds", () => {
  it("says why when live rounds are off, with no count entry", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
    render(
      <LiveAnnouncerProvider>
        <VoteRoundPanel
          tool="quick-vote"
          toolName="Quick Vote"
          kind="choice"
          sheet={POLL_SHEET}
          onSave={() => undefined}
          crypto={fakeVoteCrypto()}
        />
      </LiveAnnouncerProvider>
    );
    expect(await screen.findByText(/Live rooms are off on this site/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enter counts|Show totals/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
  });

  it("refuses a sheet it can't share, before any consent", async () => {
    render(
      <LiveAnnouncerProvider>
        <VoteRoundPanel
          tool="quick-vote"
          toolName="Quick Vote"
          kind="choice"
          sheet={{ ...POLL_SHEET, options: POLL_SHEET.options.slice(0, 1) }}
          onSave={() => undefined}
          crypto={fakeVoteCrypto()}
        />
      </LiveAnnouncerProvider>
    );
    expect(
      await screen.findByText(/This round can't be shared live: .*2 to 12 options/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
  });

  it("offers the live round on its own, warning of a dot round's second threshold", async () => {
    render(
      <LiveAnnouncerProvider>
        <VoteRoundPanel
          tool="quick-vote"
          toolName="Quick Vote"
          kind="choice"
          sheet={DOTS_SHEET}
          onSave={() => undefined}
          crypto={fakeVoteCrypto()}
        />
      </LiveAnnouncerProvider>
    );
    expect(await screen.findByRole("button", { name: "Run a live round" })).toBeInTheDocument();
    expect(
      screen.getByText(/put a dot on each option shows only from 5 answers/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter counts" })).toBeNull();
  });

  it("starts a host room of the named kind after consent", async () => {
    render(
      <LiveAnnouncerProvider>
        <VoteRoundPanel
          tool="quick-vote"
          toolName="Quick Vote"
          kind="number"
          sheet={NUMBER_SHEET}
          onSave={() => undefined}
          crypto={fakeVoteCrypto()}
        />
      </LiveAnnouncerProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run a live round" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(VOTE_ROOM_CONSENT_TEXT);
    fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    expect(ch.name).toMatch(/^visitor:quick-vote:[A-Z0-9]{12}$/);
    act(() => {
      ch.connect();
    });
    await flush();
    const me = (ch.track.mock.calls.at(-1) as unknown as [{ id: string; name: string }])[0];
    expect(me.name).toBe("Hana");
    act(() => ch.setPresence([{ id: me.id, name: "Hana", joinedAt: "2026-11-12T10:00:00Z" }]));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    await flush();
    const state = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as Record<string, unknown> | undefined;
    expect(state).toMatchObject({ v: 3, kind: "number", tool: "quick-vote" });
  });

  it("needs the kind named where it isn't the tool's usual one", () => {
    const pairWithoutKind = {
      tool: "quick-vote",
      toolName: "Quick Vote",
      sheet: null,
      onSave: () => undefined,
    } as const;
    // @ts-expect-error Quick Vote's usual kind is scale: a pair round must say kind="pair".
    const quickPair: PairVoteRoundPanelProps = pairWithoutKind;
    const named: PairVoteRoundPanelProps = { ...pairWithoutKind, kind: "pair" };
    const kano: PairVoteRoundPanelProps = { ...pairWithoutKind, tool: "kano-model" };
    expect([quickPair, named, kano]).toHaveLength(3);
  });
});

describe("VoteRoundPanel: Quick Vote changing kind while a room is open", () => {
  type Shown =
    | { kind: "choice"; sheet: ChoiceSheet | null; onSave: (r: RoundResult) => void }
    | { kind: "rank"; sheet: RankSheet | null; onSave: (r: RoundResult) => void };

  function panel(shown: Shown, crypto: VoteCrypto) {
    return (
      <LiveAnnouncerProvider>
        {shown.kind === "choice" ? (
          <VoteRoundPanel
            tool="quick-vote"
            toolName="Quick Vote"
            kind="choice"
            sheet={shown.sheet}
            onSave={shown.onSave}
            crypto={crypto}
          />
        ) : (
          <VoteRoundPanel
            tool="quick-vote"
            toolName="Quick Vote"
            kind="rank"
            sheet={shown.sheet}
            onSave={shown.onSave}
            crypto={crypto}
          />
        )}
      </LiveAnnouncerProvider>
    );
  }

  it("saves a revealed round with its own kind's save, and keeps each sheet with its kind", async () => {
    const crypto = fakeVoteCrypto();
    const saveChoice = vi.fn((r: RoundResult) => {
      void r;
    });
    const saveRank = vi.fn((r: RoundResult) => {
      void r;
    });
    const view = render(panel({ kind: "choice", sheet: POLL_SHEET, onSave: saveChoice }, crypto));
    fireEvent.click(await screen.findByRole("button", { name: "Run a live round" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
    });
    await flush();
    const ch = fakeRealtime.last();
    act(() => ch.connect());
    await flush();
    const me = (ch.track.mock.calls.at(-1) as unknown as [{ id: string }])[0];
    act(() =>
      ch.setPresence([{ id: me.id, name: "Hana", joinedAt: "2026-11-12T10:00:00Z" }, A, B, C])
    );
    await waitFor(() => expect(ch.sent(VOTE_ROOM_EVENTS.state).length).toBeGreaterThan(0));
    expect(lastState(ch).kind).toBe("choice");

    await pick(ch, crypto, A, "room");
    await pick(ch, crypto, B, "room");
    await pick(ch, crypto, C, "cafe");
    fireEvent.click(await screen.findByRole("button", { name: "Reveal results" }));
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();

    // The tool moves on to a ranking with nothing to rank yet.
    view.rerender(panel({ kind: "rank", sheet: null, onSave: saveRank }, crypto));
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(saveChoice).toHaveBeenCalledTimes(1);
    expect(saveChoice.mock.calls[0][0]).toMatchObject({ kind: "choice", ballots: 3 });
    expect(saveRank).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Round saved" })).toBeInTheDocument();

    // New round: the rank sheet isn't there yet, so the choice round runs again
    // (its sheet never goes out as a ranking).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New round" }));
    });
    await waitFor(() => expect(lastState(ch).phase).toBe("open"));
    expect(lastState(ch).kind).toBe("choice");
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // With a ranking to run, the next new round is one.
    view.rerender(panel({ kind: "rank", sheet: RANK_SHEET, onSave: saveRank }, crypto));
    await pick(ch, crypto, A, "online");
    fireEvent.click(screen.getByRole("button", { name: "Start over with a new round" }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "Start a new round?" })).getByRole("button", {
          name: "New round",
        })
      );
    });
    await waitFor(() => expect(lastState(ch).kind).toBe("rank"));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
