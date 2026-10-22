import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";

/**
 * PI Planning Board: teams × iterations grid persisted to localStorage.
 * Covers add/edit/remove of teams and items, the iteration-count control
 * (including the destructive shrink prompt), capacity / overload maths, the
 * KPI strip, the cross-tool sprint chip and the CSV export rows.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof exported.csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { PiPlanningClient } from "@/app/(tools)/pi-planning/pi-planning-client";

const KEY = "agile-toolkit:pi-planning";

interface Team {
  id: string;
  name: string;
  description?: string;
  velocity: number;
}
interface Item {
  id: string;
  title: string;
  description?: string;
  teamId: string;
  iteration: number;
  points: number;
  kind: "feature" | "dependency" | "risk";
}
interface State {
  teams: Team[];
  items: Item[];
  iterations: number;
}

const seed = (s: Partial<State>) =>
  localStorage.setItem(KEY, JSON.stringify({ teams: [], items: [], iterations: 5, ...s }));
const saved = (): State =>
  JSON.parse(localStorage.getItem(KEY) ?? "null") ?? { teams: [], items: [], iterations: 5 };

const item = (
  id: string,
  teamId: string,
  iteration: number,
  points: number,
  kind: Item["kind"] = "feature",
  title = id
): Item => ({ id, title, teamId, iteration, points, kind });

/** Value under a compact StatCard's label. */
function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.parentElement!.children[1].textContent ?? "";
}
function kpiHint(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.parentElement!.children[2]?.textContent ?? "";
}

/** The board cell for a team + 1-based iteration. */
function cell(team: string, iteration: number): HTMLElement {
  return screen
    .getByRole("button", { name: `Add item to ${team}, iteration ${iteration}` })
    .closest("td")!;
}

function velocityEvent(id: string, daysAgo: number): HistoryEvent {
  return {
    id,
    clientEventId: id,
    clientId: "c",
    toolRunId: "r",
    userId: null,
    toolId: "velocity",
    action: "sprint_added",
    payload: {},
    occurredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  } as HistoryEvent;
}

beforeEach(() => {
  localStorage.clear();
  history.log.mockClear();
  exported.csv = undefined;
  useHistoryStore.setState({ events: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PI Planning: empty board", () => {
  it("shows the empty prompt, five iteration columns and zeroed KPIs", () => {
    render(<PiPlanningClient />);
    expect(screen.getByText("Add teams to build your PI board.")).toBeInTheDocument();
    for (let i = 1; i <= 5; i++) expect(screen.getByText(`Iteration ${i}`)).toBeInTheDocument();
    expect(screen.queryByText("Iteration 6")).toBeNull();
    expect(kpi("Teams")).toBe("0");
    expect(kpi("Features (pts)")).toBe("0");
    expect(kpi("P85 team velocity")).toBe("—");
    expect(kpi("Overloads")).toBe("0");
    expect(screen.queryByText(/completed since PI start/)).toBeNull();
  });
});

describe("PI Planning: teams", () => {
  it("adds a trimmed team with velocity and description, then resets the form", () => {
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("New team name"), {
      target: { value: "  Payments  " },
    });
    fireEvent.change(screen.getByLabelText("New team velocity"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("New team description"), {
      target: { value: "  Owns checkout  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Team/ }));

    const s = saved();
    expect(s.teams).toHaveLength(1);
    expect(s.teams[0]).toMatchObject({
      name: "Payments",
      velocity: 25,
      description: "Owns checkout",
    });
    expect(screen.getByLabelText("Team name")).toHaveValue("Payments");
    expect(screen.getByText("Owns checkout")).toBeInTheDocument();
    expect(screen.getByLabelText("Velocity for Payments")).toHaveValue(25);
    expect(screen.queryByText("Add teams to build your PI board.")).toBeNull();
    expect(kpi("Teams")).toBe("1");
    expect(history.log).toHaveBeenCalledWith(
      "team_added",
      expect.objectContaining({ name: "Payments", description: "Owns checkout" })
    );
    // Form reset
    expect(screen.getByLabelText("New team name")).toHaveValue("");
    expect(screen.getByLabelText("New team velocity")).toHaveValue(20);
    expect(screen.getByLabelText("New team description")).toHaveValue("");
  });

  it("stores a blank description as undefined and ignores a whitespace-only name", () => {
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Add Team/ }));
    expect(saved().teams).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "Core" } });
    fireEvent.change(screen.getByLabelText("New team description"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Add Team/ }));
    expect(saved().teams[0].description).toBeUndefined();
    expect(saved().teams[0].velocity).toBe(20);
  });

  it("adds a team with Ctrl+Enter from the description box", () => {
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("New team name"), { target: { value: "Search" } });
    fireEvent.keyDown(screen.getByLabelText("New team description"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(saved().teams.map((t) => t.name)).toEqual(["Search"]);
  });

  it("keeps the prior new-team velocity when a negative value is typed", () => {
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("New team velocity"), { target: { value: "-4" } });
    expect(screen.getByLabelText("New team velocity")).toHaveValue(20);
  });

  it("renames a team on blur and edits its velocity", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 10 }] });
    render(<PiPlanningClient />);
    const name = screen.getByLabelText("Team name");
    fireEvent.change(name, { target: { value: "Alpha Squad" } });
    expect(saved().teams[0].name).toBe("Alpha"); // not committed per keystroke
    fireEvent.blur(name);
    expect(saved().teams[0].name).toBe("Alpha Squad");

    const vel = screen.getByLabelText("Velocity for Alpha Squad");
    fireEvent.change(vel, { target: { value: "30" } });
    expect(saved().teams[0].velocity).toBe(30);
    fireEvent.change(vel, { target: { value: "-1" } });
    expect(saved().teams[0].velocity).toBe(30);
  });

  it("removing a team also removes its items, and leaves other teams' items alone", () => {
    seed({
      teams: [
        { id: "t1", name: "Alpha", velocity: 10 },
        { id: "t2", name: "Beta", velocity: 10 },
      ],
      items: [item("i1", "t1", 0, 3), item("i2", "t2", 0, 5), item("i3", "t1", 2, 1)],
    });
    render(<PiPlanningClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove team Alpha" }));
    const s = saved();
    expect(s.teams.map((t) => t.id)).toEqual(["t2"]);
    expect(s.items.map((i) => i.id)).toEqual(["i2"]);
    expect(history.log).toHaveBeenCalledWith("team_removed", { teamId: "t1", name: "Alpha" });
  });
});

describe("PI Planning: items", () => {
  beforeEach(() => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 20 }] });
  });

  it("adds a 3-point feature to the chosen cell", () => {
    render(<PiPlanningClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add item to Alpha, iteration 2" }));
    const s = saved();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      teamId: "t1",
      iteration: 1,
      points: 3,
      kind: "feature",
      title: "",
    });
    expect(within(cell("Alpha", 2)).getByText("3 / 20")).toBeInTheDocument();
    expect(within(cell("Alpha", 1)).getByText("0 / 20")).toBeInTheDocument();
    expect(within(cell("Alpha", 2)).getByLabelText("Item points")).toHaveValue(3);
    expect(kpi("Features (pts)")).toBe("3");
    expect(history.log).toHaveBeenCalledWith(
      "item_added",
      expect.objectContaining({ teamId: "t1", iteration: 1 })
    );
  });

  it("commits title edits on blur without logging per keystroke", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 20 }], items: [item("i1", "t1", 0, 3)] });
    render(<PiPlanningClient />);
    const title = screen.getByLabelText("Item title");
    fireEvent.change(title, { target: { value: "Checkout v2" } });
    fireEvent.blur(title);
    expect(saved().items[0].title).toBe("Checkout v2");
    expect(history.log).not.toHaveBeenCalled();
  });

  it("stores a whitespace-only item description as undefined", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20 }],
      items: [{ ...item("i1", "t1", 0, 3), description: "Old" }],
    });
    render(<PiPlanningClient />);
    const desc = screen.getByLabelText("Item description");
    expect(desc).toHaveValue("Old");
    fireEvent.change(desc, { target: { value: "   " } });
    fireEvent.blur(desc);
    expect(saved().items[0].description).toBeUndefined();
  });

  it("updates points (logging the change) and ignores negative points", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 20 }], items: [item("i1", "t1", 0, 3)] });
    render(<PiPlanningClient />);
    const pts = screen.getByLabelText("Item points");
    fireEvent.change(pts, { target: { value: "8" } });
    expect(saved().items[0].points).toBe(8);
    expect(within(cell("Alpha", 1)).getByText("8 / 20")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith("item_updated", { itemId: "i1", points: 8 });

    fireEvent.change(pts, { target: { value: "-2" } });
    expect(saved().items[0].points).toBe(8);
  });

  it("only features count towards planned load and the Features KPI", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20 }],
      items: [
        item("f", "t1", 0, 5),
        item("d", "t1", 0, 13, "dependency"),
        item("r", "t1", 0, 8, "risk"),
      ],
    });
    render(<PiPlanningClient />);
    expect(within(cell("Alpha", 1)).getByText("5 / 20")).toBeInTheDocument();
    expect(kpi("Features (pts)")).toBe("5");
  });

  it("changing an item's kind to risk drops it from the planned load", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 20 }], items: [item("i1", "t1", 0, 5)] });
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("Item kind"), { target: { value: "risk" } });
    expect(saved().items[0].kind).toBe("risk");
    expect(within(cell("Alpha", 1)).getByText("0 / 20")).toBeInTheDocument();
    expect(kpi("Features (pts)")).toBe("0");
    expect(history.log).toHaveBeenCalledWith("item_updated", { itemId: "i1", kind: "risk" });
  });

  it("removes exactly the clicked item", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20 }],
      items: [item("i1", "t1", 0, 3, "feature", "Keep"), item("i2", "t1", 0, 2, "feature", "Drop")],
    });
    render(<PiPlanningClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove item Drop" }));
    expect(saved().items.map((i) => i.title)).toEqual(["Keep"]);
    expect(history.log).toHaveBeenCalledWith("item_removed", { itemId: "i2", title: "Drop" });
  });
});

describe("PI Planning: capacity and overloads", () => {
  it("flags a cell above 115% of velocity and counts it in the Overloads KPI", () => {
    seed({
      teams: [
        { id: "t1", name: "Alpha", velocity: 10 },
        { id: "t2", name: "Beta", velocity: 10 },
      ],
      // Alpha iter 1: 12 > 11.5 (over); Beta iter 1: 11 <= 11.5 (ok)
      items: [item("a", "t1", 0, 12), item("b", "t2", 0, 11)],
    });
    render(<PiPlanningClient />);
    expect(within(cell("Alpha", 1)).getByText("Over capacity")).toBeInTheDocument();
    expect(within(cell("Beta", 1)).queryByText("Over capacity")).toBeNull();
    expect(kpi("Overloads")).toBe("1");
  });

  // Bug: `planned > velocity * 1.15` used float maths — 100 * 1.15 is
  // 114.99999999999999, so a team planned at exactly 115% was flagged.
  it("does not flag a cell planned at exactly 115% of velocity", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 100 }],
      items: [item("a", "t1", 0, 115)],
    });
    render(<PiPlanningClient />);
    expect(within(cell("Alpha", 1)).queryByText("Over capacity")).toBeNull();
    expect(kpi("Overloads")).toBe("0");
  });

  it("never flags a velocity-0 team as overloaded", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 0 }], items: [item("a", "t1", 0, 40)] });
    render(<PiPlanningClient />);
    expect(within(cell("Alpha", 1)).getByText("40 / 0")).toBeInTheDocument();
    expect(within(cell("Alpha", 1)).queryByText("Over capacity")).toBeNull();
    expect(kpi("Overloads")).toBe("0");
  });

  it("reports the P85 velocity from teams with a velocity", () => {
    seed({
      teams: [
        { id: "t1", name: "Alpha", velocity: 20 },
        { id: "t2", name: "Beta", velocity: 20 },
      ],
    });
    render(<PiPlanningClient />);
    expect(kpi("P85 team velocity")).toBe("20");
    expect(kpiHint("P85 team velocity")).toBe("points per iter, 2 teams sampled");
  });

  // Bug: the hint counted every team, including velocity-0 teams that the
  // simulation filters out, so "2 teams sampled" was shown for one sample.
  it("counts only the teams actually sampled in the P85 hint", () => {
    seed({
      teams: [
        { id: "t1", name: "Alpha", velocity: 0 },
        { id: "t2", name: "Beta", velocity: 30 },
      ],
    });
    render(<PiPlanningClient />);
    expect(kpi("P85 team velocity")).toBe("30");
    expect(kpiHint("P85 team velocity")).toBe("points per iter, 1 team sampled");
  });
});

describe("PI Planning: iterations", () => {
  it("grows the board to the typed iteration count", () => {
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("Iterations in PI"), { target: { value: "7" } });
    expect(saved().iterations).toBe(7);
    expect(screen.getByText("Iteration 7")).toBeInTheDocument();
  });

  it("ignores an empty, zero or out-of-range iteration count", () => {
    render(<PiPlanningClient />);
    const input = screen.getByLabelText("Iterations in PI");
    for (const v of ["", "0", "11", "-3"]) {
      fireEvent.change(input, { target: { value: v } });
    }
    expect(screen.getByText("Iteration 5")).toBeInTheDocument();
    expect(screen.queryByText("Iteration 6")).toBeNull();
    expect(input).toHaveValue(5);
  });

  it("asks before shrinking past pinned items, and keeps them on cancel", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20 }],
      items: [item("keep", "t1", 0, 3), item("late", "t1", 3, 2)],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("Iterations in PI"), { target: { value: "2" } });
    expect(confirm).toHaveBeenCalledWith(
      "Reducing iterations to 2 will remove 1 item pinned to iteration 3 or later. Continue?"
    );
    expect(saved().iterations).toBe(5);
    expect(saved().items).toHaveLength(2);
  });

  it("removes orphaned items when the shrink is confirmed", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20 }],
      items: [item("keep", "t1", 0, 3), item("late", "t1", 3, 2), item("later", "t1", 4, 1)],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("Iterations in PI"), { target: { value: "2" } });
    expect(confirm.mock.calls[0][0]).toContain("remove 2 items");
    expect(saved().iterations).toBe(2);
    expect(saved().items.map((i) => i.id)).toEqual(["keep"]);
    expect(screen.queryByText("Iteration 3")).toBeNull();
  });

  it("shrinks without asking when no item would be lost", () => {
    seed({ teams: [{ id: "t1", name: "Alpha", velocity: 20 }], items: [item("a", "t1", 0, 3)] });
    const confirm = vi.spyOn(window, "confirm");
    render(<PiPlanningClient />);
    fireEvent.change(screen.getByLabelText("Iterations in PI"), { target: { value: "3" } });
    expect(confirm).not.toHaveBeenCalled();
    expect(saved().iterations).toBe(3);
  });
});

describe("PI Planning: sprint chip and export", () => {
  it("counts velocity sprints added in the last 90 days", () => {
    useHistoryStore.setState({
      events: [velocityEvent("e1", 120), velocityEvent("e2", 10), velocityEvent("e3", 2)],
    });
    render(<PiPlanningClient />);
    expect(screen.getByText(/2 sprints\s+completed since PI start/)).toBeInTheDocument();
  });

  it("uses the singular for one sprint", () => {
    useHistoryStore.setState({ events: [velocityEvent("e1", 1)] });
    render(<PiPlanningClient />);
    expect(screen.getByText(/1 sprint\s+completed since PI start/)).toBeInTheDocument();
  });

  it("exports one CSV row per item with 1-based iterations and team details", () => {
    seed({
      teams: [{ id: "t1", name: "Alpha", velocity: 20, description: "Core team" }],
      items: [
        { ...item("i1", "t1", 2, 5, "risk", "Vendor delay"), description: "Contract" },
        item("i2", "ghost", 0, 1, "feature", "Orphan"),
      ],
    });
    render(<PiPlanningClient />);
    expect(exported.csv?.headers).toEqual([
      "Team",
      "Team Description",
      "Iteration",
      "Item",
      "Item Description",
      "Points",
      "Kind",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["Alpha", "Core team", 3, "Vendor delay", "Contract", 5, "risk"],
      ["", "", 1, "Orphan", "", 1, "feature"],
    ]);
  });
});
