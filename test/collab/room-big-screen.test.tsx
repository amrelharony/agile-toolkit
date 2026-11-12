import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * "Big screen": Present mode with the room's code large and grouped, a QR
 * code holding the join link (host key included), how many are in the
 * room, the countdown and the round, and nothing to press. It closes when
 * Present mode ends, and a typed code is offered only for the rooms it can
 * open (Poker and Retro).
 */

const alarm = vi.hoisted(() => ({ timesUp: vi.fn() }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: alarm.timesUp,
}));

import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import {
  PresentationController,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import { PokerBigScreenRound } from "@/app/(tools)/planning-poker/poker-room-bar";
import { startRoomTimer } from "@/lib/realtime/room-timer";
import type { FloatingReaction } from "@/lib/realtime/room-reactions";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { QR_QUIET_ZONE } from "@/lib/qr/encode";
import { decodeQr, rasterisePath, stripQuietZone } from "../qr/decoder";

const CODE = "ABCDEFGHJKMN";
const FP = "abcdefghijklmnopqrstuv";
/** The view loads on first open (next/dynamic). */
const LAZY = { timeout: 10_000 };

function readQr(svg: Element): string {
  const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  return decodeQr(stripQuietZone(rasterisePath(d, side), QR_QUIET_ZONE)).text;
}

function Host({
  tool = "quick-vote" as const,
  reactions = [] as FloatingReaction[],
  children = <p>3 of 5 answered</p>,
}: {
  tool?: "quick-vote" | "retro" | "planning-poker";
  reactions?: FloatingReaction[];
  children?: React.ReactNode;
}) {
  const big = useBigScreen();
  const [timer] = useState(() => startRoomTimer(120, Date.now()));
  return (
    <LiveAnnouncerProvider>
      <VisitorRoomChip
        tool={tool}
        code={CODE}
        memberCount={6}
        isHost
        linkFragment={tool === "quick-vote" ? `#k=${FP}` : undefined}
        onBigScreen={big.show}
      />
      <RoomBigScreen
        {...big.props}
        tool={tool}
        toolName="Quick Vote"
        code={CODE}
        linkFragment={tool === "quick-vote" ? `#k=${FP}` : undefined}
        memberCount={6}
        timer={timer}
        reactions={reactions}
      >
        {children}
      </RoomBigScreen>
      <PresentationController />
    </LiveAnnouncerProvider>
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
  act(() => usePresentation.getState().set(false));
  alarm.timesUp.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => usePresentation.getState().set(false));
});

async function openBigScreen() {
  fireEvent.click(screen.getByRole("button", { name: "Big screen" }));
  return screen.findByRole("heading", { name: "Live Quick Vote" }, LAZY);
}

describe("the room on the big screen", () => {
  it("enters Present mode with the grouped code, the QR code, the count, the timer and the round", async () => {
    render(<Host />);
    expect(document.querySelector("[data-big-screen]")).toBeNull();
    const heading = await openBigScreen();
    expect(usePresentation.getState().presenting).toBe(true);
    const view = document.querySelector("[data-big-screen]") as HTMLElement;
    expect(view).toContainElement(heading);
    expect(within(view).getByText("ABCD-EFGH-JKMN")).toBeInTheDocument();
    expect(within(view).getByText("6 of 20 in the room")).toBeInTheDocument();
    // Real time: the view may have taken a moment to load.
    expect(within(view).getByRole("timer").textContent).toMatch(/^(2:00|1:5\d)$/);
    expect(within(view).getByText("3 of 5 answered")).toBeInTheDocument();
    // The QR code holds the whole join link, host key included.
    const qr = within(view).getByRole("img", { name: "QR code for the join link" });
    expect(readQr(qr)).toBe(`${window.location.origin}/join/quick-vote/${CODE}#k=${FP}`);
    // A vote room can't be joined by typing the code.
    expect(within(view).queryByText(/type the code/)).toBeNull();
    expect(
      within(view).getByText("Scan the code with a phone camera to join.")
    ).toBeInTheDocument();
    // Nothing on it to press, and focus on its heading.
    expect(within(view).queryAllByRole("button")).toHaveLength(0);
    expect(heading).toHaveFocus();
  });

  it("tells people they can type a Poker or Retro code at /join", async () => {
    render(<Host tool="retro" />);
    fireEvent.click(screen.getByRole("button", { name: "Big screen" }));
    const view = await screen.findByText(/type the code/, {}, LAZY);
    expect(view.textContent).toBe(
      `Scan to join, or open ${window.location.host}/join and type the code:`
    );
  });

  it("closes when Present mode ends, by Exit or Escape", async () => {
    render(<Host />);
    await openBigScreen();
    fireEvent.click(screen.getByRole("button", { name: /Exit presentation/ }));
    expect(document.querySelector("[data-big-screen]")).toBeNull();
    expect(usePresentation.getState().presenting).toBe(false);

    await openBigScreen();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-big-screen]")).toBeNull();
    expect(usePresentation.getState().presenting).toBe(false);
  });

  it("shows the reactions in their band, without names", async () => {
    render(
      <Host
        reactions={[
          { key: "r0", r: 0, lane: 0.2, at: 0 },
          { key: "r1", r: 4, lane: 0.6, at: 0 },
        ]}
      />
    );
    await openBigScreen();
    const band = document.querySelector("[data-big-screen] [data-reaction-layer]");
    expect(band).toHaveAttribute("aria-hidden", "true");
    expect(band?.querySelectorAll("[data-reaction]")).toHaveLength(2);
    expect(band?.textContent).toBe("👍❤️");
  });

  it("draws Poker's round large: the story, then how many chose each card", async () => {
    const session: Session = {
      roomCode: CODE,
      sessionName: "Planning",
      scale: ["1", "2", "3", "5", "8"],
      scaleType: "fibonacci",
      host: "Hana",
      hostId: "host_00000000000",
      participants: [
        { id: "a", name: "Alex", vote: "3" },
        { id: "b", name: "Bo", vote: "5" },
        { id: "c", name: "Cy", vote: "3" },
        { id: "d", name: "Di", vote: null },
      ],
      stories: [{ id: "s1", title: "Checkout page", finalEstimate: null }],
      currentStoryIdx: 0,
      revealed: false,
    };
    const { rerender } = render(<PokerBigScreenRound session={session} />);
    expect(screen.getByRole("heading", { name: "Checkout page" })).toBeInTheDocument();
    expect(screen.getByText("3 of 4 voted")).toBeInTheDocument();
    rerender(<PokerBigScreenRound session={{ ...session, revealed: true }} />);
    const cards = within(screen.getByRole("list", { name: "Votes by card" })).getAllByRole(
      "listitem"
    );
    expect(cards.map((c) => c.textContent)).toEqual(["32 votes", "51 vote"]);
    // Names never reach the big screen.
    expect(screen.queryByText(/Alex|Bo|Cy/)).toBeNull();
  });
});
