import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk, TeamMember } from "@/lib/stores/workspace-types";
import { useDockTimer } from "@/lib/timer/dock-timer";

/**
 * The Premortem upgrade (tool UX contract): several premortems, each named
 * and optionally about a release or epic; facilitated phases (write
 * silently, group duplicates, dot-vote, act); nothing saved blank or rated
 * by default; the list ranked by votes then likelihood × impact without
 * jumping mid-edit; and the top 3 sent to the Risk Register in one go,
 * with one Undo, never twice.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: logSpy }),
}));
const sonifySpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sonification/emit", () => ({ emit: sonifySpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));

import { PremortemClient } from "@/app/(tools)/premortem/premortem-client";
import type { Premortem, PremortemCause, PremortemState } from "@/app/(tools)/premortem/model";

const KEY = "agile-toolkit:premortem";
const RISK_KEY = "agile-toolkit:risk-register";

const cause = (id: string, text: string, over: Partial<PremortemCause> = {}): PremortemCause => ({
  id,
  text,
  ...over,
});
const pm = (over: Partial<Premortem> = {}): Premortem => ({
  id: "p1",
  title: "Checkout launch",
  scenario: "It shipped late and nobody uses it.",
  phase: "write",
  causes: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const seed = (...premortems: Premortem[]) =>
  localStorage.setItem(KEY, JSON.stringify({ version: 2, premortems } satisfies PremortemState));
const stored = (): PremortemState => JSON.parse(localStorage.getItem(KEY) ?? "{}");
const storedCauses = (id = "p1") => stored().premortems.find((p) => p.id === id)!.causes;
const riskBlob = (): Risk[] => JSON.parse(localStorage.getItem(RISK_KEY) ?? "[]");

const renderPremortem = () =>
  render(
    <TooltipProvider>
      <PremortemClient />
    </TooltipProvider>
  );

/** Click the Undo in the latest toast. */
const undoLast = () => {
  const [, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  act(() => opts.action.onClick());
};

const logged = (action: string) => logSpy.mock.calls.filter(([a]) => a === action);

const actList = () =>
  screen.getByRole("list", { name: "Causes, most votes first, then likelihood × impact" });
const voteList = () => screen.getByRole("list", { name: "Causes, most votes first" });
/** The causes' texts in the order on screen. */
const order = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);
const rowOf = (list: HTMLElement, text: string) =>
  within(list)
    .getAllByRole("listitem")
    .find((li) => li.querySelector("p")?.textContent === text)!;

beforeEach(() => {
  toastSpy.mockReset();
  logSpy.mockReset();
  sonifySpy.mockReset();
  localStorage.clear();
  window.history.replaceState(null, "", "/premortem");
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({
    risks: [],
    teamMembers: [],
    releaseReadinesses: [],
    epicRoadmaps: [],
  });
});

describe("Premortem: several premortems", () => {
  it("saves a new premortem only once it is named and its failure described", () => {
    useWorkspaceStore.setState({
      releaseReadinesses: [
        {
          id: "releaseReadiness:current",
          releases: [
            {
              id: "r1",
              name: "2.0",
              plannedDate: "2026-11-12",
              status: "planning",
              gates: {} as never,
            },
          ],
        },
      ],
    });
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Start premortem" }));
    expect(screen.getByText(/Name the premortem/)).toBeInTheDocument();
    expect(screen.getByText("Describe the failure you imagine.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    expect(localStorage.getItem(KEY)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "  Release 2.0  " } });
    fireEvent.change(screen.getByLabelText(/Imagined failure/), {
      target: { value: "It shipped and churn doubled." },
    });
    // "Not linked" is the explicit first choice; the release is picked.
    const forField = screen.getByLabelText("For");
    expect(forField).toHaveValue("");
    fireEvent.change(forField, { target: { value: "release:r1" } });
    fireEvent.click(screen.getByRole("button", { name: "Start premortem" }));

    const [p] = stored().premortems;
    expect(p).toMatchObject({
      title: "Release 2.0",
      scenario: "It shipped and churn doubled.",
      link: { kind: "release", id: "r1", name: "2.0" },
      phase: "write",
      causes: [],
    });
    expect(window.location.search).toBe(`?premortem=${p.id}`);
    expect(screen.getByRole("heading", { name: /Release 2\.0/ })).toBeInTheDocument();
    expect(screen.getByText("Release “2.0”")).toBeInTheDocument();
    expect(logged("premortem_started")).toHaveLength(1);
  });

  it("keeps premortems apart; the picker and a ?premortem= link choose which is open", () => {
    seed(
      pm({ id: "p2", title: "Newer", createdAt: "2026-10-10T00:00:00.000Z" }),
      pm({ id: "p1", title: "Older", causes: [cause("o1", "Old cause")] })
    );
    const { unmount } = renderPremortem();
    // The newest opens by default.
    expect(screen.getByRole("heading", { name: /Newer/ })).toBeInTheDocument();
    const field = screen.getByLabelText(/A reason it failed/);
    fireEvent.change(field, { target: { value: "Only in the newer one" } });
    fireEvent.submit(field.closest("form")!);
    expect(storedCauses("p2").map((c) => c.text)).toEqual(["Only in the newer one"]);
    expect(storedCauses("p1").map((c) => c.text)).toEqual(["Old cause"]);

    fireEvent.change(screen.getByLabelText("Premortem"), { target: { value: "p1" } });
    expect(screen.getByRole("heading", { name: /Older/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?premortem=p1");
    unmount();

    window.history.replaceState(null, "", "/premortem?premortem=p1");
    renderPremortem();
    expect(screen.getByRole("heading", { name: /Older/ })).toBeInTheDocument();
  });

  it("shows a release that was removed as removed, and keeps the link on edit", () => {
    seed(pm({ link: { kind: "release", id: "gone", name: "1.9" } }));
    renderPremortem();
    expect(screen.getByText("Release “1.9” (removed)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit the details of “Checkout launch”" }));
    expect(screen.getByLabelText("For")).toHaveValue("release:gone");
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Checkout v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(stored().premortems[0]).toMatchObject({
      title: "Checkout v2",
      link: { kind: "release", id: "gone", name: "1.9" },
    });
  });

  it("deletes a premortem with Undo, back in its slot", () => {
    seed(
      pm({ id: "p2", title: "Newer", createdAt: "2026-10-10T00:00:00.000Z" }),
      pm({ id: "p1", title: "Older" })
    );
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Delete the premortem “Newer”" }));
    expect(stored().premortems.map((p) => p.id)).toEqual(["p1"]);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted the premortem “Newer”");
    expect(screen.getByRole("heading", { name: /Older/ })).toBeInTheDocument();
    undoLast();
    expect(stored().premortems.map((p) => p.id)).toEqual(["p2", "p1"]);
  });
});

describe("Premortem: write silently", () => {
  it("never saves a blank cause; Enter adds one and keeps the field ready for the next", () => {
    seed(pm());
    renderPremortem();
    const field = screen.getByLabelText(/A reason it failed/);
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByText("Write the reason it failed.")).toBeInTheDocument();
    expect(storedCauses()).toEqual([]);

    fireEvent.change(field, { target: { value: "  The vendor API changed  " } });
    fireEvent.submit(field.closest("form")!);
    const [added] = storedCauses();
    // No ratings, no votes: nothing lands in a bucket by default.
    expect(added).toEqual({
      id: expect.any(String),
      text: "The vendor API changed",
      createdAt: expect.any(String),
    });
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(logged("cause_added")).toEqual([
      ["cause_added", { premortemId: "p1", causeId: added.id }],
    ]);
    expect(sonifySpy).toHaveBeenCalledWith("premortem", "cause-added");
  });

  it("hides the causes while people write, until shown or the phase moves on", () => {
    seed(pm({ causes: [cause("a", "Scope creep"), cause("b", "No tests")] }));
    renderPremortem();
    expect(
      screen.getByText("2 causes written, hidden so nobody anchors on another's idea.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Scope creep")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show causes" }));
    expect(screen.getByText("Scope creep")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide causes" }));
    expect(screen.queryByText("Scope creep")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next: Group" }));
    expect(screen.getByRole("list", { name: "Causes to group" })).toHaveTextContent("Scope creep");
    expect(stored().premortems[0].phase).toBe("group");
    expect(screen.getByRole("button", { name: /Step 2 of 4: Group/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
    expect(logged("phase_advanced")).toEqual([
      ["phase_advanced", { premortemId: "p1", from: "write", to: "group" }],
    ]);
  });

  it("starts the silent-writing timer only when a time is picked, and stops it after writing", () => {
    seed(pm());
    renderPremortem();
    expect(useDockTimer.getState().timer).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start a 5-minute silent writing timer" }));
    expect(useDockTimer.getState().timer).toMatchObject({
      label: "Premortem · silent writing",
      href: "/premortem",
      totalSeconds: 300,
      endsAt: expect.any(Number),
    });
    expect(screen.getByRole("timer")).toHaveTextContent("05:00");

    fireEvent.click(screen.getByRole("button", { name: "Pause the silent writing timer" }));
    expect(useDockTimer.getState().timer?.endsAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Step 2 of 4: Group/ }));
    expect(useDockTimer.getState().timer).toBeNull();
  });

  it("never replaces a timer another page put on the dock", () => {
    const ceremony = {
      label: "Retro",
      href: "/ceremony-timer",
      totalSeconds: 600,
      endsAt: Date.now() + 600_000,
      pausedRemaining: 600,
    };
    useDockTimer.setState({ timer: ceremony });
    seed(pm());
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Start a 3-minute silent writing timer" }));
    expect(
      screen.getByText("The “Retro” timer is on the dock. Stop it there first.")
    ).toBeInTheDocument();
    expect(useDockTimer.getState().timer).toEqual(ceremony);
    // Leaving the Write phase doesn't stop someone else's clock either.
    fireEvent.click(screen.getByRole("button", { name: "Next: Group" }));
    expect(useDockTimer.getState().timer).toEqual(ceremony);
  });
});

describe("Premortem: group", () => {
  const causes = [
    cause("a", "Scope creep", { votes: 1 }),
    cause("b", "Scope keeps growing"),
    cause("c", "No tests"),
  ];

  /** Open a cause's "Group with…" menu and pick the cause it repeats. */
  const groupWith = (source: string, target: string) => {
    fireEvent.keyDown(
      screen.getByRole("button", { name: `Group “${source}” with another cause` }),
      { key: "Enter" }
    );
    fireEvent.click(screen.getByRole("menuitem", { name: target }));
  };

  it("groups a duplicate into another with Undo, and Split brings it back", () => {
    seed(pm({ phase: "group", causes }));
    renderPremortem();
    groupWith("Scope keeps growing", "Scope creep");
    expect(storedCauses()).toEqual([
      cause("a", "Scope creep", { votes: 1, merged: [cause("b", "Scope keeps growing")] }),
      cause("c", "No tests"),
    ]);
    expect(screen.getByText("Also: “Scope keeps growing”")).toBeInTheDocument();
    expect(toastSpy.mock.calls[0][0]).toBe("Grouped “Scope keeps growing” with “Scope creep”");
    // The row the menu was on is gone: focus is on the cause it joined.
    expect(
      screen.getByRole("button", { name: "Split “Scope creep”: bring back 1 grouped cause" })
    ).toHaveFocus();
    undoLast();
    expect(storedCauses()).toEqual(causes);

    groupWith("No tests", "Scope keeps growing");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Split “Scope keeps growing”: bring back 1 grouped cause",
      })
    );
    expect(storedCauses()).toEqual([causes[0], causes[1], causes[2]]);
    // Split's button is gone with the group: focus stays on the cause.
    expect(
      screen.getByRole("button", { name: "Group “Scope keeps growing” with another cause" })
    ).toHaveFocus();
  });

  it("groups only when a cause is picked, never while the keyboard browses the choices", () => {
    seed(pm({ phase: "group", causes }));
    renderPremortem();
    // A menu button, not a select that changes on every arrow key.
    expect(screen.queryByRole("combobox", { name: /^Group/ })).toBeNull();
    const trigger = screen.getByRole("button", {
      name: "Group “Scope keeps growing” with another cause",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(storedCauses()).toEqual(causes);
    expect(toastSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(storedCauses()).toEqual(causes);
  });

  it("edits a cause in place", () => {
    seed(pm({ phase: "group", causes }));
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Edit “No tests”" }));
    const title = screen.getByRole("textbox", { name: "Cause" });
    fireEvent.change(title, { target: { value: "No automated tests" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(storedCauses()[2]).toEqual(cause("c", "No automated tests"));
    expect(screen.getByRole("button", { name: "Edit “No automated tests”" })).toHaveFocus();
  });

  it("deletes a cause with Undo", () => {
    seed(pm({ phase: "group", causes }));
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Scope keeps growing”" }));
    expect(storedCauses().map((c) => c.id)).toEqual(["a", "c"]);
    undoLast();
    expect(storedCauses().map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("Premortem: vote", () => {
  const causes = [
    cause("a", "Alpha"),
    cause("b", "Bravo"),
    cause("c", "Charlie"),
    cause("d", "Delta"),
  ];

  it("counts dots up and down, never below zero, without the list jumping mid-vote", () => {
    seed(pm({ phase: "vote", causes }));
    renderPremortem();
    expect(screen.getByRole("button", { name: "Take a vote from “Delta”" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add a vote to “Delta”" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a vote to “Delta”" }));
    fireEvent.click(screen.getByRole("button", { name: "Take a vote from “Delta”" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a vote to “Delta”" }));
    expect(storedCauses()[3]).toEqual(cause("d", "Delta", { votes: 2 }));
    expect(logged("cause_voted").at(-1)).toEqual([
      "cause_voted",
      { premortemId: "p1", causeId: "d", votes: 2 },
    ]);
    // Still where the facilitator was clicking.
    expect(order(voteList())).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(screen.getByText("Votes changed since the last sort.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(order(voteList())).toEqual(["Delta", "Alpha", "Bravo", "Charlie"]);
  });

  it("edits a cause's text without losing the description it doesn't show", () => {
    seed(
      pm({ phase: "vote", causes: [cause("a", "Alpha", { description: "Context", votes: 1 })] })
    );
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Edit “Alpha”" }));
    const title = screen.getByRole("textbox", { name: "Cause" });
    fireEvent.change(title, { target: { value: "Alpha, reworded" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(storedCauses()[0]).toEqual(
      cause("a", "Alpha, reworded", { description: "Context", votes: 1 })
    );
  });

  it("marks the top 3 and names a tie at the cut-off", () => {
    seed(
      pm({
        phase: "vote",
        causes: [
          cause("a", "Alpha", { votes: 3 }),
          cause("b", "Bravo", { votes: 2 }),
          cause("c", "Charlie", { votes: 1 }),
          cause("d", "Delta", { votes: 1 }),
        ],
      })
    );
    renderPremortem();
    expect(within(rowOf(voteList(), "Charlie")).getByText("Top 3")).toBeInTheDocument();
    expect(within(rowOf(voteList(), "Delta")).queryByText("Top 3")).toBeNull();
    expect(
      screen.getByText(/^“Charlie” and “Delta” tie at the cut-off\. Add a vote/)
    ).toBeInTheDocument();
  });

  it("clears every vote only after asking, and Undo puts them back", () => {
    const voted = [
      cause("a", "Alpha", { votes: 3, merged: [cause("e", "Echo", { votes: 1 })] }),
      cause("b", "Bravo", { votes: 2 }),
    ];
    seed(pm({ phase: "vote", causes: voted }));
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Clear votes" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/The 5 dots placed so far will be removed/)
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear votes" }));
    expect(storedCauses()).toEqual([
      cause("a", "Alpha", { merged: [cause("e", "Echo")] }),
      cause("b", "Bravo"),
    ]);
    expect(toastSpy.mock.calls[0][0]).toBe("Cleared the votes");
    undoLast();
    expect(storedCauses()).toEqual(voted);
  });

  it("takes dots per person as optional guidance, against the team's size", () => {
    useWorkspaceStore.setState({
      teamMembers: ["Ana", "Bo", "Cy", "Di"].map(
        (name, i) => ({ id: `m${i}`, name }) as TeamMember
      ),
    });
    seed(pm({ phase: "vote", causes: [cause("a", "Alpha", { votes: 2 })] }));
    renderPremortem();
    const dots = screen.getByLabelText(/Dots per person/);
    fireEvent.change(dots, { target: { value: "0" } });
    fireEvent.blur(dots);
    expect(screen.getByText("Use a whole number from 1 to 99.")).toBeInTheDocument();
    expect(stored().premortems[0].dotsPerPerson).toBeUndefined();
    fireEvent.change(dots, { target: { value: "3" } });
    fireEvent.blur(dots);
    expect(stored().premortems[0].dotsPerPerson).toBe(3);
    expect(screen.getByText("2 dots placed of 12 (4 people × 3).")).toBeInTheDocument();
  });
});

describe("Premortem: act", () => {
  it("shows Not scored, sorts the unscored last, and holds the order while rating", () => {
    seed(
      pm({
        phase: "act",
        causes: [
          cause("x", "Alpha"),
          cause("y", "Bravo", { likelihood: 2, impact: 2 }),
          cause("z", "Charlie", { likelihood: 3, impact: 3 }),
        ],
      })
    );
    renderPremortem();
    expect(order(actList())).toEqual(["Charlie", "Bravo", "Alpha"]);
    const alpha = rowOf(actList(), "Alpha");
    expect(within(alpha).getByText("Not scored")).toBeInTheDocument();

    fireEvent.click(
      within(within(alpha).getByRole("radiogroup", { name: "Likelihood" })).getByRole("radio", {
        name: "5",
      })
    );
    expect(within(alpha).getByText("Not scored")).toBeInTheDocument();
    fireEvent.click(
      within(within(alpha).getByRole("radiogroup", { name: "Impact" })).getByRole("radio", {
        name: "5",
      })
    );
    expect(within(alpha).getByText("L5 × I5 = 25")).toBeInTheDocument();
    expect(storedCauses()[0]).toEqual(cause("x", "Alpha", { likelihood: 5, impact: 5 }));
    expect(order(actList())).toEqual(["Charlie", "Bravo", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(order(actList())).toEqual(["Alpha", "Charlie", "Bravo"]);

    // Clearing a rating goes back to Not scored, not to a default.
    fireEvent.click(
      within(rowOf(actList(), "Alpha")).getByRole("button", { name: "Clear Impact" })
    );
    expect(storedCauses()[0]).toEqual(cause("x", "Alpha", { likelihood: 5 }));
  });

  it("records the preventive action and the owner, logging the action once", () => {
    seed(pm({ phase: "act", causes: [cause("a", "Alpha", { likelihood: 2, impact: 3 })] }));
    renderPremortem();
    const action = screen.getByRole("textbox", { name: "Preventive action for “Alpha”" });
    fireEvent.change(action, { target: { value: "Spike it" } });
    fireEvent.blur(action);
    fireEvent.change(action, { target: { value: "Spike it in sprint 1" } });
    fireEvent.blur(action);
    expect(storedCauses()[0].preventiveAction).toBe("Spike it in sprint 1");
    expect(logged("prevention_added")).toHaveLength(1);

    const owner = screen.getByRole("combobox", { name: "Owner of “Alpha”" });
    fireEvent.change(owner, { target: { value: "Priya" } });
    expect(storedCauses()[0].owner).toBeUndefined();
    fireEvent.blur(owner);
    expect(storedCauses()[0].owner).toBe("Priya");
  });

  it("won't send the top 3 until each is rated, then sends them with one toast and one Undo", () => {
    seed(
      pm({
        phase: "act",
        causes: [
          cause("a", "Alpha", { votes: 3, likelihood: 4, impact: 4, preventiveAction: "Spike" }),
          cause("b", "Bravo", { votes: 2, likelihood: 3, impact: 2, owner: "Bo" }),
          cause("c", "Charlie", { votes: 1 }),
          cause("d", "Delta", { likelihood: 5, impact: 5 }),
        ],
      })
    );
    renderPremortem();
    const send = screen.getByRole("button", { name: "Send the top 3 to the Risk Register" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Rate likelihood and impact for “Charlie” first.");
    // Delta isn't in the top 3, so its rating doesn't count; its own menu works.
    expect(screen.getByRole("button", { name: /^Send to… Charlie/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Send to… Delta/ })).toBeEnabled();

    const charlie = rowOf(actList(), "Charlie");
    for (const group of ["Likelihood", "Impact"]) {
      fireEvent.click(
        within(within(charlie).getByRole("radiogroup", { name: group })).getByRole("radio", {
          name: "2",
        })
      );
    }
    expect(send).toBeEnabled();
    fireEvent.click(send);

    const risks = riskBlob();
    expect(risks.map((r) => r.title).sort()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(risks.find((r) => r.title === "Alpha")).toMatchObject({
      probability: 4,
      impact: 4,
      mitigation: "Spike",
      sourceRef: { tool: "premortem", id: "a", doc: "p1" },
    });
    expect(useWorkspaceStore.getState().risks).toHaveLength(3);
    expect(storedCauses().map((c) => c.sentTo?.length ?? 0)).toEqual([1, 1, 1, 0]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Added 3 risks to the Risk Register");
    expect(logged("risks_sent")).toEqual([
      ["risks_sent", { premortemId: "p1", count: 3, causeIds: ["a", "b", "c"] }],
    ]);
    expect(sonifySpy).toHaveBeenCalledWith("premortem", "completed");
    expect(screen.getAllByRole("link", { name: "In the Risk Register" })).toHaveLength(3);
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("All of the top 3 are in the Risk Register.");

    undoLast();
    expect(riskBlob()).toEqual([]);
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(storedCauses().map((c) => c.sentTo ?? [])).toEqual([[], [], [], []]);
  });

  it("doesn't send a cause twice: one already in the register is skipped", () => {
    const existing = { id: "r-a", title: "Alpha" };
    localStorage.setItem(RISK_KEY, JSON.stringify([existing]));
    seed(
      pm({
        phase: "act",
        causes: [
          cause("a", "Alpha", {
            votes: 3,
            likelihood: 4,
            impact: 4,
            sentTo: [{ route: "risk", targetId: "r-a", at: "2026-10-01T00:00:00.000Z" }],
          }),
          cause("b", "Bravo", { votes: 2, likelihood: 3, impact: 2 }),
        ],
      })
    );
    renderPremortem();
    expect(within(rowOf(actList(), "Alpha")).getByRole("link", { name: "In the Risk Register" }));
    const send = screen.getByRole("button", { name: "Send the top 2 to the Risk Register" });
    expect(send).toHaveAccessibleDescription(
      "Adds 1 risk with its likelihood, impact and preventive action; 1 is there already."
    );
    fireEvent.click(send);
    expect(riskBlob().map((r) => r.title)).toEqual(["Bravo", "Alpha"]);
    expect(toastSpy.mock.calls[0][0]).toBe("Added 1 risk to the Risk Register");
  });

  it("counts a group whose duplicate is a risk already as sent, and doesn't send it again", () => {
    localStorage.setItem(RISK_KEY, JSON.stringify([{ id: "r-a", title: "Alpha" }]));
    seed(
      pm({
        phase: "act",
        causes: [
          cause("b", "Bravo", {
            votes: 3,
            likelihood: 3,
            impact: 3,
            merged: [
              cause("a", "Alpha", {
                votes: 1,
                sentTo: [{ route: "risk", targetId: "r-a", at: "2026-10-01T00:00:00.000Z" }],
              }),
            ],
          }),
          cause("c", "Charlie", { votes: 1, likelihood: 2, impact: 2 }),
        ],
      })
    );
    renderPremortem();
    const bravo = rowOf(actList(), "Bravo");
    expect(within(bravo).getByRole("link", { name: "In the Risk Register" })).toBeInTheDocument();
    // Its own menu would make a second risk for the same cause.
    expect(within(bravo).getByRole("button", { name: /^Send to… Bravo/ })).toBeDisabled();
    const send = screen.getByRole("button", { name: "Send the top 2 to the Risk Register" });
    expect(send).toHaveAccessibleDescription(
      "Adds 1 risk with its likelihood, impact and preventive action; 1 is there already."
    );
    fireEvent.click(send);
    expect(riskBlob().map((r) => r.title)).toEqual(["Charlie", "Alpha"]);
    expect(logged("risks_sent")).toEqual([
      ["risks_sent", { premortemId: "p1", count: 1, causeIds: ["c"] }],
    ]);
  });

  it("won't send a top cause that has no text, and says why", () => {
    seed(
      pm({
        phase: "act",
        causes: [
          // The old Add Cause saved blank causes; one with a description survives.
          cause("a", "", {
            description: "Something about vendors",
            votes: 2,
            likelihood: 3,
            impact: 3,
          }),
          cause("b", "Bravo", { votes: 1, likelihood: 3, impact: 3 }),
        ],
      })
    );
    renderPremortem();
    const send = screen.getByRole("button", { name: "Send the top 2 to the Risk Register" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Write the cause for “(untitled)” first.");
    fireEvent.click(send);
    expect(riskBlob()).toEqual([]);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("marks no cause Top 3 that nobody voted for or rated", () => {
    seed(
      pm({
        phase: "act",
        causes: [
          cause("al", "Alpha nobody voted"),
          cause("z", "Zebra", { votes: 3 }),
          cause("y", "Yak", { votes: 2 }),
        ],
      })
    );
    const { unmount } = renderPremortem();
    expect(within(rowOf(actList(), "Zebra")).getByText("Top 3")).toBeInTheDocument();
    expect(within(rowOf(actList(), "Alpha nobody voted")).queryByText("Top 3")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Send the top 2 to the Risk Register" })
    ).toHaveAccessibleDescription("Rate likelihood and impact for “Zebra” and “Yak” first.");
    unmount();

    // Nothing voted or rated: no top at all, and the room is asked to weigh in.
    seed(pm({ phase: "act", causes: [cause("a", "Alpha"), cause("b", "Bravo")] }));
    renderPremortem();
    expect(screen.queryByText("Top 3")).toBeNull();
    const send = screen.getByRole("button", { name: "Send the top 3 to the Risk Register" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(
      "Vote, or rate likelihood and impact, to find the top 3."
    );
    expect(
      screen.getByText(
        "Nothing separates the causes yet: vote, or rate likelihood and impact, to find the top 3."
      )
    ).toBeInTheDocument();
  });

  it("names whose ratings each row holds, and a reworded cause doesn't stale the order", () => {
    seed(
      pm({
        phase: "act",
        causes: [
          cause("a", "Alpha", { likelihood: 2, impact: 2 }),
          cause("b", "Bravo", { likelihood: 2, impact: 2 }),
        ],
      })
    );
    renderPremortem();
    const ratings = within(rowOf(actList(), "Alpha")).getByRole("group", {
      name: "Ratings for “Alpha”",
    });
    expect(within(ratings).getByRole("radiogroup", { name: "Likelihood" })).toBeInTheDocument();
    expect(within(ratings).getByRole("radiogroup", { name: "Impact" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit “Alpha”" }));
    const title = screen.getByRole("textbox", { name: "Cause" });
    fireEvent.change(title, { target: { value: "Zulu" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(order(actList())).toEqual(["Zulu", "Bravo"]);
    expect(screen.queryByText("Ratings changed since the last sort.")).toBeNull();
  });
});

describe("Premortem: the example", () => {
  it("never sends the example's causes to the real Risk Register", () => {
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const send = screen.getByRole("button", { name: "Send the top 3 to the Risk Register" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(
      "Example causes stay in the example: start a premortem of your own to send risks."
    );
    for (const b of screen.getAllByRole("button", { name: /^Send to…/ })) {
      expect(b).toBeDisabled();
    }
    fireEvent.click(send);
    expect(riskBlob()).toEqual([]);
    expect(useWorkspaceStore.getState().risks).toEqual([]);
    expect(sonifySpy).not.toHaveBeenCalledWith("premortem", "completed");
    expect(
      screen.getByText(/Example causes stay in the example/, { selector: "p.font-medium" })
    ).toBeInTheDocument();
  });
});

describe("Premortem: focus", () => {
  it("moves focus into the new-premortem form, back to its button on Cancel, and to the first cause on Start", () => {
    seed(pm());
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "New premortem" }));
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "New premortem" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "New premortem" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Release 3" } });
    fireEvent.change(screen.getByLabelText(/Imagined failure/), {
      target: { value: "It shipped broken." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start premortem" }));
    expect(screen.getByRole("heading", { name: /Release 3/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/A reason it failed/)).toHaveFocus();
  });

  it("returns focus to Edit details after Save, Cancel or Escape", () => {
    seed(pm());
    renderPremortem();
    const edit = () => screen.getByRole("button", { name: /^Edit the details of/ });
    fireEvent.click(edit());
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Checkout v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(edit()).toHaveFocus();

    fireEvent.click(edit());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(edit()).toHaveFocus();

    fireEvent.click(edit());
    fireEvent.keyDown(screen.getByLabelText(/^Name/), { key: "Escape" });
    expect(edit()).toHaveFocus();
  });

  it("puts focus on the current step when the last phase leaves no Next button", () => {
    seed(pm({ phase: "vote", causes: [cause("a", "Alpha", { votes: 1 })] }));
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Next: Act" }));
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Step 4 of 4: Act/ })).toHaveFocus();
  });

  it("tells the writers one reason at a time", () => {
    seed(pm());
    renderPremortem();
    expect(screen.getByLabelText(/A reason it failed/)).toHaveAccessibleDescription(
      /^One reason at a time: Enter adds it/
    );
  });
});

describe("Premortem: the silent-writing clock", () => {
  it("keeps its controls on the page when another premortem is opened", () => {
    seed(
      pm({ id: "p2", title: "Newer", createdAt: "2026-10-10T00:00:00.000Z" }),
      pm({ id: "p1", title: "Older", phase: "act", causes: [cause("a", "Alpha")] })
    );
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Start a 3-minute silent writing timer" }));
    fireEvent.change(screen.getByLabelText("Premortem"), { target: { value: "p1" } });
    expect(screen.getByRole("heading", { name: /Older/ })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("03:00");
    // Outside Write it only shows a clock that is running: no Start buttons.
    expect(screen.queryByRole("button", { name: /^Start a \d+-minute/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop the silent writing timer" }));
    expect(useDockTimer.getState().timer).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("keeps its controls when the premortem being written is deleted", () => {
    seed(pm());
    renderPremortem();
    fireEvent.click(screen.getByRole("button", { name: "Start a 5-minute silent writing timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the premortem “Checkout launch”" }));
    expect(screen.getByRole("timer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop the silent writing timer" }));
    expect(useDockTimer.getState().timer).toBeNull();
  });
});
