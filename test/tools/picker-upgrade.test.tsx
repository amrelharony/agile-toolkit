import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Picker: a wheel over the team or a saved list (weights, everyone once,
 * names that leave once picked), a fair rotation for standing roles with its
 * history, quick dice, coins and numbers, team and sprint names with a
 * shortlist (AI suggestions with the built-in lists standing in), a live
 * room spin, example data, a Markdown export and Undo on every removal.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }));
const cheerSpy = vi.hoisted(() => vi.fn());
const logSpy = vi.hoisted(() => vi.fn());
const room = vi.hoisted(() => ({ show: vi.fn(() => true), live: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/picker",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: cheerSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => (
    <pre data-testid="export-md" hidden>
      {markdown}
    </pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: logSpy, toolRunId: "run" }),
}));
// The room kit is tested on its own: here a stand-in that is live at once
// and hands the tool's controls a `show` to watch.
vi.mock("@/components/collab/show-room", () => ({
  ShowRoomHost: ({ children }: { children?: (r: unknown) => ReactNode }) =>
    room.live ? (
      <div data-testid="room">{children?.({ status: "live", show: room.show })}</div>
    ) : (
      <button type="button">Show on everyone&apos;s phones</button>
    ),
}));

import { PickerClient } from "@/app/(tools)/picker/picker-client";
import { EXAMPLE_LIST_ID, buildExample } from "@/app/(tools)/picker/example";
import {
  editedEntries,
  validateCount,
  validateListDraft,
  validateRoleDraft,
} from "@/app/(tools)/picker/forms";
import { toMarkdown } from "@/app/(tools)/picker/markdown";
import { quickVoteHref } from "@/app/(tools)/picker/names-panel";
import { PICKER_INITIAL, normalizePickerState, sourceEntries } from "@/lib/picker/model";
import { readPicker, usePickerStore } from "@/lib/picker/store";
import { PICKER_ACTIONS } from "@/lib/history/event-actions";
import { parseWheelFrame } from "@/lib/realtime/show-room/frames/picker";
import { SPIN_MS } from "@/lib/picker/wheel";
import { isExampleId } from "@/components/tool-frame/example-data";

const TEAM = ["Amina", "Ben", "Chloé"].map((name, i) => ({ id: `m${i}`, name }));

const setReducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

async function mount() {
  const view = render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <PickerClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

const undoOf = (label: string) => {
  const call = [...toastSpy.mock.calls].reverse().find((c) => c[0] === label);
  expect(call, `toast "${label}"`).toBeTruthy();
  return () => act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
};
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }));
const polite = () => screen.getByTestId("live-polite");
const result = () => screen.getByTestId("picker-result");
const spinButton = () => screen.getByRole("button", { name: /^Spin$/ });

beforeEach(() => {
  localStorage.clear();
  usePickerStore.setState({ ...PICKER_INITIAL });
  useWorkspaceStore.setState({ teamMembers: TEAM });
  toastSpy.mockClear();
  cheerSpy.mockClear();
  logSpy.mockClear();
  room.show.mockClear();
  room.show.mockImplementation(() => true);
  room.live = false;
  setReducedMotion(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the wheel", () => {
  it("spins the team and says who came up: saved, logged without names, cheered", async () => {
    await mount();
    expect(screen.getByRole("img", { name: "Wheel with 3 names" })).toBeInTheDocument();
    fireEvent.click(spinButton());
    const name = result().textContent!;
    expect(["Amina", "Ben", "Chloé"]).toContain(name);
    await waitFor(() => expect(polite()).toHaveTextContent(`${name}.`));
    expect(readPicker().recent[0]).toMatchObject({
      kind: "wheel",
      result: name,
      detail: "Team (3 people)",
    });
    expect(logSpy).toHaveBeenCalledWith(PICKER_ACTIONS.PICK_RAN, {
      mode: "wheel",
      size: 3,
      source: "team",
      room: false,
    });
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(name);
    expect(cheerSpy).toHaveBeenCalledWith("picker", "result");
  });

  it("turns for about 2.5 s before it lands, when motion is allowed", async () => {
    expect(SPIN_MS).toBeGreaterThanOrEqual(2000);
    expect(SPIN_MS).toBeLessThanOrEqual(3000);
    setReducedMotion(false);
    vi.useFakeTimers();
    await mount();
    fireEvent.click(spinButton());
    expect(screen.getByRole("button", { name: /Spinning/ })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(readPicker().recent).toHaveLength(0);
    // Still turning just before the end.
    act(() => vi.advanceTimersByTime(SPIN_MS - 100));
    expect(readPicker().recent).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Spinning/ })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(150));
    expect(readPicker().recent).toHaveLength(1);
    expect(result().textContent).toBe(readPicker().recent[0].result);
  });

  it("gives everyone a turn before anyone twice, then celebrates the round", async () => {
    await mount();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      fireEvent.click(spinButton());
      seen.push(result().textContent!);
    }
    expect([...seen].sort()).toEqual(["Amina", "Ben", "Chloé"]);
    expect(cheerSpy).toHaveBeenLastCalledWith("picker", "milestone");
    expect(
      screen.getByText(/Everyone has had a turn. The next spin starts round 2./)
    ).toBeInTheDocument();
  });

  it("says in words who has had a turn, not only by greying the slice", async () => {
    await mount();
    fireEvent.click(spinButton());
    const name = result().textContent!;
    expect(screen.getByText(`Had a turn: ${name}.`)).toBeInTheDocument();
    expect(screen.getByText("(had a turn)")).toBeInTheDocument();
  });

  it("keeps the team's round while the wheel spins a list and comes back, even by arrow keys", async () => {
    usePickerStore.setState({
      lists: [
        {
          id: "l1",
          name: "Lunch",
          entries: [
            { name: "Pizza", weight: 1 },
            { name: "Tacos", weight: 1 },
          ],
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    await mount();
    fireEvent.click(screen.getByRole("switch", { name: "Take a name off after it's picked" }));
    fireEvent.click(spinButton());
    const name = result().textContent!;
    const team = screen.getByRole("radio", { name: "Team" });
    fireEvent.keyDown(team, { key: "ArrowRight" });
    expect(readPicker().source).toBe("l1");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Lunch" }), { key: "ArrowLeft" });
    expect(readPicker().source).toBe("team");
    expect(readPicker().progress.removed).toEqual([name.toLowerCase()]);
    expect(screen.getByText(`Off the wheel: ${name}.`)).toBeInTheDocument();
  });

  it("lets anyone come up again with everyone once off", async () => {
    await mount();
    fireEvent.click(screen.getByRole("switch", { name: "Everyone once" }));
    expect(readPicker().everyoneOnce).toBe(false);
    expect(screen.getByText("Team (3 people). Anyone can come up.")).toBeInTheDocument();
  });

  it("takes a picked name off the wheel and puts it back, with Undo", async () => {
    await mount();
    fireEvent.click(screen.getByRole("switch", { name: "Take a name off after it's picked" }));
    fireEvent.click(spinButton());
    const name = result().textContent!;
    expect(readPicker().progress.removed).toEqual([name.toLowerCase()]);
    expect(screen.getByText(`Off the wheel: ${name}.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Put ${name} back` }));
    expect(readPicker().progress.removed).toEqual([]);
    undoOf("Put everyone back on the wheel")();
    expect(readPicker().progress.removed).toEqual([name.toLowerCase()]);
  });

  it("weighs a name up and down, between 1 and 5, and says the new weight", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More weight for Ben" }));
    expect(readPicker().teamWeights).toEqual({ ben: 2 });
    await waitFor(() => expect(polite()).toHaveTextContent("Ben: weight 2."));
    const less = screen.getByRole("button", { name: "Less weight for Ben" });
    fireEvent.click(less);
    expect(readPicker().teamWeights).toEqual({});
    // At the limit it stays focusable, and does nothing.
    expect(less).toHaveAttribute("aria-disabled", "true");
    expect(less).not.toBeDisabled();
    fireEvent.click(less);
    expect(readPicker().teamWeights).toEqual({});
  });

  it("offers the Team page and the example when there's nobody to spin", async () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    await mount();
    expect(screen.getByText(/No names to spin yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your team" })).toHaveAttribute("href", "/team");
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(readPicker().source).toBe(EXAMPLE_LIST_ID);
    expect(screen.getByRole("img", { name: "Wheel with 7 names" })).toBeInTheDocument();
    expect(screen.getByText(/Example data/)).toBeInTheDocument();
  });
});

describe("saved lists", () => {
  const newList = () => fireEvent.click(screen.getByRole("button", { name: "New list" }));
  const fill = (name: string, names: string) => {
    fireEvent.change(screen.getByLabelText(/List name/), { target: { value: name } });
    fireEvent.change(screen.getByRole("textbox", { name: /^Names/ }), { target: { value: names } });
  };

  it("opens the form on its first field and goes back to New list after", async () => {
    await mount();
    newList();
    expect(screen.getByLabelText(/List name/)).toHaveFocus();
    fill("Lunch spots", "Pizza\nTacos");
    fireEvent.click(screen.getByRole("button", { name: "Save list" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "New list" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Edit Lunch spots" }));
    expect(screen.getByLabelText(/List name/)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Lunch spots" })).toHaveFocus()
    );
  });

  it("checks the list before saving, then spins it", async () => {
    await mount();
    newList();
    fireEvent.click(screen.getByRole("button", { name: "Save list" }));
    expect(screen.getByText("Give the list a name.")).toBeInTheDocument();
    expect(screen.getByText("Add at least two names, one per line.")).toBeInTheDocument();
    fill("Retro topics", "Wins\nPuzzles\nwins\nIdeas");
    fireEvent.click(screen.getByRole("button", { name: "Save list" }));
    const list = readPicker().lists[0];
    expect(list.entries.map((e) => e.name)).toEqual(["Wins", "Puzzles", "Ideas"]);
    expect(readPicker().source).toBe(list.id);
    expect(screen.getByRole("img", { name: "Wheel with 3 names" })).toBeInTheDocument();
    expect(logSpy).toHaveBeenCalledWith(PICKER_ACTIONS.LIST_SAVED, { size: 3, edited: false });
  });

  it("deletes a list with Undo, and the wheel goes back to the team", async () => {
    await mount();
    newList();
    fill("Lunch spots", "Pizza\nTacos");
    fireEvent.click(screen.getByRole("button", { name: "Save list" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Lunch spots" }));
    expect(readPicker().lists).toEqual([]);
    expect(readPicker().source).toBe("team");
    // The row went: focus lands on New list, not the page.
    await waitFor(() => expect(screen.getByRole("button", { name: "New list" })).toHaveFocus());
    undoOf("Deleted “Lunch spots”")();
    expect(readPicker().lists.map((l) => l.name)).toEqual(["Lunch spots"]);
  });

  it("switches the wheel between the team and a list", async () => {
    await mount();
    newList();
    fill("Lunch spots", "Pizza\nTacos");
    fireEvent.click(screen.getByRole("button", { name: "Save list" }));
    fireEvent.click(screen.getByRole("radio", { name: "Team" }));
    expect(readPicker().source).toBe("team");
    expect(screen.getByRole("img", { name: "Wheel with 3 names" })).toBeInTheDocument();
  });
});

describe("rotating roles", () => {
  it("gives a role to the fairest person, then moves on, logging no role name", async () => {
    await mount();
    tab("Roles");
    const card = screen.getByRole("article", { name: "Facilitator" });
    fireEvent.click(within(card).getByRole("button", { name: "Give Amina the role" }));
    expect(readPicker().roleTurns.map((t) => t.person)).toEqual(["Amina"]);
    await waitFor(() => expect(polite()).toHaveTextContent("Amina is the Facilitator."));
    expect(within(card).getByRole("button", { name: "Give Ben the role" })).toBeInTheDocument();
    expect(logSpy).toHaveBeenCalledWith(PICKER_ACTIONS.ROTATION_ADVANCED, {
      role: "role-facilitator",
      people: 3,
    });
  });

  it("never gives a second role to someone who has one today while others are free", async () => {
    await mount();
    tab("Roles");
    const facilitator = screen.getByRole("article", { name: "Facilitator" });
    fireEvent.click(within(facilitator).getByRole("button", { name: "Give Amina the role" }));
    const scribe = screen.getByRole("article", { name: "Scribe" });
    expect(within(scribe).getByRole("button", { name: "Give Ben the role" })).toBeInTheDocument();
    expect(within(scribe).getByText("(Facilitator today)")).toBeInTheDocument();
  });

  it("gives out every role at once to different people, with Undo", async () => {
    await mount();
    tab("Roles");
    expect(
      screen.getByText(
        (_, el) => el?.tagName === "P" && /^Not given out today:/.test(el.textContent ?? "")
      )
    ).toHaveTextContent("Amina as Facilitator, Ben as Scribe, Chloé as Timekeeper.");
    fireEvent.click(screen.getByRole("button", { name: "Give out 3 roles" }));
    expect(readPicker().roleTurns.map((t) => t.person)).toEqual(["Amina", "Ben", "Chloé"]);
    expect(screen.queryByRole("button", { name: /Give out/ })).toBeNull();
    undoOf("Gave out 3 roles")();
    expect(readPicker().roleTurns).toEqual([]);
  });

  it("rotates among the team, whatever the wheel spins", async () => {
    usePickerStore.setState({ shortlist: ["Nile", "Amazon"] });
    await mount();
    tab("Names");
    fireEvent.click(screen.getByRole("button", { name: "Spin the shortlist" }));
    expect(readPicker().source).not.toBe("team");
    tab("Roles");
    const card = screen.getByRole("article", { name: "Facilitator" });
    expect(within(card).getByRole("button", { name: "Give Amina the role" })).toBeInTheDocument();
    expect(screen.getByText(/^From Team \(3 people\)\./)).toBeInTheDocument();
  });

  it("rotates among a saved list when it's chosen for the roles", async () => {
    usePickerStore.setState({
      lists: [
        {
          id: "l1",
          name: "Guests",
          entries: [
            { name: "Gus", weight: 1 },
            { name: "Hana", weight: 1 },
          ],
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    await mount();
    tab("Roles");
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Who takes the roles" })).getByRole("radio", {
        name: "Guests",
      })
    );
    expect(readPicker().roleSource).toBe("l1");
    expect(readPicker().source).toBe("team");
    const card = screen.getByRole("article", { name: "Scribe" });
    expect(within(card).getByRole("button", { name: "Give Gus the role" })).toBeInTheDocument();
  });

  it("skips someone away today without counting it, and brings them back", async () => {
    await mount();
    tab("Roles");
    const card = screen.getByRole("article", { name: "Scribe" });
    fireEvent.click(within(card).getByRole("button", { name: "Skip Amina, away today" }));
    expect(within(card).getByRole("button", { name: "Give Ben the role" })).toBeInTheDocument();
    expect(readPicker().roleTurns).toEqual([]);
    const toggle = within(card).getByRole("button", { name: "Away today: Amina" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("button", { name: "Away today: Ben" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(toggle);
    expect(within(card).getByRole("button", { name: "Give Amina the role" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("takes a turn back out of the history with Undo", async () => {
    await mount();
    tab("Roles");
    const card = screen.getByRole("article", { name: "Timekeeper" });
    fireEvent.click(within(card).getByRole("button", { name: "Give Amina the role" }));
    fireEvent.click(within(card).getByRole("button", { name: /Remove Amina's turn/ }));
    expect(readPicker().roleTurns).toEqual([]);
    undoOf("Removed Amina's turn")();
    expect(readPicker().roleTurns).toHaveLength(1);
  });

  it("adds a role after checking it, and removes one with its turns, with Undo", async () => {
    await mount();
    tab("Roles");
    fireEvent.change(screen.getByLabelText("Another role"), { target: { value: "scribe" } });
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));
    expect(screen.getByText("That role is already on the list.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Another role"), { target: { value: "Demo driver" } });
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));
    expect(readPicker().roles.map((r) => r.name)).toContain("Demo driver");

    const card = screen.getByRole("article", { name: "Scribe" });
    fireEvent.click(within(card).getByRole("button", { name: "Give Amina the role" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the Scribe role" }));
    expect(readPicker().roles.map((r) => r.name)).not.toContain("Scribe");
    expect(readPicker().roleTurns).toEqual([]);
    // Its card went: focus moves to the next role's heading.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Timekeeper" })).toHaveFocus());
    undoOf("Removed the Scribe role")();
    expect(readPicker().roles.map((r) => r.name)).toEqual([
      "Facilitator",
      "Scribe",
      "Timekeeper",
      "Demo driver",
    ]);
    expect(readPicker().roleTurns).toHaveLength(1);
  });
});

describe("quick answers", () => {
  it("rolls the chosen dice and keeps the roll", async () => {
    await mount();
    tab("Quick");
    fireEvent.click(screen.getByRole("radio", { name: "2 dice" }));
    fireEvent.click(screen.getByRole("radio", { name: "20 sides" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll 2d20" }));
    const pick = readPicker().recent[0];
    expect(pick).toMatchObject({ kind: "dice", detail: "2d20" });
    expect(pick.result).toMatch(/^\d+ \+ \d+ = \d+$/);
    expect(
      within(screen.getByTestId("picker-quick-result")).getByText(pick.result)
    ).toBeInTheDocument();
    expect(logSpy).toHaveBeenCalledWith(PICKER_ACTIONS.PICK_RAN, { mode: "dice" });
  });

  it("flips a coin and picks a letter", async () => {
    await mount();
    tab("Quick");
    fireEvent.click(screen.getByRole("button", { name: "Flip a coin" }));
    expect(["Heads", "Tails"]).toContain(readPicker().recent[0].result);
    fireEvent.click(screen.getByRole("button", { name: "Pick a letter" }));
    expect(readPicker().recent[0].result).toMatch(/^[A-Z]$/);
  });

  it("checks a number range before picking in it", async () => {
    await mount();
    tab("Quick");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick a number" }));
    expect(screen.getByText("The highest number must be at least the lowest.")).toBeInTheDocument();
    expect(readPicker().recent).toEqual([]);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Pick a number" }));
    const n = Number(readPicker().recent[0].result);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(12);
  });
});

describe("team and sprint names", () => {
  it("draws themed names, shortlists them with Undo, and points to Quick Vote", async () => {
    usePickerStore.setState({ shortlist: ["Volga"] });
    await mount();
    tab("Names");
    fireEvent.change(screen.getByLabelText("How many names"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Draw names" }));
    const list = screen.getByRole("region", { name: /Planets and moons/ });
    const adds = within(list).getAllByRole("button", { name: /^Shortlist: / });
    expect(adds).toHaveLength(3);
    fireEvent.click(within(list).getByRole("button", { name: "Shortlist all 3" }));
    expect(readPicker().shortlist).toHaveLength(4);
    const link = screen.getByRole("link", { name: "Open Quick Vote" });
    expect(link.getAttribute("href")).toBe(quickVoteHref(readPicker().shortlist));
    expect(screen.getByText(/paste it as the options of a poll/)).toBeInTheDocument();
    // Accepted suggestions come back off with Undo; what was there stays.
    undoOf("Shortlisted 3 names")();
    expect(readPicker().shortlist).toEqual(["Volga"]);
  });

  it("shortlists one suggestion at a time, with Undo", async () => {
    await mount();
    tab("Names");
    fireEvent.change(screen.getByLabelText("How many names"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Draw names" }));
    const list = screen.getByRole("region", { name: /Planets and moons/ });
    const [first] = within(list).getAllByRole("button", { name: /^Shortlist: / });
    const name = first.getAttribute("aria-label")!.replace(/^Shortlist: /, "");
    fireEvent.click(first);
    expect(readPicker().shortlist).toEqual([name]);
    undoOf(`Shortlisted ${name}`)();
    expect(readPicker().shortlist).toEqual([]);
  });

  it("refuses a count out of range", async () => {
    await mount();
    tab("Names");
    fireEvent.change(screen.getByLabelText("How many names"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Draw names" }));
    expect(screen.getByText("Pick a whole number from 1 to 20.")).toBeInTheDocument();
  });

  it("suggests names on the team's own theme without AI when AI is off", async () => {
    await mount();
    tab("Names");
    fireEvent.change(screen.getByLabelText("Or your own theme"), {
      target: { value: "Space missions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Suggest names" }));
    expect(await screen.findByText(/Suggested without AI/)).toBeInTheDocument();
    const region = screen.getByRole("region", { name: /Names on “Space missions”/ });
    expect(within(region).getAllByRole("button", { name: /^Shortlist: / }).length).toBe(8);
  });

  it("takes a name off the shortlist with Undo, and spins the shortlist", async () => {
    usePickerStore.setState({ shortlist: ["Nile", "Amazon", "Volga"] });
    await mount();
    tab("Names");
    fireEvent.click(screen.getByRole("button", { name: "Take Volga off the shortlist" }));
    expect(readPicker().shortlist).toEqual(["Nile", "Amazon"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Take Amazon off the shortlist" })).toHaveFocus()
    );
    undoOf("Took Volga off the shortlist")();
    expect(readPicker().shortlist).toEqual(["Nile", "Amazon", "Volga"]);
    fireEvent.click(screen.getByRole("button", { name: "Spin the shortlist" }));
    expect(readPicker().lists[0]).toMatchObject({ name: "Name shortlist" });
    expect(screen.getByRole("img", { name: "Wheel with 3 names" })).toBeInTheDocument();
    // The Names tab went: focus is on the wheel's Spin button.
    await waitFor(() => expect(spinButton()).toHaveFocus());
  });

  it("puts back a hand-edited shortlist list it replaced, with Undo", async () => {
    usePickerStore.setState({
      shortlist: ["Nile", "Amazon"],
      lists: [
        {
          id: "l1",
          name: "Name shortlist",
          entries: [
            { name: "Nile", weight: 3 },
            { name: "Rhine", weight: 1 },
          ],
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    await mount();
    tab("Names");
    fireEvent.click(screen.getByRole("button", { name: "Spin the shortlist" }));
    // Nile keeps its weight; Rhine, not on the shortlist, went.
    expect(readPicker().lists[0].entries).toEqual([
      { name: "Nile", weight: 3 },
      { name: "Amazon", weight: 1 },
    ]);
    expect(readPicker().source).toBe("l1");
    undoOf("Put the shortlist on “Name shortlist”")();
    expect(readPicker().lists[0].entries.map((e) => e.name)).toEqual(["Nile", "Rhine"]);
    expect(readPicker().source).toBe("team");
  });
});

describe("the live room", () => {
  it("spins for the room: every phone gets the same names, winner and turn", async () => {
    room.live = true;
    await mount();
    fireEvent.click(
      within(screen.getByTestId("room")).getByRole("button", { name: "Spin for the room" })
    );
    expect(room.show).toHaveBeenCalledTimes(1);
    const [kind, payload] = room.show.mock.calls[0] as unknown as [string, unknown];
    expect(kind).toBe("wheel");
    const frame = parseWheelFrame(payload)!;
    expect(frame.names).toEqual(["Amina", "Ben", "Chloé"]);
    expect(frame.names[frame.winner]).toBe(result().textContent);
    expect(logSpy).toHaveBeenCalledWith(
      PICKER_ACTIONS.PICK_RAN,
      expect.objectContaining({ room: true })
    );
  });

  it("says so when the room can't show the spin, and still counts it here", async () => {
    room.live = true;
    room.show.mockImplementation(() => false);
    await mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Spin for the room" })[0]);
    expect(screen.getByText(/couldn't be shown in the room/)).toBeInTheDocument();
    expect(readPicker().recent).toHaveLength(1);
  });

  it("shows a role pick on everyone's screen as a text frame", async () => {
    room.live = true;
    await mount();
    tab("Roles");
    const card = screen.getByRole("article", { name: "Facilitator" });
    fireEvent.click(within(card).getByRole("button", { name: "Give Amina the role" }));
    fireEvent.click(within(card).getByRole("button", { name: "Show Amina on everyone's screen" }));
    expect(room.show).toHaveBeenLastCalledWith("text", {
      title: "Amina",
      body: "Facilitator today",
    });
  });
});

describe("history, example, export and reset", () => {
  it("clears the recent picks with Undo", async () => {
    await mount();
    fireEvent.click(spinButton());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(readPicker().recent).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Recent picks" })).toHaveFocus()
    );
    undoOf("Cleared the recent picks")();
    expect(readPicker().recent).toHaveLength(1);
  });

  it("clears only the example's rows", async () => {
    usePickerStore.setState({ shortlist: ["Nile"] });
    useWorkspaceStore.setState({ teamMembers: [] });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const s = readPicker();
    expect(s.lists).toEqual([]);
    expect(s.roleTurns).toEqual([]);
    expect(s.recent).toEqual([]);
    expect(s.shortlist).toEqual(["Nile"]);
    expect(s.source).toBe("team");
  });

  it("exports the wheel, the roles and the picks as Markdown", async () => {
    await mount();
    fireEvent.click(spinButton());
    const md = screen.getByTestId("export-md").textContent!;
    expect(md).toContain("## Wheel: Team");
    expect(md).toContain("| Amina | 1 |");
    expect(md).toContain("### Facilitator");
    expect(md).toContain("## Recent picks");
  });

  it("resets the whole Picker after asking, with Undo", async () => {
    usePickerStore.setState({ shortlist: ["Nile"] });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Reset the Picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Picker" }));
    expect(readPicker().shortlist).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith(PICKER_ACTIONS.PICKER_RESET, {});
    undoOf("Reset the Picker")();
    expect(readPicker().shortlist).toEqual(["Nile"]);
  });
});

describe("pure parts", () => {
  it("checks a list: name, two names, the caps, a name already used", () => {
    const lists = [{ id: "l1", name: "Topics", entries: [], updatedAt: "" }];
    expect(validateListDraft({ name: "topics", names: "A\nB" }, lists)).toMatchObject({
      errors: { name: "Another list has that name. Pick a different one." },
    });
    expect(validateListDraft({ name: "Team", names: "A\nB" }, [])).toMatchObject({ ok: false });
    expect(validateListDraft({ name: "Topics", names: "A\nB" }, lists, "l1")).toEqual({
      ok: true,
      values: { name: "Topics", names: ["A", "B"] },
    });
    const many = Array.from({ length: 42 }, (_, i) => `N${i}`).join("\n");
    expect(validateListDraft({ name: "Big", names: many }, [])).toMatchObject({
      errors: { names: "A wheel holds up to 40 names. Take 2 out." },
    });
    expect(validateListDraft({ name: "Long", names: `${"x".repeat(41)}\nB` }, [])).toMatchObject({
      errors: { names: "Keep each name to 40 characters." },
    });
  });

  it("checks a role and a count, and keeps weights through an edit", () => {
    expect(validateRoleDraft({ name: " " }, [])).toMatchObject({ ok: false });
    expect(validateRoleDraft({ name: "Note taker" }, [])).toEqual({
      ok: true,
      values: { name: "Note taker" },
    });
    expect(validateCount("0", 20)).toMatchObject({ ok: false });
    expect(validateCount("7", 20)).toEqual({ ok: true, values: 7 });
    expect(editedEntries([{ name: "Gus", weight: 3 }], ["gus", "New"])).toEqual([
      { name: "gus", weight: 3 },
      { name: "New", weight: 1 },
    ]);
  });

  it("builds an example of example rows only, with Gus weighted double", () => {
    const ex = buildExample(new Date("2026-11-12T10:00:00Z"));
    expect(isExampleId(ex.list.id)).toBe(true);
    expect(ex.roleTurns.every((t) => isExampleId(t.id))).toBe(true);
    expect(ex.recent.every((r) => isExampleId(r.id))).toBe(true);
    expect(ex.list.entries.find((e) => e.name === "Gus")?.weight).toBe(2);
    // The example's turns make Dev the next facilitator.
    const state = normalizePickerState({
      lists: [ex.list],
      source: ex.list.id,
      roleSource: ex.list.id,
      roleTurns: ex.roleTurns,
    });
    expect(sourceEntries(state, [])).toHaveLength(7);
    const md = toMarkdown(
      { state, roster: [], today: "2026-11-12" },
      new Date("2026-11-12T10:00:00Z")
    );
    expect(md).toContain("From Aurora squad.");
    expect(md).toContain("### Facilitator\n\nNext up: Dev.");
    expect(md).toContain("| Gus | 2 | Yes |");
    expect(md).toContain("| Amina | 1 | 3 weeks ago |");
  });
});
