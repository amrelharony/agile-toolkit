import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * "Big screen": Present mode with the room's code large and grouped, a QR
 * code holding the join link (host key included), how many are in the
 * room, the countdown and the round, and nothing to press. It is a dialog
 * over an inert page, closes when Present mode ends (or fullscreen does),
 * gives focus back to the Big screen button, and a typed code is offered
 * only for the rooms it can open (Poker and Retro). Poker offers it only on
 * the tool page, where the shell can close it.
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
import { PokerBigScreenRound, PokerRoomBar } from "@/app/(tools)/planning-poker/poker-room-bar";
import { ShowBigScreenFrame } from "@/components/collab/show-room/show-room-host";
import type { ShowFrame } from "@/lib/realtime/show-room/use-show-room";
import { startRoomTimer } from "@/lib/realtime/room-timer";
import type { FloatingReaction } from "@/lib/realtime/room-reactions";
import type { Session } from "@/app/(tools)/planning-poker/types";
import { QR_QUIET_ZONE } from "@/lib/qr/encode";
import { decodeQr, rasterisePath, stripQuietZone } from "../qr/decoder";

const CODE = "ABCDEFGHJKMN";
const FP = "abcdefghijklmnopqrstuv";
/** The view loads on first open (next/dynamic); `beforeAll` warms its import. */
const LAZY = { timeout: 10_000 };
/** Each test may wait for the lazy view: longer than the 5 s default. */
const SLOW = { timeout: 20_000 };

function readQr(svg: Element): string {
  const side = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  return decodeQr(stripQuietZone(rasterisePath(d, side), QR_QUIET_ZONE)).text;
}

function Host({
  tool = "quick-vote" as const,
  reactions = [] as FloatingReaction[],
  children = <p>3 of 5 answered</p>,
  shell = true,
}: {
  tool?: "quick-vote" | "retro" | "planning-poker";
  reactions?: FloatingReaction[];
  children?: React.ReactNode;
  /** Mount the shell's PresentationController (the tool page). */
  shell?: boolean;
}) {
  const big = useBigScreen();
  const [timer] = useState(() => startRoomTimer(120, Date.now()));
  return (
    <LiveAnnouncerProvider>
      {/* The shell's page area: the big screen makes it inert. */}
      <main id="main-content">
        <VisitorRoomChip
          tool={tool}
          code={CODE}
          memberCount={6}
          isHost
          linkFragment={tool === "quick-vote" ? `#k=${FP}` : undefined}
          onBigScreen={big.show}
        />
        <button type="button">End room</button>
      </main>
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
      {shell && <PresentationController />}
    </LiveAnnouncerProvider>
  );
}

beforeAll(async () => {
  await import("@/components/collab/room-big-screen-view");
}, 30_000);

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

describe("the room on the big screen", SLOW, () => {
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
      within(view).getByText("Scan the QR code with a phone camera to join.")
    ).toBeInTheDocument();
    // Nothing on it to press, and focus on its heading.
    expect(within(view).queryAllByRole("button")).toHaveLength(0);
    expect(heading).toHaveFocus();
  });

  it("is a dialog over an inert page, and gives focus back to Big screen on Exit and on Escape", async () => {
    render(<Host />);
    const page = document.getElementById("main-content")!;
    const opener = screen.getByRole("button", { name: "Big screen" });
    opener.focus();
    await openBigScreen();
    expect(screen.getByRole("dialog", { name: "Live Quick Vote" })).toBe(
      document.querySelector("[data-big-screen]")
    );
    // The room's own controls underneath can't be reached.
    expect(page).toHaveAttribute("inert");
    fireEvent.click(screen.getByRole("button", { name: /Exit presentation/ }));
    expect(page).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();

    opener.focus();
    await openBigScreen();
    expect(page).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector("[data-big-screen]")).toBeNull();
    expect(page).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });

  it("closes when the browser leaves fullscreen, even with no shell around it", async () => {
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreen,
    });
    try {
      render(<Host shell={false} />);
      await openBigScreen();
      act(() => {
        fullscreen = document.documentElement;
        document.dispatchEvent(new Event("fullscreenchange"));
      });
      expect(document.querySelector("[data-big-screen]")).not.toBeNull();
      // A phone's back gesture, with no Exit presentation button to press.
      act(() => {
        fullscreen = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      });
      expect(document.querySelector("[data-big-screen]")).toBeNull();
      expect(usePresentation.getState().presenting).toBe(false);
    } finally {
      delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
    }
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
    const shown = Array.from(band?.querySelectorAll<HTMLElement>("[data-reaction]") ?? []);
    expect(shown).toHaveLength(2);
    expect(band?.textContent).toBe("👍❤️");
    // Still while presenting: spread up the band by lane, not rising.
    expect(shown.map((s) => s.style.bottom)).toEqual(["10%", "30%"]);
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

  it("draws a show room's frame large, with none of a phone's controls (Team Mixer's find box)", async () => {
    const frame: ShowFrame = {
      n: 1,
      kind: "groups",
      at: Date.now(),
      supported: true,
      payload: {
        title: "",
        round: 1,
        unit: "group",
        groups: [
          { name: "Oak", people: ["Ana", "Bo"] },
          { name: "", people: ["Cy", "Dee"] },
        ],
        sitOut: [],
      },
    };
    render(
      <Host>
        <ShowBigScreenFrame tool="team-mixer" frame={frame} />
      </Host>
    );
    await openBigScreen();
    const view = document.querySelector("[data-big-screen]") as HTMLElement;
    expect(within(view).getByText("Round 1: 2 groups")).toBeInTheDocument();
    expect(within(view).getByRole("list", { name: "Oak" })).toHaveTextContent("AnaBo");
    // Nothing on the big screen is a control: no box to type in, no status line for one.
    expect(within(view).queryByLabelText("Find your name")).toBeNull();
    expect(within(view).queryByRole("searchbox")).toBeNull();
    expect(within(view).queryByRole("textbox")).toBeNull();
  });
});

describe("the Poker room bar's Big screen", () => {
  const session: Session = {
    roomCode: CODE,
    sessionName: "Planning",
    scale: ["1", "2", "3"],
    scaleType: "fibonacci",
    host: "Hana",
    hostId: "host_00000000000",
    participants: [{ id: "host_00000000000", name: "Hana", vote: null }],
    stories: [],
    currentStoryIdx: 0,
    revealed: false,
  };

  it("is offered only where the page asks for it (the tool page, inside the shell)", () => {
    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PokerRoomBar code={CODE} memberCount={2} isHost session={session} />
      </LiveAnnouncerProvider>
    );
    // A promoted visitor host on /join has no shell, so no way out on a phone.
    expect(screen.queryByRole("button", { name: "Big screen" })).toBeNull();
    rerender(
      <LiveAnnouncerProvider>
        <PokerRoomBar code={CODE} memberCount={2} isHost session={session} bigScreen />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("button", { name: "Big screen" })).toBeInTheDocument();
  });

  it("stays off in the visitor room the /join page mounts", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src/app/(tools)/planning-poker/visitor-poker-room.tsx"),
      "utf8"
    );
    const bar = src.match(/<PokerRoomBar[\s\S]*?\/>/)?.[0] ?? "";
    expect(bar).not.toBe("");
    expect(bar).not.toMatch(/\bbigScreen\b/);
  });
});
