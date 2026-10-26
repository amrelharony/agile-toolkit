import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { HostKeyPair } from "@/lib/realtime/vote-room/crypto";
import { VOTE_ROOM_EVENTS, type VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import { allocationCiphertextChars } from "@/lib/realtime/vote-room/allocation";
import { fakeRealtime, type FakeMember } from "../realtime/fake-realtime";
import {
  ALLOCATION_SHEET,
  PAIR_SHEET,
  CODE,
  allocationStateBody,
  fakeVoteCrypto,
  pairStateBody,
  signedKindState,
  type FakeVoteCrypto,
} from "../realtime/vote-room-fixtures";

/**
 * The participant's page for a $100 Test and a Kano round: the host's
 * sheet, the kind's form, "sent", then the kind's revealed results with a
 * Markdown download of that kind.
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
  window.history.replaceState(null, "", `#k=${keys.fingerprint}`);
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", window.location.pathname);
});

async function joined(tool: VoteRoomTool) {
  render(
    <LiveAnnouncerProvider>
      <VoteJoinRoom
        tool={tool}
        code={CODE}
        identity={{ id: ME.id, name: ME.name }}
        onLeave={vi.fn()}
        crypto={crypto}
      />
    </LiveAnnouncerProvider>
  );
  await waitFor(() => expect(fakeRealtime.client.channel).toHaveBeenCalledTimes(1));
  const ch = fakeRealtime.last();
  act(() => {
    ch.connect();
    ch.setPresence([HOST, ME]);
  });
  return ch;
}

async function deliver(event: string, payload: unknown) {
  await act(async () => {
    fakeRealtime.last().deliver(event, payload);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("VoteJoinRoom: a $100 Test round", () => {
  it("splits, waits for the reveal, then shows and downloads the totals", async () => {
    const ch = await joined("hundred-dollar-test");
    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, allocationStateBody(HOST.id, keys))
    );
    expect(
      screen.getByRole("heading", { name: ALLOCATION_SHEET.title, level: 1 })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Search/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/Themes/), { target: { value: "30" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send my split" }));
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(await screen.findByRole("heading", { name: "Your answers were sent" })).toHaveFocus();
    const [ballot] = ch.sent(VOTE_ROOM_EVENTS.ballot) as { ct: string; bid: string }[];
    expect(ballot.ct).toHaveLength(allocationCiphertextChars(ALLOCATION_SHEET));

    const revealed = [
      { total: 165, backers: null, bands: null },
      { total: 55, backers: null, bands: null },
      { total: 45, backers: null, bands: null },
      { total: 35, backers: null, bands: null },
    ];
    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedKindState(
        crypto,
        keys,
        allocationStateBody(HOST.id, keys, { seq: 2, phase: "revealed", ballots: 3, revealed })
      )
    );
    expect(
      screen.getByText(
        "3 people split $100 each. Search got the most: $165 in all, $55 on average."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(exportMock).toHaveBeenCalledTimes(1);
    const [md, name] = exportMock.mock.calls[0] as [string, string];
    expect(name).toMatch(/^hundred-dollar-test-round-/);
    expect(md).toContain("| Search | $165 | $55 | — | — |");
    expect(md).toContain("The spread shows from 5 answers.");
  });
});

describe("VoteJoinRoom: a Kano round", () => {
  it("answers both questions per feature, then shows each feature's grid", async () => {
    const ch = await joined("kano-model");
    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedKindState(crypto, keys, pairStateBody(HOST.id, keys))
    );
    expect(screen.getByRole("heading", { name: PAIR_SHEET.title, level: 1 })).toBeInTheDocument();
    const pick = (feature: RegExp, which: 0 | 1, label: string) => {
      const group = screen.getByRole("group", { name: feature });
      fireEvent.click(
        within(within(group).getAllByRole("radiogroup")[which]).getByRole("radio", { name: label })
      );
    };
    pick(/Dark mode/, 0, "I like it");
    pick(/Dark mode/, 1, "I dislike it");
    pick(/CSV export/, 0, "I expect it");
    pick(/CSV export/, 1, "I expect it");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    expect(
      await screen.findByRole("heading", { name: "Your answers were sent" })
    ).toBeInTheDocument();
    expect(ch.sent(VOTE_ROOM_EVENTS.ballot)).toHaveLength(1);

    const joint = new Array<number>(25).fill(0);
    joint[4] = 3;
    await deliver(
      VOTE_ROOM_EVENTS.state,
      await signedKindState(
        crypto,
        keys,
        pairStateBody(HOST.id, keys, {
          seq: 2,
          phase: "revealed",
          ballots: 3,
          revealed: [
            { responses: 3, joint },
            { responses: 3, joint },
            { responses: 0, joint: null },
          ],
        })
      )
    );
    expect(screen.getByRole("figure", { name: "1. Dark mode" })).toHaveAccessibleDescription(
      "Most common pair: I like it / I dislike it (3 of 3)."
    );
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    const [md] = exportMock.mock.calls[0] as [string];
    expect(md).toContain("## 1. Dark mode");
    expect(md).toContain("Withheld: 0 answers, fewer than 3.");
  });
});
