import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { VISITOR_ROOM_KIND, VISITOR_TOOLS, type VisitorTool } from "@/lib/realtime/visitor-rooms";
import {
  VISITOR_ROOM_CONSENT_TEXT,
  VOTE_ROOM_CONSENT_TEXT,
  WALL_ROOM_CONSENT_TEXT,
} from "@/lib/site/disclosures";

/**
 * `/join/<tool>/<code>` routes every kind of room to its own view: Poker
 * and Retro their rooms, vote tools the vote kit, show tools the generic
 * show view, wall tools the generic wall view. Each shows its own consent
 * first, and a signed room's link (vote, show, wall) must carry the host
 * key before consent is offered. The room views are stubs here: this page
 * only routes.
 */

const h = vi.hoisted(() => ({
  client: {
    channel: vi.fn(),
    removeChannel: vi.fn(async () => "ok"),
  },
}));

vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => true,
  getSupabaseClient: () => h.client,
}));
vi.mock("@/app/(tools)/planning-poker/visitor-poker-room", () => ({
  VisitorPokerRoom: (p: { code: string }) => <div data-testid="room">poker {p.code}</div>,
}));
vi.mock("@/app/(tools)/retro/room/visitor-retro-room", () => ({
  VisitorRetroRoom: (p: { code: string }) => <div data-testid="room">retro {p.code}</div>,
}));
vi.mock("@/components/collab/vote-room/vote-join-room", () => ({
  VoteJoinRoom: (p: { tool: string }) => <div data-testid="room">vote {p.tool}</div>,
}));
vi.mock("@/components/collab/show-room/show-join-room", () => ({
  ShowJoinRoom: (p: { tool: string; toolName: string; identity: { name: string } }) => (
    <div data-testid="room">
      show {p.tool} {p.toolName} {p.identity.name}
    </div>
  ),
}));
vi.mock("@/components/collab/wall-room/wall-join-room", () => ({
  WallJoinRoom: (p: { tool: string; toolName: string; identity: { name: string } }) => (
    <div data-testid="room">
      wall {p.tool} {p.toolName} {p.identity.name}
    </div>
  ),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
        const rest = { ...props };
        for (const k of ["initial", "animate", "exit", "transition", "layout"]) delete rest[k];
        return React.createElement(tag, { ...rest, ref });
      });
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    MotionConfig: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { JoinRoom } from "@/app/join/[tool]/[code]/join-room";

const CODE = "ABCDEFGHJKMN";
const LAZY = { timeout: 8000 };
/** Each case's own limit: above LAZY, so the lazy room's wait can run out first. */
const CASE_TIMEOUT = 15_000;
const KEY_HASH = "#k=abcdefghijklmnopqrstuv";

function consent(name: string) {
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/your name/i), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Join room" }));
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  h.client.channel.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", window.location.pathname);
});

const EXPECTED: Record<VisitorTool, { room: RegExp; consent: string; name: string }> = {
  "planning-poker": { room: /^poker /, consent: VISITOR_ROOM_CONSENT_TEXT, name: "Planning Poker" },
  retro: { room: /^retro /, consent: VISITOR_ROOM_CONSENT_TEXT, name: "Retro" },
  "health-check": {
    room: /^vote health-check/,
    consent: VOTE_ROOM_CONSENT_TEXT,
    name: "Health Check",
  },
  "psych-safety": {
    room: /^vote psych-safety/,
    consent: VOTE_ROOM_CONSENT_TEXT,
    name: "Psych Safety",
  },
  "mood-tracker": {
    room: /^vote mood-tracker/,
    consent: VOTE_ROOM_CONSENT_TEXT,
    name: "Mood Tracker",
  },
  "kano-model": { room: /^vote kano-model/, consent: VOTE_ROOM_CONSENT_TEXT, name: "Kano survey" },
  "buy-a-feature": {
    room: /^vote buy-a-feature/,
    consent: VOTE_ROOM_CONSENT_TEXT,
    name: "Buy-a-Feature",
  },
  "hundred-dollar-test": {
    room: /^vote hundred-dollar-test/,
    consent: VOTE_ROOM_CONSENT_TEXT,
    name: "$100 Test",
  },
  "quick-vote": { room: /^vote quick-vote/, consent: VOTE_ROOM_CONSENT_TEXT, name: "Quick Vote" },
  "audience-wall": {
    room: /^wall audience-wall Audience Wall Sam/,
    consent: WALL_ROOM_CONSENT_TEXT,
    name: "Audience Wall",
  },
  picker: { room: /^show picker Picker Sam/, consent: VISITOR_ROOM_CONSENT_TEXT, name: "Picker" },
  "team-mixer": {
    room: /^show team-mixer Team Mixer Sam/,
    consent: VISITOR_ROOM_CONSENT_TEXT,
    name: "Team Mixer",
  },
  "card-decks": {
    room: /^show card-decks Card Decks Sam/,
    consent: VISITOR_ROOM_CONSENT_TEXT,
    name: "Card Decks",
  },
};

describe("join routing, for every kind of room", () => {
  it("covers every visitor tool", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...VISITOR_TOOLS].sort());
  });

  it.each([...VISITOR_TOOLS])(
    "%s: its own consent first, then its own room, and no channel from this page",
    async (tool) => {
      const kind = VISITOR_ROOM_KIND[tool];
      if (kind !== "poker" && kind !== "retro") window.history.replaceState(null, "", KEY_HASH);
      render(<JoinRoom tool={tool} code={CODE} />);
      const dialog = await screen.findByRole("dialog", {
        name: `Join the live ${EXPECTED[tool].name} room`,
      });
      expect(dialog).toHaveAccessibleDescription(EXPECTED[tool].consent);
      expect(screen.queryByTestId("room")).toBeNull();
      consent("Sam");
      expect(await screen.findByTestId("room", {}, LAZY)).toHaveTextContent(EXPECTED[tool].room);
      expect(h.client.channel).not.toHaveBeenCalled();
    },
    CASE_TIMEOUT
  );

  it.each(["picker", "team-mixer", "card-decks", "audience-wall", "quick-vote"] as const)(
    "%s: a link without the host key is incomplete, with no consent at all",
    async (tool) => {
      window.history.replaceState(null, "", window.location.pathname);
      render(<JoinRoom tool={tool} code={CODE} />);
      const heading = await screen.findByRole("heading", { name: "This link is incomplete" });
      expect(heading).toHaveFocus();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(h.client.channel).not.toHaveBeenCalled();
    }
  );

  it("says what the key proves, per kind", async () => {
    window.history.replaceState(null, "", window.location.pathname);
    const { unmount } = render(<JoinRoom tool="picker" code={CODE} />);
    expect(await screen.findByText(/proves what you see comes from the host/)).toBeInTheDocument();
    unmount();
    render(<JoinRoom tool="audience-wall" code={CODE} />);
    expect(await screen.findByText(/proves the wall comes from the host/)).toBeInTheDocument();
  });
});
