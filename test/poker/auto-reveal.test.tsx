import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { startRoomTimer, type RoomTimer } from "@/lib/realtime/room-timer";

/**
 * A Poker vote timer in a visitor room: the host's "Reveal the cards at
 * zero" reveals the votes as the room timer runs out, once, and only if
 * someone voted. Without the switch, or for anyone but the host, nothing
 * happens at zero.
 */

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const cache = new Map<string, unknown>();
  const component = (tag: string) => {
    if (!cache.has(tag)) {
      const C = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
        React.createElement(tag, { ...strip(props), ref })
      );
      C.displayName = `Motion(${tag})`;
      cache.set(tag, C);
    }
    return cache.get(tag);
  };
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: (_target, tag: string) => component(tag) }),
  };
});

import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";

const HOST = "host_00000000000";
const NOW = Date.parse("2026-11-12T10:00:00Z");

function makeSession(votes: (string | null)[]): Session {
  return {
    roomCode: "ABCDEFGHJKMN",
    sessionName: "Planning",
    scale: ["1", "2", "3", "5", "8"],
    scaleType: "fibonacci",
    host: "Hana",
    hostId: HOST,
    participants: votes.map((vote, i) => ({
      id: i === 0 ? HOST : `p${i}_000000000000`,
      name: i === 0 ? "Hana" : `P${i}`,
      vote,
    })),
    stories: [{ id: "s1", title: "Checkout page", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
  };
}

let latest: Session | null = null;

function Harness({
  votes,
  timer,
  isHost = true,
}: {
  votes: (string | null)[];
  timer: RoomTimer | null;
  isHost?: boolean;
}) {
  const [session, setSession] = useState(() => makeSession(votes));
  latest = session;
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) => setSession((s) => updater(s))}
      localParticipantId={HOST}
      isHost={isHost}
      onLeave={() => {}}
      showRoomCode={false}
      recordHistory={false}
      revealAtZero={timer}
    />
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  latest = null;
});
afterEach(() => vi.useRealTimers());

describe("reveal the cards at zero", () => {
  it("reveals the votes as the room timer runs out", () => {
    const timer = startRoomTimer(30, Date.now(), { autoReveal: true });
    render(<Harness votes={["3", "5", null]} timer={timer} />);
    advance(29_000);
    expect(latest?.revealed).toBe(false);
    advance(1_100);
    expect(latest?.revealed).toBe(true);
    expect(screen.getByRole("button", { name: /Vote Again/ })).toBeInTheDocument();
  });

  it("does nothing at zero when nobody voted", () => {
    const timer = startRoomTimer(10, Date.now(), { autoReveal: true });
    render(<Harness votes={[null, null]} timer={timer} />);
    advance(11_000);
    expect(latest?.revealed).toBe(false);
  });

  it("does nothing without the switch, or for someone who isn't the host", () => {
    const off = startRoomTimer(10, Date.now(), { autoReveal: false });
    const { unmount } = render(<Harness votes={["3"]} timer={off} />);
    advance(11_000);
    expect(latest?.revealed).toBe(false);
    unmount();
    const on = startRoomTimer(10, Date.now(), { autoReveal: true });
    render(<Harness votes={["3"]} timer={on} isHost={false} />);
    advance(11_000);
    expect(latest?.revealed).toBe(false);
  });

  it("doesn't reveal for a timer that ran out long before it arrived", () => {
    const stale = startRoomTimer(10, Date.now() - 60_000, { autoReveal: true });
    render(<Harness votes={["3"]} timer={stale} />);
    advance(1000);
    expect(latest?.revealed).toBe(false);
  });

  it("doesn't wait on a paused timer", () => {
    const running = startRoomTimer(10, Date.now(), { autoReveal: true })!;
    const paused: RoomTimer = { ...running, endsAt: null, pausedSeconds: 10 };
    render(<Harness votes={["3"]} timer={paused} />);
    advance(20_000);
    expect(latest?.revealed).toBe(false);
  });
});
