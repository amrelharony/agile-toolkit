import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS } from "@/lib/realtime/vote-room/protocol";
import { fakeRealtime, type FakeMember } from "../realtime/fake-realtime";
import {
  CODE,
  fakeVoteCrypto,
  signedEnd,
  signedState,
  type FakeVoteCrypto,
} from "../realtime/vote-room-fixtures";

/**
 * The participant's page: an incomplete link opens nothing; otherwise the
 * host's questions, then "sent", then the revealed totals with a Markdown
 * download, and a closed notice when the host ends the room.
 */

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => true, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const exportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/export", () => ({ exportToMarkdown: exportMock }));

import { VoteJoinRoom } from "@/components/collab/vote-room/vote-join-room";

const HOST: FakeMember = { id: "host_00000000000", name: "Hana", joinedAt: "2026-10-26T09:00:00Z" };
const ME: FakeMember = { id: "alice_0000000000", name: "Alex", joinedAt: "2026-10-26T09:01:00Z" };

let crypto: FakeVoteCrypto;
let keys: HostKeyPair;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  fakeRealtime.reset();
  exportMock.mockClear();
  window.sessionStorage.clear();
  crypto = fakeVoteCrypto();
  keys = await crypto.createHostKeys();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", window.location.pathname);
});

function renderRoom() {
  const onLeave = vi.fn();
  render(
    <LiveAnnouncerProvider>
      <VoteJoinRoom
        tool="health-check"
        code={CODE}
        identity={{ id: ME.id, name: ME.name }}
        onLeave={onLeave}
        crypto={crypto}
      />
    </LiveAnnouncerProvider>
  );
  return { onLeave };
}

async function deliver(event: string, payload: unknown) {
  await act(async () => {
    fakeRealtime.last().deliver(event, payload);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("VoteJoinRoom", () => {
  it("says the link is incomplete without #k=, and opens nothing", async () => {
    renderRoom();
    expect(await screen.findByRole("heading", { name: "This link is incomplete" })).toHaveFocus();
    expect(fakeRealtime.client.channel).not.toHaveBeenCalled();
  });

  it("answers, waits for the reveal, then shows and downloads the totals", async () => {
    window.history.replaceState(null, "", `#k=${keys.fingerprint}`);
    renderRoom();
    await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
    const ch = fakeRealtime.last();
    act(() => {
      ch.connect();
      ch.setPresence([HOST, ME]);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the host's questions…");
    await deliver(VOTE_ROOM_EVENTS.state, await signedState(crypto, HOST.id, keys));
    expect(screen.getByRole("heading", { name: "Squad health", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Hosted by Hana\. You are Alex\./)).toBeInTheDocument();

    // Pick and send.
    const fun = screen.getByRole("radiogroup", { name: /Fun/ });
    fireEvent.click(within(fun).getByRole("radio", { name: "Green" }));
    const speed = screen.getByRole("radiogroup", { name: /Speed/ });
    fireEvent.click(within(speed).getByRole("radio", { name: "Red" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(
      await screen.findByRole("heading", { name: "Your answers were sent" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    const [ballot] = ch.sent(VOTE_ROOM_EVENTS.ballot) as { bid: string }[];

    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, { seq: 2, ballots: 1, acks: [ballot.bid] })
    );
    expect(screen.getByRole("heading", { name: "Your answers were counted" })).toBeInTheDocument();

    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedState(crypto, HOST.id, keys, {
        seq: 3,
        phase: "revealed",
        ballots: 3,
        revealed: [
          { responses: 3, distribution: [2, 1, 0] },
          { responses: 3, distribution: [0, 0, 3] },
          { responses: 0, distribution: null },
        ],
      })
    );
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(exportMock).toHaveBeenCalledTimes(1);
    expect(exportMock.mock.calls[0][0]).toContain("| Fun | 2 | 1 | 0 | 3 |");
    expect(exportMock.mock.calls[0][0]).not.toContain(ME.id);

    // The host ends the room: the totals stay, with the download.
    await deliver(VOTE_ROOM_EVENTS.end, await signedEnd(crypto, HOST.id, keys));
    expect(screen.getByRole("heading", { name: "The host ended the room" })).toHaveFocus();
    expect(screen.getByText("Download the results if you want to keep them.")).toBeInTheDocument();
    expect(ch.removed).toBe(true);
  });

  it("leaves when asked", async () => {
    window.history.replaceState(null, "", `#k=${keys.fingerprint}`);
    const { onLeave } = renderRoom();
    // The room chip and the waiting notice both offer it.
    const [leave] = await screen.findAllByRole("button", { name: "Leave" });
    fireEvent.click(leave);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(fakeRealtime.last().removed).toBe(true);
  });
});
