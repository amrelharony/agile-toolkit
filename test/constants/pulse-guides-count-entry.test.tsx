import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { GuestProfileProvider } from "@/lib/auth/guest-profile-provider";
import { CORE_GUIDES } from "@/lib/tools/guides/core";
import { GUIDES } from "@/lib/tools/guides/team";
import type { ToolGuide } from "@/lib/tools/guides";
import { fakeRealtime } from "../realtime/fake-realtime";
import { QUESTIONNAIRE, fakeVoteCrypto } from "../realtime/vote-room-fixtures";

/*
 * The pulse guides tell a facilitator to press Enter counts instead, and say
 * that where live rounds aren't available the count boxes show on their own.
 * These render the kit's panel both ways, so the guides' wording follows
 * what the panel really shows.
 */

const h = vi.hoisted(() => ({ realtime: true }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", async () => {
  const { fakeRealtime: fake } = await import("../realtime/fake-realtime");
  return { isRealtimeAvailable: () => h.realtime, getSupabaseClient: () => fake.client };
});
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));

import {
  VoteRoundPanel,
  type ScaleVoteRoundPanelProps,
} from "@/components/collab/vote-room/vote-round-panel";

const ON_THEIR_OWN =
  /[Pp]ress Enter counts instead \(where live rounds aren't available, the count boxes show on their own\)/;

function guide(list: readonly ToolGuide[], id: string): string {
  const g = list.find((x) => x.toolId === id);
  if (!g) throw new Error(`No guide for ${id}`);
  return [g.summary, ...g.steps, ...(g.tips ?? [])].join("\n");
}

const PULSE_GUIDES = [
  ["health-check", guide(CORE_GUIDES, "health-check")],
  ["psych-safety", guide(GUIDES, "psych-safety")],
  ["mood-tracker", guide(GUIDES, "mood-tracker")],
] as const;

function renderPanel(
  props: Partial<ScaleVoteRoundPanelProps> = {},
  wrap: (n: ReactNode) => ReactNode = (n) => n
) {
  render(
    <LiveAnnouncerProvider>
      {wrap(
        <VoteRoundPanel
          tool="health-check"
          toolName="Health Check"
          questionnaire={QUESTIONNAIRE}
          minN={3}
          onSave={() => undefined}
          crypto={fakeVoteCrypto()}
          {...props}
        />
      )}
    </LiveAnnouncerProvider>
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.realtime = true;
  fakeRealtime.reset();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the pulse guides' count entry, as the panel shows it", () => {
  it.each(PULSE_GUIDES)("%s says so", (_id, text) => {
    expect(text).toMatch(ON_THEIR_OWN);
    // There is no "only option" button when live rounds are off.
    expect(text).not.toMatch(/the only option when live rounds are off/);
  });

  it("live rounds available: Enter counts instead is a button next to Run a live round", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: "Run a live round" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter counts instead" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show totals" })).toBeNull();
  });

  it.each([
    ["the flag is off", () => vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", ""), {}],
    ["Supabase isn't set up", () => (h.realtime = false), {}],
    ["the browser has no WebCrypto", () => {}, { crypto: null }],
  ])(
    "%s: the count boxes show on their own, with no button to press",
    async (_l, arrange, props) => {
      arrange();
      renderPanel(props);
      expect(await screen.findByRole("button", { name: "Show totals" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enter counts instead" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Run a live round" })).toBeNull();
    }
  );

  it("a squad guest: the count boxes show on their own", async () => {
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
    expect(screen.getByRole("button", { name: "Show totals" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter counts instead" })).toBeNull();
  });
});
