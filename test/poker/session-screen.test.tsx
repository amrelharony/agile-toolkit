import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { Session } from "@/app/(tools)/planning-poker/types";

/**
 * SessionScreen behaviour shared by the owner and guest clients: any voted
 * value can be accepted as the estimate (not just numbers), leaving a
 * session with stories asks first, and the voting deck is a keyboard-
 * operable radiogroup.
 */

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));

// Keep each motion.<tag> as its real element (the deck must be buttons),
// minus the animation-only props.
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

const HOST = "host-1";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: HOST,
    participants: [{ id: HOST, name: "Scrum Master", vote: null }],
    stories: [{ id: "s1", title: "Login page", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

function Harness({
  initial,
  onLeave = () => {},
  leaveClearsSession,
}: {
  initial: Session;
  onLeave?: () => void;
  leaveClearsSession?: boolean;
}) {
  const [session, setSession] = useState(initial);
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) => setSession((s) => updater(s))}
      localParticipantId={HOST}
      isHost
      onLeave={onLeave}
      leaveClearsSession={leaveClearsSession}
    />
  );
}

function acceptButtons(): string[] {
  const label = screen.getByText("Accept estimate:");
  return within(label.parentElement as HTMLElement)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

describe("accepting an estimate", () => {
  it("offers T-shirt sizes and commits the chosen one", () => {
    render(
      <Harness
        initial={makeSession({
          scale: ["XS", "S", "M", "L", "XL", "XXL", "?"],
          scaleType: "tshirt",
          revealed: true,
          participants: [
            { id: HOST, name: "Scrum Master", vote: "M" },
            { id: "p2", name: "Dev", vote: "S" },
            { id: "p3", name: "QA", vote: "?" },
          ],
        })}
      />
    );

    // Scale order, never the "?" card.
    expect(acceptButtons()).toEqual(["S", "M"]);

    fireEvent.click(screen.getByRole("button", { name: "M" }));

    expect(screen.getByText(/Final estimate/).textContent).toContain("M");
    const queueItem = screen.getByRole("button", { name: /Login page/ });
    expect(queueItem.textContent).toContain("M");
  });

  it("sorts numbers ascending and skips the non-estimate cards", () => {
    render(
      <Harness
        initial={makeSession({
          revealed: true,
          participants: [
            { id: HOST, name: "Scrum Master", vote: "8" },
            { id: "p2", name: "Dev", vote: "13" },
            { id: "p3", name: "QA", vote: "3" },
            { id: "p4", name: "PO", vote: "∞" },
            { id: "p5", name: "UX", vote: "8" },
          ],
        })}
      />
    );
    expect(acceptButtons()).toEqual(["3", "8", "13"]);
  });
});

describe("leaving the session", () => {
  it("asks before leaving a session that has stories", () => {
    const onLeave = vi.fn();
    render(<Harness initial={makeSession()} onLeave={onLeave} leaveClearsSession />);

    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    expect(onLeave).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Leave this session?" });
    expect(dialog).toHaveTextContent(/cleared from this browser/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Leave session" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the confirmation is cancelled", () => {
    const onLeave = vi.fn();
    render(<Harness initial={makeSession()} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    const dialog = screen.getByRole("dialog", { name: "Leave this session?" });
    expect(dialog).toHaveTextContent(/leave the live room/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("leaves at once when there are no stories yet", () => {
    const onLeave = vi.fn();
    render(<Harness initial={makeSession({ stories: [] })} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole("button", { name: "Leave Session" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("voting deck", () => {
  it("is a radiogroup of focusable radio cards", () => {
    const session = makeSession({
      participants: [
        { id: HOST, name: "Scrum Master", vote: null },
        { id: "p2", name: "Dev", vote: "5" },
      ],
    });
    render(<Harness initial={session} />);

    const group = screen.getByRole("radiogroup", { name: "Your vote" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(session.scale);
    for (const r of radios) expect(r.tagName).toBe("BUTTON");
    // Other participants' face-down cards are not controls.
    expect(screen.getAllByRole("radio")).toHaveLength(session.scale.length);

    // One tab stop: the first card until a vote is cast…
    expect(radios[0]).toHaveAttribute("tabindex", "0");
    expect(radios[1]).toHaveAttribute("tabindex", "-1");

    fireEvent.click(screen.getByRole("radio", { name: "5" }));
    const five = screen.getByRole("radio", { name: "5" });
    expect(five).toHaveAttribute("aria-checked", "true");
    // …then the checked card.
    expect(five).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "1" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/You voted/).textContent).toContain("5");
  });

  it("moves focus between cards with the arrow keys", () => {
    render(<Harness initial={makeSession()} />);
    const radios = screen.getAllByRole("radio");

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[1]);

    fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radios[0]);

    // Wraps around, and Home/End jump to the ends.
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radios[radios.length - 1]);
    fireEvent.keyDown(radios[radios.length - 1], { key: "Home" });
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0], { key: "End" });
    expect(document.activeElement).toBe(radios[radios.length - 1]);

    // Moving focus never casts a vote.
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("names the icon-only story buttons", () => {
    render(<Harness initial={makeSession()} />);
    expect(screen.getByRole("button", { name: "Previous story" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next story" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add story" })).toBeInTheDocument();
  });
});
