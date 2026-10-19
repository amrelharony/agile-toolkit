import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { Session } from "@/app/(tools)/planning-poker/types";

/**
 * The Planning Poker story queue after adding: the host can edit a story's
 * title and description (Enter saves, Escape cancels, an emptied title
 * reverts) and delete it with Undo. A pasted list adds one story per line,
 * and the title box keeps focus. Guests and participants get no Edit or
 * Delete control. Every change goes through `onUpdateSession`.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
const toasts = vi.hoisted(() => ({ info: [] as string[], error: [] as string[] }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(() => "t", {
    info: (m: string, o?: { description?: string }) => {
      toasts.info.push(`${m} ${o?.description ?? ""}`.trim());
      return "t";
    },
    error: (m: string) => {
      toasts.error.push(m);
      return "t";
    },
    success: () => "t",
    dismiss: () => {},
  }),
}));
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

const HOST = "host-1";
const GUEST = "guest-1";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: HOST,
    participants: [
      { id: HOST, name: "Scrum Master", vote: null },
      { id: GUEST, name: "Dev", vote: null },
    ],
    stories: [
      { id: "s1", title: "Login page", description: "Email and password", finalEstimate: "5" },
      { id: "s2", title: "Checkout", finalEstimate: null },
      { id: "s3", title: "Search", finalEstimate: null },
    ],
    currentStoryIdx: 1,
    revealed: false,
    ...overrides,
  };
}

let latest: Session;
const updates = { count: 0 };

function Harness({ initial, me = HOST }: { initial: Session; me?: string }) {
  const [session, setSession] = useState(initial);
  latest = session;
  return (
    <SessionScreen
      session={session}
      onUpdateSession={(updater) => {
        updates.count++;
        setSession((s) => updater(s));
      }}
      localParticipantId={me}
      isHost={me === session.hostId}
      onLeave={() => {}}
    />
  );
}

const titles = () => latest.stories.map((s) => s.title);
const queueRow = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

function paste(el: HTMLElement, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

beforeEach(() => {
  undo.last = null;
  toasts.info = [];
  toasts.error = [];
  updates.count = 0;
});

describe("Planning Poker: editing a story (host)", () => {
  it("saves the title and description through onUpdateSession", () => {
    render(<Harness initial={makeSession()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Login page" }));

    const title = screen.getByRole("textbox", { name: "Story title" });
    const description = screen.getByRole("textbox", { name: "Story description" });
    expect(title).toHaveFocus();
    expect(description).toHaveValue("Email and password");
    fireEvent.change(title, { target: { value: "Sign-in page" } });
    fireEvent.change(description, { target: { value: "Email, password and SSO" } });
    fireEvent.keyDown(title, { key: "Enter" });

    expect(latest.stories[0]).toEqual({
      id: "s1",
      title: "Sign-in page",
      description: "Email, password and SSO",
      finalEstimate: "5",
    });
    // The current story and the round are untouched.
    expect(latest.currentStoryIdx).toBe(1);
    expect(screen.getByRole("button", { name: "Edit Sign-in page" })).toHaveFocus();
  });

  it("editing the current story updates the heading too", () => {
    render(<Harness initial={makeSession()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Checkout" }));
    const title = screen.getByRole("textbox", { name: "Story title" });
    fireEvent.change(title, { target: { value: "Checkout with Apple Pay" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Checkout with Apple Pay" })).toBeInTheDocument();
  });

  it("Escape cancels", () => {
    const initial = makeSession();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Search" }));
    const title = screen.getByRole("textbox", { name: "Story title" });
    fireEvent.change(title, { target: { value: "Something else" } });
    fireEvent.keyDown(title, { key: "Escape" });

    expect(latest).toBe(initial);
    expect(updates.count).toBe(0);
    expect(screen.getByRole("button", { name: "Edit Search" })).toHaveFocus();
  });

  it("an emptied title reverts", () => {
    const initial = makeSession();
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Search" }));
    const title = screen.getByRole("textbox", { name: "Story title" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.keyDown(title, { key: "Enter" });

    expect(latest).toBe(initial);
    expect(queueRow("Search")).toBeInTheDocument();
  });
});

describe("Planning Poker: delete and Undo (host)", () => {
  it("removes a story and Undo puts it back in place", () => {
    render(<Harness initial={makeSession()} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Login page" }));
    expect(titles()).toEqual(["Checkout", "Search"]);
    expect(undo.last!.label).toBe("Deleted “Login page”");
    // Still estimating Checkout.
    expect(latest.stories[latest.currentStoryIdx].id).toBe("s2");

    act(() => undo.last!.revert());
    expect(titles()).toEqual(["Login page", "Checkout", "Search"]);
    expect(latest.stories[0]).toMatchObject({
      description: "Email and password",
      finalEstimate: "5",
    });
    expect(latest.stories[latest.currentStoryIdx].id).toBe("s2");
  });

  it("deleting the current story moves on, and Undo brings it back as current", () => {
    render(
      <Harness
        initial={makeSession({
          participants: [
            { id: HOST, name: "Scrum Master", vote: "3" },
            { id: GUEST, name: "Dev", vote: "5" },
          ],
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Checkout" }));
    expect(titles()).toEqual(["Login page", "Search"]);
    expect(latest.stories[latest.currentStoryIdx].id).toBe("s3");
    expect(latest.participants.every((p) => p.vote === null)).toBe(true);

    act(() => undo.last!.revert());
    expect(titles()).toEqual(["Login page", "Checkout", "Search"]);
    expect(latest.stories[latest.currentStoryIdx].id).toBe("s2");
  });
});

describe("Planning Poker: adding stories (host)", () => {
  it("Enter adds and the title box keeps focus", () => {
    render(<Harness initial={makeSession()} />);
    const input = screen.getByRole("textbox", { name: "New story title" });
    input.focus();
    fireEvent.change(input, { target: { value: "Payments" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(titles()).toEqual(["Login page", "Checkout", "Search", "Payments"]);
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("a pasted list adds one story per line", () => {
    render(<Harness initial={makeSession()} />);
    paste(
      screen.getByRole("textbox", { name: "New story title" }),
      "1. Reports\n2. Exports\n\nAudit log"
    );
    expect(titles()).toEqual([
      "Login page",
      "Checkout",
      "Search",
      "Reports",
      "Exports",
      "Audit log",
    ]);
    expect(latest.stories.slice(3).every((s) => s.finalEstimate === null)).toBe(true);
    expect(new Set(latest.stories.map((s) => s.id)).size).toBe(6);
    expect(screen.getByRole("button", { name: "Edit Audit log" })).toBeInTheDocument();
  });

  it("caps a long paste and says how many lines were left out", () => {
    render(<Harness initial={makeSession({ stories: [], currentStoryIdx: 0 })} />);
    const lines = Array.from({ length: 32 }, (_, i) => `Story ${i + 1}`).join("\n");
    paste(screen.getByRole("textbox", { name: "New story title" }), lines);
    expect(latest.stories).toHaveLength(30);
    expect(toasts.info).toEqual([
      "Added 30 stories. 2 more lines were left out. One paste adds up to 30.",
    ]);
  });
});

describe("Planning Poker: guests can't edit", () => {
  it("a guest sees the queue with no Edit or Delete, and no add box", () => {
    render(<Harness initial={makeSession()} me={GUEST} />);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "New story title" })).toBeNull();
    expect(queueRow("Login page")).toBeDisabled();
    fireEvent.click(queueRow("Checkout"));
    expect(screen.queryByRole("textbox", { name: "Story title" })).toBeNull();
    expect(updates.count).toBe(0);
  });
});
