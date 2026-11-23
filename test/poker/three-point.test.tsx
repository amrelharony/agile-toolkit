import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { Session } from "@/app/(tools)/planning-poker/types";

/**
 * Planning Poker's Three-point check: the host gets it after Reveal, on a
 * numeric deck with two or more estimates, inside Accept estimate. It starts
 * from the lowest, middle and highest vote and asks the host to change them;
 * "Use {card}" picks the card it rounds up to and Accept still commits it.
 * The check is logged in a one-screen session and never in a visitor room
 * (recordHistory off), and the "Estimate to accept" radios stay the same.
 */

const h = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
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
import { AcceptEstimate } from "@/app/(tools)/planning-poker/accept-estimate";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";

const HOST = "host-1";
const FIB = ["1", "2", "3", "5", "8", "13", "21", "?", "∞"];

const seats = (...votes: (string | null)[]) => [
  { id: HOST, name: "Scrum Master", vote: votes[0] ?? null },
  ...votes.slice(1).map((vote, i) => ({ id: `p${i}`, name: `Dev ${i + 1}`, vote })),
];

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: FIB,
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: HOST,
    participants: seats(null),
    stories: [{ id: "s1", title: "Refund a card payment", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
    ...overrides,
  };
}

let latest: Session;

function Harness({
  initial,
  isHost = true,
  recordHistory,
}: {
  initial: Session;
  isHost?: boolean;
  recordHistory?: boolean;
}) {
  const [session, setSession] = useState(initial);
  latest = session;
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) =>
        setSession((s) => {
          const next = updater(s);
          latest = next;
          return next;
        })
      }
      localParticipantId={isHost ? HOST : "p0"}
      isHost={isHost}
      onLeave={() => {}}
      recordHistory={recordHistory}
    />
  );
}

const toggle = () => screen.queryByRole("button", { name: "Three-point check" });
const open = () => fireEvent.click(toggle()!);
const acceptRadios = () =>
  within(screen.getByRole("radiogroup", { name: "Estimate to accept" })).getAllByRole("radio");

beforeEach(() => h.log.mockClear());

describe("where the check shows", () => {
  it("is absent before Reveal", () => {
    render(<Harness initial={makeSession({ participants: seats("3", "8") })} />);
    expect(toggle()).toBeNull();
  });

  it("shows for the host after Reveal, closed until asked", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Starts from the lowest/)).toBeNull();
    open();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "Starts from the lowest, middle and highest vote. Change them to the best, likely and worst case."
      )
    ).toBeInTheDocument();
  });

  it("is never shown to a guest", () => {
    render(
      <Harness
        initial={makeSession({ revealed: true, participants: seats("3", "8") })}
        isHost={false}
      />
    );
    expect(toggle()).toBeNull();
  });

  it("needs a numeric deck and two estimates", () => {
    const { unmount } = render(
      <Harness
        initial={makeSession({
          revealed: true,
          scale: ["XS", "S", "M", "L", "XL", "XXL", "?"],
          scaleType: "tshirt",
          participants: seats("S", "L"),
        })}
      />
    );
    expect(toggle()).toBeNull();
    unmount();
    render(<Harness initial={makeSession({ revealed: true, participants: seats("5", "?") })} />);
    expect(toggle()).toBeNull();
  });

  it("leaves the estimate radios as they were, the cases being selects outside them", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    const before = acceptRadios().map((r) => r.textContent);
    open();
    expect(acceptRadios().map((r) => r.textContent)).toEqual(before);
    expect(before).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
    const group = screen.getByRole("radiogroup", { name: "Estimate to accept" });
    expect(within(group).queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });
});

describe("the check", () => {
  it("starts from the votes and offers only the deck's numbers", () => {
    render(
      <Harness initial={makeSession({ revealed: true, participants: seats("3", "8", "?") })} />
    );
    open();
    expect(screen.getByLabelText("Best case")).toHaveValue("3");
    expect(screen.getByLabelText("Likely")).toHaveValue("5");
    expect(screen.getByLabelText("Worst case")).toHaveValue("8");
    const options = within(screen.getByLabelText("Likely")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
  });

  it("shows the expected size, its range and the card it rounds up to", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    open();
    fireEvent.change(screen.getByLabelText("Best case"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Worst case"), { target: { value: "13" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Expected 5.8 points, about 4 to 7.7: rounds up to 8."
    );
    expect(screen.getByRole("status")).toHaveTextContent(/talk about the risks before you accept/);
  });

  it("says which case is out of order, and offers no card", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    open();
    fireEvent.change(screen.getByLabelText("Worst case"), { target: { value: "2" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The worst case can't be smaller than the likely case."
    );
    expect(screen.getByLabelText("Worst case")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("Use 8 picks 8, and Accept commits it", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    expect(screen.getByRole("button", { name: "Accept 5" })).toBeInTheDocument();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Use 8" }));
    const group = screen.getByRole("radiogroup", { name: "Estimate to accept" });
    expect(within(group).getByRole("radio", { name: "8" })).toHaveAttribute("aria-checked", "true");
    // Nothing is saved until the host accepts.
    expect(latest.stories[0].finalEstimate).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept 8" }));
    expect(latest.stories[0].finalEstimate).toBe("8");
  });
});

describe("history", () => {
  it("logs the check in a one-screen session", () => {
    render(<Harness initial={makeSession({ revealed: true, participants: seats("3", "8") })} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Use 8" }));
    expect(h.log).toHaveBeenCalledWith(PLANNING_POKER_ACTIONS.THREE_POINT_USED, {
      card: "8",
      expected: 5.2,
    });
  });

  it("logs nothing in a visitor room", () => {
    render(
      <Harness
        initial={makeSession({ revealed: true, participants: seats("3", "8") })}
        recordHistory={false}
      />
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Use 8" }));
    expect(h.log).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Accept 8" })).toBeInTheDocument();
  });
});

describe("AcceptEstimate on its own", () => {
  it("has no check without votes, as other callers render it", () => {
    render(<AcceptEstimate deck={FIB} suggested="5" onAccept={() => {}} />);
    expect(toggle()).toBeNull();
  });

  it("reports the card and the expected size to its caller", () => {
    const used = vi.fn();
    render(
      <AcceptEstimate
        deck={FIB}
        suggested="5"
        onAccept={() => {}}
        votes={["3", "5", "8"]}
        onThreePointUsed={used}
      />
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Use 8" }));
    expect(used).toHaveBeenCalledWith("8", 31 / 6);
  });
});
