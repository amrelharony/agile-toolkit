import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { VOTE_ROOM_CONSENT_TEXT } from "@/components/collab/visitor-room-consent";
import { VOTE_ROOM_EVENTS } from "@/lib/realtime/vote-room/protocol";
import { fakeRealtime } from "../realtime/fake-realtime";
import { fakeVoteCrypto } from "../realtime/vote-room-fixtures";
import { DOTS_SHEET, NUMBER_SHEET, POLL_SHEET } from "../realtime/vote-room-kind-fixtures";

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

import { VoteRoundPanel } from "@/components/collab/vote-room/vote-round-panel";

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
});
