import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { STANDUP_ACTIONS } from "@/lib/history/event-actions";

/**
 * Standup gap-filling: the roster box, name canonicalisation on submit, the
 * Today / History / Blockers tabs, the resolved flag across a re-submit and
 * the CSV / weekly / day digests. (Submit gating, Clear + Undo, the example
 * and Send to are covered by the other standup-*.test.tsx files.)
 */

const spies = vi.hoisted(() => ({
  log: vi.fn(),
  exports: {} as Record<
    string,
    {
      clipboardText?: string;
      csvData?: { headers: string[]; rows: (string | number)[][] };
      markdown?: string;
    }
  >,
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: {
    filename: string;
    clipboardText?: string;
    csvData?: { headers: string[]; rows: (string | number)[][] };
    markdown?: string;
  }) => {
    spies.exports[props.filename] = props;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log }),
}));

import { StandupClient } from "@/app/(tools)/standup/standup-client";

const TODAY = todayLocalISO();
const HOUR = 3_600_000;

function entry(id: string, member: string, extra: Partial<StandupEntry> = {}): StandupEntry {
  return {
    id,
    member,
    date: TODAY,
    yesterday: "y",
    today: "t",
    blockers: "",
    timestamp: Date.now(),
    ...extra,
  };
}

const ws = () => useWorkspaceStore.getState();
const entries = () => ws().standupEntries ?? [];
const roster = () => (ws().teamMembers ?? []).map((m) => m.name);
/** A Today-tab stat tile's number, found by its caption. */
const stat = (label: string) =>
  screen.getAllByText(label).find((el) => el.tagName === "P")?.previousElementSibling?.textContent;

function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function submit(
  member: { pick?: string; type?: string },
  fields: { today?: string; blockers?: string }
) {
  if (member.pick !== undefined) {
    fireEvent.change(screen.getByLabelText("Team member"), { target: { value: member.pick } });
  }
  if (member.type !== undefined) {
    fireEvent.change(screen.getByLabelText("Or type a team member name"), {
      target: { value: member.type },
    });
  }
  if (fields.today !== undefined) {
    fireEvent.change(screen.getByPlaceholderText("What will you work on today?"), {
      target: { value: fields.today },
    });
  }
  if (fields.blockers !== undefined) {
    fireEvent.change(screen.getByPlaceholderText(/Any impediments or blockers/), {
      target: { value: fields.blockers },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
}

beforeEach(() => {
  spies.log.mockClear();
  spies.exports = {};
  localStorage.clear();
  useWorkspaceStore.setState({
    teamMembers: [{ id: "m1", name: "Alice" }],
    standupEntries: [],
    impediments: [],
  });
});

describe("Standup roster box", () => {
  it("adds with Enter or +, ignoring blanks and case-insensitive duplicates", () => {
    render(<StandupClient />);
    const box = screen.getByLabelText("New team member name");

    fireEvent.change(box, { target: { value: "  Bo  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(roster()).toEqual(["Alice", "Bo"]);
    expect(box).toHaveValue("");

    fireEvent.change(box, { target: { value: "ALICE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(roster()).toEqual(["Alice", "Bo"]);
    expect(screen.getByRole("button", { name: "Remove Bo" })).toBeInTheDocument();
  });

  it("says when there are no members and no entries yet", () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    render(<StandupClient />);
    expect(screen.getByText("No members yet")).toBeInTheDocument();
    expect(
      screen.getByText("No entries today and no team members configured yet.")
    ).toBeInTheDocument();
  });
});

describe("Standup submit", () => {
  it("files a typed name under the roster's casing, and puts a new name on the roster", () => {
    render(<StandupClient />);
    submit({ type: "  alice " }, { today: "Ship the fix", blockers: "Need review" });

    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      member: "Alice",
      date: TODAY,
      today: "Ship the fix",
      blockers: "Need review",
    });
    expect(roster()).toEqual(["Alice"]);
    expect(spies.log).toHaveBeenCalledWith(STANDUP_ACTIONS.ENTRY_ADDED, {
      member: "Alice",
      date: TODAY,
      hasBlocker: true,
    });
    // The form is cleared for the next person.
    expect(screen.getByPlaceholderText("What will you work on today?")).toHaveValue("");
    expect(screen.getByPlaceholderText(/Any impediments or blockers/)).toHaveValue("");
    expect(screen.getByLabelText("Or type a team member name")).toHaveValue("");

    submit({ type: "Cara" }, { today: "Pair with Bo" });
    expect(entries().map((e) => e.member)).toEqual(["Alice", "Cara"]);
    expect(roster()).toEqual(["Alice", "Cara"]);
    expect(spies.log).toHaveBeenLastCalledWith(STANDUP_ACTIONS.ENTRY_ADDED, {
      member: "Cara",
      date: TODAY,
      hasBlocker: false,
    });
  });

  it("drops a typed name when a member is then picked from the dropdown", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
      ],
    });
    render(<StandupClient />);
    fireEvent.change(screen.getByLabelText("Or type a team member name"), {
      target: { value: "Zed" },
    });
    submit({ pick: "Bo" }, { today: "Tests" });
    expect(entries().map((e) => e.member)).toEqual(["Bo"]);
    expect(roster()).not.toContain("Zed");
  });

  it("keeps a resolved blocker resolved on a re-submit of the same text, and reopens a new one", () => {
    useWorkspaceStore.setState({
      standupEntries: [entry("e1", "Alice", { blockers: "DBA review", blockerResolved: true })],
    });
    render(<StandupClient />);

    submit({ pick: "Alice" }, { today: "New plan", blockers: "  DBA review " });
    fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ id: "e1", today: "New plan", blockerResolved: true });

    submit({ pick: "Alice" }, { today: "Newer plan", blockers: "Build is red" });
    fireEvent.click(screen.getByRole("button", { name: "Replace entry" }));
    expect(entries()[0]).toMatchObject({
      id: "e1",
      blockers: "Build is red",
      blockerResolved: false,
    });
  });
});

describe("Standup Today tab", () => {
  it("counts submitted, missing and open blockers, and Mark resolved resolves one", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cara" },
      ],
      standupEntries: [
        entry("a", "Alice", { blockers: "Waiting on keys" }),
        entry("b", "Bo"),
        // Yesterday's blocker: open, but not today's.
        entry("c", "Cara", { date: "2026-01-05", blockers: "Old blocker" }),
      ],
    });
    render(<StandupClient />);

    expect(stat("Submitted")).toBe("2");
    expect(stat("Missing")).toBe("1");
    expect(stat("Blockers")).toBe("1");
    const missing = screen.getByText("Not yet submitted").nextElementSibling as HTMLElement;
    expect(missing).toHaveTextContent("Cara");
    // The tab badge counts every open blocker, whatever the day.
    expect(screen.getByRole("tab", { name: /Blockers/ })).toHaveTextContent("Blockers2");

    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(entries().find((e) => e.id === "a")?.blockerResolved).toBe(true);
    expect(stat("Blockers")).toBe("0");
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(screen.getByRole("tab", { name: /Blockers/ })).toHaveTextContent("Blockers1");
  });
});

describe("Standup History tab", () => {
  // Bug: with no entry today, the date dropdown had no option for today, so
  // it showed another day while the list said "No entries for <today>" — and
  // with a single past day there was no way to pick it (re-picking the shown
  // option fires no change).
  it("lists the entries for the date the dropdown shows", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Alice" },
        { id: "m2", name: "Bo" },
      ],
      standupEntries: [entry("p1", "Alice", { date: "2026-01-05", blockers: "Flaky CI" })],
    });
    render(<StandupClient />);
    openTab(/History/);

    const dateSelect = screen.getByLabelText("Digest date") as HTMLSelectElement;
    const shown = dateSelect.value;
    expect(screen.getByText(`No entries for ${shown}.`)).toBeInTheDocument();

    fireEvent.change(dateSelect, { target: { value: "2026-01-05" } });
    const row = screen.getByRole("row", { name: /Alice/ });
    expect(row).toHaveTextContent("Flaky CI");
    expect(spies.exports["standup-2026-01-05"].clipboardText).toBe(
      "# Standup — 2026-01-05\n\n## Alice\n**Yesterday:** y\n**Today:** t\n**Blockers:** Flaky CI\n"
    );

    fireEvent.change(screen.getByLabelText("Filter by member"), { target: { value: "Bo" } });
    expect(screen.getByText("No entries for 2026-01-05 from Bo.")).toBeInTheDocument();
  });

  it("offers every day with entries, newest first", () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("1", "Alice", { date: "2026-01-05" }),
        entry("2", "Alice", { date: "2026-02-10" }),
        entry("3", "Alice"),
      ],
    });
    render(<StandupClient />);
    openTab(/History/);
    const options = within(screen.getByLabelText("Digest date"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([TODAY, "2026-02-10", "2026-01-05"]);
  });
});

describe("Standup Blockers tab", () => {
  it("lists open blockers oldest first with their age, and Resolve moves one to Resolved", () => {
    const now = Date.now();
    useWorkspaceStore.setState({
      standupEntries: [
        entry("new", "Alice", { blockers: "Fresh", timestamp: now - HOUR }),
        entry("mid", "Bo", { blockers: "Two days", timestamp: now - 50 * HOUR }),
        entry("old", "Cara", { blockers: "Five days", timestamp: now - 125 * HOUR }),
        entry("none", "Dee"),
      ],
    });
    render(<StandupClient />);
    openTab(/Blockers/);

    const open = screen.getByText("Open Blockers").parentElement!.nextElementSibling as HTMLElement;
    const cards = Array.from(open.children) as HTMLElement[];
    expect(cards.map((c) => c.querySelector("p")?.textContent)).toEqual([
      "Five days",
      "Two days",
      "Fresh",
    ]);
    expect(cards[0]).toHaveTextContent("5d");
    expect(cards[1]).toHaveTextContent("2d");
    expect(cards[2]).toHaveTextContent("< 1 day");

    fireEvent.click(within(cards[0]).getByRole("button", { name: "Resolve" }));
    expect(entries().find((e) => e.id === "old")?.blockerResolved).toBe(true);
    const resolved = screen.getByText("Resolved").parentElement!.nextElementSibling as HTMLElement;
    expect(resolved).toHaveTextContent("Five days");
    expect(screen.getAllByRole("button", { name: "Resolve" })).toHaveLength(2);
  });

  it("says all clear when nothing is blocked", () => {
    useWorkspaceStore.setState({ standupEntries: [entry("a", "Alice")] });
    render(<StandupClient />);
    openTab(/Blockers/);
    expect(screen.getByText(/No open blockers — all clear!/)).toBeInTheDocument();
  });
});

describe("Standup exports", () => {
  it("exports every entry as CSV, newest first", () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("a", "Alice", { date: "2026-01-05", timestamp: 1000 }),
        entry("b", "Bo", { date: "2026-01-06", blockers: "Keys", timestamp: 3000 }),
        entry("c", "Cara", { date: "2026-01-06", timestamp: 2000 }),
      ],
    });
    render(<StandupClient />);
    const csv = spies.exports["standup-all"].csvData!;
    expect(csv.headers).toEqual(["Date", "Member", "Yesterday", "Today", "Blockers"]);
    expect(csv.rows).toEqual([
      ["2026-01-06", "Bo", "y", "t", "Keys"],
      ["2026-01-06", "Cara", "y", "t", ""],
      ["2026-01-05", "Alice", "y", "t", ""],
    ]);
  });

  it("builds the weekly digest from the five most recent days, per member", () => {
    const days = ["01", "02", "03", "04", "05", "06"].map((d) => `2026-03-${d}`);
    useWorkspaceStore.setState({
      standupEntries: [
        // Bo only posted on the oldest day, which falls outside the five.
        entry("bo", "Bo", { date: days[0], timestamp: 1 }),
        ...days.map((date, i) =>
          entry(`a${i}`, "Alice", {
            date,
            timestamp: 10 + i,
            yesterday: "",
            blockers: i === 5 ? "Keys" : "",
          })
        ),
      ],
    });
    render(<StandupClient />);
    const digest = spies.exports["weekly-digest"].clipboardText!;
    const lines = digest.split("\n");
    expect(lines[0]).toBe("# Weekly Standup Digest");
    // Members in order of their latest post.
    expect(lines.indexOf("## Alice")).toBeLessThan(lines.indexOf("## Bo"));
    expect(lines[lines.indexOf("## Bo") + 1]).toBe("_No entries_");
    expect(digest).toContain("**2026-03-06**\n- Yesterday: —\n- Today: t\n- Blockers: Keys");
    expect(digest).not.toContain("**2026-03-01**");
    expect(lines.filter((l) => l.startsWith("**2026-03-")).length).toBe(5);
  });
});
