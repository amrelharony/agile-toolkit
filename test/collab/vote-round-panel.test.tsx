import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { GuestProfileProvider } from "@/lib/auth/guest-profile-provider";
import { VOTE_ROOM_CONSENT_TEXT } from "@/components/collab/visitor-room-consent";
import { ballotAad, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS, type VoteStateMessage } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { fakeRealtime, type FakeChannel, type FakeMember } from "../realtime/fake-realtime";
import { QUESTIONNAIRE, answerString, fakeVoteCrypto } from "../realtime/vote-room-fixtures";

/**
 * The tool's entry point: count entry when live rounds are off, otherwise
 * consent, then a live room whose link carries the host key, a polite
 * count, Reveal from minN, and Save once with totals only.
 */

const h = vi.hoisted(() => ({ realtime: true }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => h.realtime, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastMock }));

import { VoteRoundPanel } from "@/components/collab/vote-room/vote-round-panel";

const A: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };
const B: FakeMember = { id: "bobby_0000000000", name: "Bo", joinedAt: "2026-10-26T09:02:00Z" };
const C: FakeMember = { id: "carol_0000000000", name: "Cy", joinedAt: "2026-10-26T09:03:00Z" };

function renderPanel(
  props: Partial<Parameters<typeof VoteRoundPanel>[0]> = {},
  wrap: (n: ReactNode) => ReactNode = (n) => n
) {
  const onSave = vi.fn<(r: VoteRoundResult) => void>();
  const crypto = props.crypto === undefined ? fakeVoteCrypto() : props.crypto;
  render(
    <LiveAnnouncerProvider>
      {wrap(
        <VoteRoundPanel
          tool="health-check"
          toolName="Health Check"
          questionnaire={QUESTIONNAIRE}
          minN={3}
          onSave={onSave}
          {...props}
          crypto={crypto}
        />
      )}
    </LiveAnnouncerProvider>
  );
  return { onSave, crypto };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.realtime = true;
  fakeRealtime.reset();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VoteRoundPanel: when live rounds are off", () => {
  it.each([
    [
      "the flag is off",
      () => vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", ""),
      {},
      /Live rounds are off on this site/,
    ],
    ["Supabase isn't set up", () => (h.realtime = false), {}, /need the realtime service/],
    ["the browser has no WebCrypto", () => {}, { crypto: null }, /can't encrypt answers/],
  ])("falls back to count entry when %s", async (_label, arrange, props, reason) => {
    arrange();
    renderPanel(props);
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show totals" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("falls back to count entry for a squad guest", async () => {
    renderPanel({}, (n) => (
      <GuestProfileProvider
        profile={{
          id: "g1",
          displayName: "Gus",
          color: "#00f0ff",
          squadId: "s1",
          squadOwnerId: "o1",
        }}
      >
        {n}
      </GuestProfileProvider>
    ));
    expect(await screen.findByText(/Guests can't host live rounds/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
  });

  it("asks for something to ask when there's no questionnaire", () => {
    renderPanel({ questionnaire: null });
    expect(screen.getByText("Add something to ask first, then run a round.")).toBeInTheDocument();
  });
});

describe("VoteRoundPanel: a live round", () => {
  async function startRound() {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Run a live round" }));
    const dialog = screen.getByRole("dialog", { name: "Start a live Health Check room" });
    expect(dialog).toHaveAccessibleDescription(VOTE_ROOM_CONSENT_TEXT);
    // Nothing opens before consent.
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: "Hana" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start room" }));
    await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
    const ch = fakeRealtime.last();
    const code = ch.name.split(":")[2];
    expect(ch.name).toMatch(/^visitor:health-check:[23456789A-HJKMNP-Z]{12}$/);
    const hostId = JSON.parse(
      window.sessionStorage.getItem(`agile-toolkit:visitor-room:${code}`) ?? "{}"
    ).id as string;
    const host = { id: hostId, name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
    act(() => {
      ch.connect();
      ch.setPresence([host, A, B, C]);
    });
    await waitFor(() => expect(ch.sent(VOTE_ROOM_EVENTS.state).length).toBeGreaterThan(0));
    return { ...view, ch, code, writeText };
  }

  async function answer(ch: FakeChannel, crypto: VoteCrypto, m: FakeMember, bid: string) {
    const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as VoteStateMessage;
    const sealed = await crypto.seal(
      s.keys.ecdh,
      ballotAad(s.roundId, m.id, bid),
      answerString([0, 1, 2])
    );
    await act(async () => {
      ch.deliver(VOTE_ROOM_EVENTS.ballot, { v: 1, by: m.id, roundId: s.roundId, bid, ...sealed });
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
  }

  it("copies a link that carries the host key after #k=", async () => {
    const { code, writeText, ch } = await startRound();
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const s = ch.sent(VOTE_ROOM_EVENTS.state).at(-1) as VoteStateMessage;
    const fp = await fakeVoteCrypto().fingerprint(s.keys.sig);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join/health-check/${code}#k=${fp}`
    );
  });

  it("keeps Reveal off until minN, announces the count politely, and saves once with totals only", async () => {
    const { ch, crypto, onSave } = await startRound();
    const reveal = await screen.findByRole("button", { name: "Reveal results" });
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAccessibleDescription("0 of 3 answers. Results show from 3.");
    expect(screen.getByText(/^0 people have answered\./)).toBeInTheDocument();

    await answer(ch, crypto!, A, "bid_00000001");
    await answer(ch, crypto!, B, "bid_00000002");
    expect(screen.getByRole("button", { name: "Reveal results" })).toBeDisabled();
    await answer(ch, crypto!, C, "bid_00000003");
    expect(screen.getByText(/^3 people have answered\./)).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByTestId("live-polite")).toHaveTextContent("3 people have answered."),
      { timeout: 3000 }
    );

    const enabled = screen.getByRole("button", { name: "Reveal results" });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    fireEvent.click(screen.getByRole("button", { name: "Round saved" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ tool: "health-check", ballots: 3, source: "live", minN: 3 });
    expect(saved.questions.map((q) => q.distribution)).toEqual([
      [3, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ]);
    const json = JSON.stringify(saved);
    for (const m of [A, B, C]) {
      expect(json).not.toContain(m.id);
      expect(json).not.toContain(m.name);
    }
  });

  it("asks before New round throws answers away, and before ending the room", async () => {
    const { ch, crypto } = await startRound();
    await answer(ch, crypto!, A, "bid_00000001");
    fireEvent.click(screen.getByRole("button", { name: "Start over with a new round" }));
    const confirmNew = screen.getByRole("dialog", { name: "Start a new round?" });
    expect(confirmNew).toHaveTextContent("The 1 answer so far are discarded.");
    fireEvent.click(within(confirmNew).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    const confirmEnd = screen.getByRole("dialog", { name: "End the live room?" });
    expect(ch.removed).toBe(false);
    fireEvent.click(within(confirmEnd).getByRole("button", { name: "End room" }));
    expect(
      await screen.findByRole("heading", { name: "You ended the live round" })
    ).toBeInTheDocument();
    await waitFor(() => expect(ch.removed).toBe(true));
    expect(ch.sent(VOTE_ROOM_EVENTS.end)).toEqual([expect.objectContaining({ reason: "host" })]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Run a live round" })).toBeInTheDocument();
  });
});
