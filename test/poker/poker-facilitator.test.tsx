import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Planning Poker facilitator mode: in a LOCAL session the facilitator seats
 * the team (from the roster or by name), records each person's vote face
 * down, or passes the screen round with "Next voter". Hidden votes survive
 * a reload in a payload `isValidSession` still accepts, and none of it
 * appears in a live room.
 */

const h = vi.hoisted(() => {
  const makeChannel = () => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        cb?.("SUBSCRIBED");
        return channel;
      }),
      track: vi.fn(async () => "ok"),
      untrack: vi.fn(async () => "ok"),
      unsubscribe: vi.fn(async () => "ok"),
      send: vi.fn(async () => "ok"),
      presenceState: vi.fn(() => ({})),
    };
    return channel;
  };
  return {
    auth: null as Partial<AuthContextValue> | null,
    realtime: false,
    client: {
      channel: vi.fn<(name: string, opts?: unknown) => ReturnType<typeof makeChannel>>(() =>
        makeChannel()
      ),
      removeChannel: vi.fn(async () => "ok"),
    },
    undo: null as null | { label: string; apply: () => void; revert: () => void },
  };
});

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));
vi.mock("@/lib/realtime/supabase-client", () => ({
  isRealtimeAvailable: () => h.realtime,
  getSupabaseClient: () => (h.realtime ? h.client : null),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {}, emitRtEvent: () => {} }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    h.undo = a;
    a.apply();
  },
}));
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

import { PlanningPokerClient } from "@/app/(tools)/planning-poker/planning-poker-client";
import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";
import { LOCAL_SESSION_KEY, loadLocalSession } from "@/app/(tools)/planning-poker/local-session";
import { isValidSession, type Session } from "@/app/(tools)/planning-poker/types";
import {
  MAX_PARTICIPANTS,
  addPlayers,
  allVotesIn,
  nextVoter,
  removePlayer,
  restorePlayer,
  seatPlayers,
  voteFor,
} from "@/app/(tools)/planning-poker/players";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

function roster(...names: string[]) {
  useWorkspaceStore.setState({
    teamMembers: names.map((name, i) => ({ id: `tm-${i}`, name })),
  });
}

beforeEach(() => {
  h.auth = { status: "anonymous", user: null };
  h.realtime = false;
  h.undo = null;
  h.client.channel.mockClear();
  window.localStorage.clear();
  useWorkspaceStore.setState({ teamMembers: [], pokerEstimationLogs: [] });
});

function renderClient() {
  return render(
    <LiveAnnouncerProvider>
      <PlanningPokerClient />
    </LiveAnnouncerProvider>
  );
}

/** A visitor's browser-only session with one story and the roster seated. */
function startWithTeam(...names: string[]) {
  roster(...names);
  const view = renderClient();
  fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
  fireEvent.change(screen.getByPlaceholderText("Story title…"), {
    target: { value: "Checkout flow" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add story" }));
  if (names.length > 0) fireEvent.click(screen.getByRole("button", { name: /^Add team/ }));
  return view;
}

function voteFor_(name: string, value: string) {
  fireEvent.click(screen.getByRole("button", { name: `Vote for ${name}` }));
  const deck = screen.getByRole("radiogroup", { name: `${name}'s vote` });
  fireEvent.click(within(deck).getByRole("radio", { name: value }));
}

/** Where `value` is on screen other than as a card in a voting deck. */
function shownOutsideDecks(value: string): HTMLElement[] {
  return screen.queryAllByText(value).filter((el) => !el.closest('[role="radiogroup"]'));
}

const liveText = () => screen.getByTestId("live-polite").textContent;
const stored = (): Session => JSON.parse(window.localStorage.getItem(LOCAL_SESSION_KEY)!);

describe("seating the team", () => {
  it("adds everyone on the roster once, and anyone else by name", () => {
    startWithTeam("Priya", "Lee", "Scrum Master");
    // The facilitator is already at the table under the lobby's default name.
    for (const name of ["Priya", "Lee"]) {
      expect(screen.getByRole("button", { name: `Vote for ${name}` })).toBeInTheDocument();
    }
    expect(stored().participants.map((p) => p.name)).toEqual(["Scrum Master", "Priya", "Lee"]);
    expect(screen.getByRole("button", { name: "Team added" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "  Jo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));
    expect(screen.getByRole("button", { name: "Vote for Jo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Player name")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "priya" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));
    expect(screen.getByRole("alert")).toHaveTextContent("priya is already at the table.");
    expect(stored().participants).toHaveLength(4);
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (0/4)");
  });

  it("links to the Team page when there's no roster, and still takes typed names", async () => {
    startWithTeam();
    expect(await screen.findByRole("link", { name: "Set up your team" })).toHaveAttribute(
      "href",
      "/team"
    );
    expect(screen.queryByRole("button", { name: /^Add team/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Ana" } });
    fireEvent.submit(screen.getByLabelText("Player name"));
    expect(screen.getByRole("button", { name: "Vote for Ana" })).toBeInTheDocument();
  });

  it("removes a player, and Undo seats them again with their face-down vote", () => {
    startWithTeam("Priya", "Lee");
    voteFor_("Lee", "8");
    fireEvent.click(screen.getByRole("button", { name: "Remove Lee" }));
    expect(screen.queryByRole("button", { name: "Vote for Lee" })).toBeNull();
    expect(h.undo?.label).toBe("Removed Lee");
    // The facilitator's own seat can't be removed.
    expect(screen.queryByRole("button", { name: "Remove Scrum Master" })).toBeNull();

    act(() => h.undo!.revert());
    expect(stored().participants.map((p) => [p.name, p.vote])).toEqual([
      ["Scrum Master", null],
      ["Priya", null],
      ["Lee", "8"],
    ]);
  });
});

describe("hidden votes", () => {
  it("records each person's card face down: voted ✓, never the value", () => {
    startWithTeam("Priya", "Lee");
    fireEvent.click(screen.getByRole("button", { name: "Vote for Priya" }));
    const deck = screen.getByRole("radiogroup", { name: "Priya's vote" });
    // The deck takes focus so the keyboard lands in it.
    expect(within(deck).getByRole("radio", { name: "1" })).toHaveFocus();
    fireEvent.click(within(deck).getByRole("radio", { name: "13" }));

    // The deck closes and focus goes back to Priya's button.
    expect(screen.queryByRole("radiogroup", { name: "Priya's vote" })).toBeNull();
    expect(screen.getByRole("button", { name: "Vote for Priya" })).toHaveFocus();
    expect(screen.getAllByText("voted")).toHaveLength(1);
    expect(shownOutsideDecks("13")).toEqual([]);
    expect(screen.queryAllByRole("button", { name: /13/ })).toEqual([]);
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (1/3)");
    expect(stored().participants.find((p) => p.name === "Priya")?.vote).toBe("13");

    // Opening her deck again doesn't give her card away.
    fireEvent.click(screen.getByRole("button", { name: "Vote for Priya" }));
    const again = screen.getByRole("radiogroup", { name: "Priya's vote" });
    expect(within(again).queryByRole("radio", { checked: true })).toBeNull();
    expect(screen.getByText("Picking a card replaces it.")).toBeInTheDocument();
    // Playing the same card again keeps it (a toggle would tell the room).
    fireEvent.click(within(again).getByRole("radio", { name: "13" }));
    expect(stored().participants.find((p) => p.name === "Priya")?.vote).toBe("13");

    // The facilitator's own vote works as before.
    const mine = screen.getByRole("radiogroup", { name: "Your vote" });
    fireEvent.click(within(mine).getByRole("radio", { name: "5" }));
    expect(within(mine).getByRole("radio", { name: "5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("You voted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (2/3)");
  });

  it("announces when every vote is in", async () => {
    startWithTeam("Priya");
    voteFor_("Priya", "3");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
        name: "3",
      })
    );
    await waitFor(() => expect(liveText()).toBe("All votes in"));
    expect(screen.getByText(/all votes in, face down until revealed/)).toBeInTheDocument();
  });
});

describe("passing the screen round", () => {
  it("steps through everyone who hasn't voted, showing only names and the deck", async () => {
    startWithTeam("Priya", "Lee", "Ana");
    voteFor_("Lee", "5");

    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    // The facilitator hasn't voted, so they go first; their own deck is put away.
    expect(screen.getByRole("heading", { name: "Scrum Master's turn" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Your vote" })).toBeNull();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Scrum Master's vote" })).getByRole("radio", {
        name: "3",
      })
    );
    expect(screen.getByText("Up next:")).toHaveTextContent("Up next: Priya");
    expect(screen.getByRole("button", { name: "Next voter" })).toHaveFocus();
    expect(shownOutsideDecks("3")).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    expect(screen.getByRole("heading", { name: "Priya's turn" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip Priya" }));
    expect(screen.getByText("skipped")).toBeInTheDocument();
    // Lee voted already, so Ana is next; Priya goes to the back of the line.
    expect(screen.getByText("Up next:")).toHaveTextContent("Up next: Ana");

    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Ana's vote" })).getByRole("radio", {
        name: "8",
      })
    );
    expect(screen.getByText("Up next:")).toHaveTextContent("Up next: Priya");

    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Priya's vote" })).getByRole("radio", {
        name: "13",
      })
    );
    expect(screen.getByText("All votes in")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next voter" })).toBeNull();
    await waitFor(() => expect(liveText()).toBe("All votes in"));
    for (const v of ["5", "8", "13"]) expect(shownOutsideDecks(v)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("radiogroup", { name: "Your vote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (4/4)");
    expect(stored().participants.map((p) => p.vote)).toEqual(["3", "13", "5", "8"]);
  });

  it("can stop part way, keeping the votes so far", () => {
    startWithTeam("Priya", "Lee");
    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip Scrum Master" }));
    fireEvent.click(screen.getByRole("button", { name: "Next voter" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Priya's vote" })).getByRole("radio", {
        name: "2",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop passing" }));
    expect(screen.getByRole("radiogroup", { name: "Your vote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (1/3)");
  });
});

describe("reveal and vote again", () => {
  it("shows every value with the consensus, then clears the hidden votes and keeps the round", async () => {
    startWithTeam("Priya", "Lee");
    voteFor_("Priya", "5");
    voteFor_("Lee", "5");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Your vote" })).getByRole("radio", {
        name: "5",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));

    expect(screen.getByText("Full consensus")).toBeInTheDocument();
    await waitFor(() => expect(liveText()).toBe("Votes revealed"));
    expect(screen.queryByRole("button", { name: /^Vote for/ })).toBeNull();
    // Each player's value is on the table now (card and participant list).
    expect(shownOutsideDecks("5").length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole("button", { name: "Vote Again" }));
    expect(screen.getByRole("list", { name: "Voting rounds" })).toHaveTextContent(
      "Round 1: 5 · 5 · 5"
    );
    expect(screen.queryByText("voted")).toBeNull();
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (0/3)");
    expect(stored().participants.every((p) => p.vote === null)).toBe(true);

    voteFor_("Priya", "3");
    voteFor_("Lee", "13");
    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
    expect(screen.getByText("Discussion needed")).toBeInTheDocument();
    const accept = screen.getByText("Accept estimate:").parentElement as HTMLElement;
    fireEvent.click(within(accept).getByRole("button", { name: "13" }));
    const story = stored().stories[0];
    expect(story.finalEstimate).toBe("13");
    expect(story.rounds).toEqual([
      ["5", "5", "5"],
      ["3", "13"],
    ]);
  });
});

describe("persistence", () => {
  it("keeps hidden votes through a reload, in a payload isValidSession accepts", () => {
    const first = startWithTeam("Priya", "Lee");
    voteFor_("Priya", "13");
    voteFor_("Lee", "21");

    const payload: unknown = JSON.parse(window.localStorage.getItem(LOCAL_SESSION_KEY)!);
    expect(isValidSession(payload)).toBe(true);
    expect(loadLocalSession()?.participants.map((p) => [p.name, p.vote])).toEqual([
      ["Scrum Master", null],
      ["Priya", "13"],
      ["Lee", "21"],
    ]);
    // No new fields: the hidden votes are ordinary participant votes.
    for (const p of (payload as Session).participants) {
      expect(Object.keys(p).sort()).toEqual(["id", "name", "vote"]);
    }
    first.unmount();

    renderClient();
    expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    expect(screen.getAllByText("voted")).toHaveLength(2);
    expect(shownOutsideDecks("13")).toEqual([]);
    expect(shownOutsideDecks("21")).toEqual([]);
    expect(screen.getByRole("button", { name: /^Reveal/ })).toHaveTextContent("Reveal (2/3)");

    fireEvent.click(screen.getByRole("button", { name: /^Reveal/ }));
    expect(shownOutsideDecks("13").length).toBeGreaterThan(0);
    expect(shownOutsideDecks("21").length).toBeGreaterThan(0);
  });
});

describe("live rooms", () => {
  it("never offers facilitator controls in the owner's live room", () => {
    h.realtime = true;
    h.auth = { status: "authenticated", user: owner };
    roster("Priya", "Lee");
    renderClient();
    fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
    fireEvent.change(screen.getByPlaceholderText("Story title…"), {
      target: { value: "Checkout flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));

    expect(screen.getByText(/Room:/)).toBeInTheDocument();
    expect(h.client.channel).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Add team/ })).toBeNull();
    expect(screen.queryByLabelText("Player name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next voter" })).toBeNull();
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
  });

  it("leaves a guest's screen as it was", () => {
    const session: Session = {
      roomCode: "ABC234",
      sessionName: "Sprint Planning",
      scale: ["1", "2", "3", "5", "8"],
      scaleType: "fibonacci",
      host: "Host",
      hostId: "host-1",
      participants: [
        { id: "host-1", name: "Host", vote: "•" },
        { id: "guest-1", name: "Guest", vote: null },
      ],
      stories: [{ id: "s1", title: "Search products", finalEstimate: null }],
      currentStoryIdx: 0,
      revealed: false,
    };
    render(
      <SessionScreen
        session={session}
        onUpdateSession={() => {}}
        localParticipantId="guest-1"
        isHost={false}
        onLeave={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /^Vote for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByText("voted")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Your vote" })).toBeInTheDocument();
  });
});

describe("players helpers", () => {
  const base = (): Session => ({
    roomCode: "ABC234",
    sessionName: "Sprint Planning",
    scale: ["1", "2", "3", "5", "8"],
    scaleType: "fibonacci",
    host: "Scrum Master",
    hostId: "me",
    participants: [{ id: "me", name: "Scrum Master", vote: null }],
    stories: [{ id: "s1", title: "Login", finalEstimate: null }],
    currentStoryIdx: 0,
    revealed: false,
  });
  let n = 0;
  const id = () => `p${++n}`;

  it("skips blanks and duplicates, trims names to the validator's cap, and stops at 100", () => {
    const long = "x".repeat(120);
    const { session, added } = addPlayers(
      base(),
      ["Priya", " priya ", "", "Scrum master", long],
      id
    );
    expect(added.map((p) => p.name)).toEqual(["Priya", "x".repeat(80)]);
    expect(isValidSession(session)).toBe(true);

    const crowd = Array.from({ length: 150 }, (_, i) => `Person ${i}`);
    const full = addPlayers(base(), crowd, id).session;
    expect(full.participants).toHaveLength(MAX_PARTICIPANTS);
    expect(isValidSession(full)).toBe(true);
    expect(seatPlayers(full, [{ id: "extra", name: "Extra", vote: null }])).toBe(full);
  });

  it("records a face-down vote only on the scale and before reveal", () => {
    const s = addPlayers(base(), ["Priya"], () => "priya").session;
    expect(voteFor(s, "priya", "5").participants[1].vote).toBe("5");
    expect(voteFor(s, "priya", "99")).toBe(s);
    expect(voteFor({ ...s, revealed: true }, "priya", "5").participants[1].vote).toBeNull();
    expect(voteFor(s, "nobody", "5")).toBe(s);
  });

  it("picks the next voter after the last, wrapping, with a skipped player last", () => {
    const people = [
      { id: "a", name: "A", vote: null },
      { id: "b", name: "B", vote: "3" },
      { id: "c", name: "C", vote: null },
    ];
    expect(nextVoter(people, null)?.id).toBe("a");
    expect(nextVoter(people, "a")?.id).toBe("c");
    expect(nextVoter(people, "c")?.id).toBe("a");
    expect(nextVoter([{ id: "a", name: "A", vote: null }], "a")?.id).toBe("a");
    expect(nextVoter([{ id: "a", name: "A", vote: "1" }], null)).toBeNull();
  });

  it("never removes the facilitator, and restores a player where they sat", () => {
    const s = addPlayers(base(), ["Priya", "Lee"], id).session;
    expect(removePlayer(s, "me")).toBe(s);
    const lee = s.participants[2];
    const without = removePlayer(s, s.participants[1].id);
    expect(without.participants.map((p) => p.name)).toEqual(["Scrum Master", "Lee"]);
    expect(restorePlayer(without, s.participants[1], 1).participants).toEqual(s.participants);
    expect(restorePlayer(s, lee, 0)).toBe(s);
  });

  it("calls all votes in only with more than one person, all voted, before reveal", () => {
    const s = addPlayers(base(), ["Priya"], () => "priya").session;
    expect(allVotesIn(s)).toBe(false);
    const voted = voteFor(voteFor(s, "priya", "3"), "me", "5");
    expect(allVotesIn(voted)).toBe(true);
    expect(allVotesIn({ ...voted, revealed: true })).toBe(false);
    expect(allVotesIn(voteFor(base(), "me", "5"))).toBe(false);
  });
});
