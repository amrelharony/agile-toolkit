import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityConfig, CapacityMember, Sprint } from "@/lib/stores/workspace-types";

/**
 * Capacity Planner gap-filling: the maths' edges and the example's own
 * claim, then on the page the summary cards, the sprint settings fields
 * (blank and out-of-range values), member edits and their clamps, adding a
 * member, the per-person breakdown, points committed and the forecast chip.
 */

const logs = vi.hoisted(() => [] as Array<[string, unknown]>);
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: unknown) => logs.push([action, payload]),
  }),
}));

import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import { effectiveHours, planCapacity } from "@/app/(tools)/capacity-planner/capacity";
import { buildExampleMembers } from "@/app/(tools)/capacity-planner/example";
import { toMarkdown } from "@/app/(tools)/capacity-planner/markdown";

const CP_ID = "capacity-planner:current";
const CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};
const ANN: CapacityMember = {
  id: "m1",
  name: "Ann",
  role: "Dev",
  availability: 80,
  daysOff: 1,
  description: "Mornings only",
};
const BOB: CapacityMember = { id: "m2", name: "Bob", role: "QA", availability: 100, daysOff: 0 };

const plan = () => useWorkspaceStore.getState().capacityPlans?.find((p) => p.id === CP_ID);
const seed = (members: CapacityMember[] = [ANN, BOB], config: CapacityConfig = CONFIG) =>
  useWorkspaceStore.setState({ capacityPlans: [{ id: CP_ID, members, config }] });

beforeEach(() => {
  logs.length = 0;
  useWorkspaceStore.setState({ capacityPlans: [], sprints: [] });
});

/* ── Maths ─────────────────────────────────────────────────────────────── */

describe("capacity maths edges", () => {
  it("gives 0 hours at 0% availability or 100% ceremony overhead", () => {
    expect(effectiveHours({ availability: 0, daysOff: 0 }, CONFIG)).toBe(0);
    expect(
      effectiveHours({ availability: 100, daysOff: 0 }, { ...CONFIG, ceremonyOverhead: 100 })
    ).toBe(0);
    expect(effectiveHours({ availability: 100, daysOff: 10 }, CONFIG)).toBe(0);
  });

  it("sums an empty plan to zeros, not NaN", () => {
    expect(planCapacity({ members: [], config: CONFIG })).toEqual({
      perMember: [],
      totalHours: 0,
      avgAvailability: 0,
      totalDaysOff: 0,
    });
  });

  it("bears out the example's story: QA is as short of hours as the half-time PO", () => {
    const summary = planCapacity({ members: buildExampleMembers(), config: CONFIG });
    const hours = Object.fromEntries(summary.perMember.map((m) => [m.name, m.effectiveHours]));
    expect(hours.Mei).toBe(54.4);
    expect(Math.max(...Object.values(hours))).toBe(54.4);
    expect(hours.Amara).toBe(27.2);
    expect(hours.Priya).toBe(27.2);
  });

  it("names an unnamed member in the Markdown and singular for one member", () => {
    const md = toMarkdown(
      { members: [{ ...BOB, name: "  ", role: "QA" }], config: CONFIG },
      new Date(2026, 9, 18)
    );
    expect(md).toContain("**Total capacity:** 54.4 hours across 1 member\n");
    expect(md).toContain("| (unnamed) | QA | 100% | 0 | 54.4 |  |");
    expect(md).not.toContain("**Points committed:**");
  });
});

/* ── The page ──────────────────────────────────────────────────────────── */

const card = (label: string) =>
  screen.getByText(label, { selector: "span" }).parentElement!.parentElement!;
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe("summary", () => {
  it("adds up the team's hours, size, availability and days off", () => {
    seed();
    render(<CapacityPlannerClient />);
    expect(card("Total Capacity")).toHaveTextContent("93.6hours");
    expect(card("Team Size")).toHaveTextContent("2members");
    expect(card("Avg Availability")).toHaveTextContent("90%");
    expect(card("Total Days Off")).toHaveTextContent("1days");
    expect(screen.getByText("Sprint Total").parentElement).toHaveTextContent("93.6hours");
  });

  it("reads zeros for a plan the agent made with no members", () => {
    seed([]);
    render(<CapacityPlannerClient />);
    expect(card("Total Capacity")).toHaveTextContent("0hours");
    expect(card("Team Size")).toHaveTextContent("0members");
    expect(card("Avg Availability")).toHaveTextContent("0%");
    expect(screen.queryAllByRole("textbox", { name: "Name" })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });
});

describe("sprint settings", () => {
  it("puts back a blank or non-numeric value instead of saving 0", () => {
    // BUG_REPORT #26 regression: Number("") is 0, so a cleared Focus Factor zeroed capacity.
    seed();
    render(<CapacityPlannerClient />);
    const focus = screen.getByLabelText("Focus Factor");
    commit(focus, "");
    expect(plan()?.config.focusFactor).toBe(0.8);
    expect(focus).toHaveValue(0.8);
    expect(card("Total Capacity")).toHaveTextContent("93.6hours");
    expect(logs.map(([a]) => a)).not.toContain("config_updated");
  });

  it("clamps each setting to its range and logs the change", () => {
    seed();
    render(<CapacityPlannerClient />);
    commit(screen.getByLabelText("Focus Factor"), "1.5");
    expect(plan()?.config.focusFactor).toBe(1);
    commit(screen.getByLabelText("Sprint Length"), "45");
    expect(plan()?.config.sprintDays).toBe(30);
    commit(screen.getByLabelText("Ceremony Overhead"), "-10");
    expect(plan()?.config.ceremonyOverhead).toBe(0);
    commit(screen.getByLabelText("Hours per Day"), "0");
    expect(plan()?.config.hoursPerDay).toBe(1);
    expect(logs).toContainEqual(["config_updated", { focusFactor: 1 }]);
    expect(logs).toContainEqual(["config_updated", { hoursPerDay: 1 }]);
  });

  it("takes a decimal focus factor on Enter and recomputes the hours", () => {
    seed([BOB]);
    render(<CapacityPlannerClient />);
    const focus = screen.getByLabelText("Focus Factor");
    focus.focus();
    fireEvent.change(focus, { target: { value: "0.5" } });
    fireEvent.keyDown(focus, { key: "Enter" });
    expect(plan()?.config.focusFactor).toBe(0.5);
    // 10 days × 8 h × 0.5 × 85%
    expect(card("Total Capacity")).toHaveTextContent("34hours");
  });

  it("stores points committed as typed, and clears it", () => {
    seed();
    render(<CapacityPlannerClient />);
    const points = screen.getByLabelText(/Points Committed/);
    fireEvent.change(points, { target: { value: "30" } });
    expect(plan()?.config.pointsCommitted).toBe("30");
    fireEvent.change(points, { target: { value: "" } });
    expect(plan()?.config.pointsCommitted).toBe("");
  });
});

describe("members", () => {
  it("edits name and role, and clamps availability and days off", () => {
    seed();
    render(<CapacityPlannerClient />);
    fireEvent.change(screen.getAllByLabelText("Name")[0], { target: { value: "Ann Lee" } });
    fireEvent.change(screen.getAllByLabelText("Role")[0], { target: { value: "Lead Dev" } });
    fireEvent.change(screen.getAllByLabelText("Availability %")[0], { target: { value: "150" } });
    fireEvent.change(screen.getAllByLabelText("Days Off")[1], { target: { value: "-2" } });
    expect(plan()?.members[0]).toMatchObject({
      name: "Ann Lee",
      role: "Lead Dev",
      availability: 100,
    });
    expect(plan()?.members[1].daysOff).toBe(0);
    fireEvent.change(screen.getAllByLabelText("Days Off")[1], { target: { value: "2.5" } });
    expect(plan()?.members[1].daysOff).toBe(2.5);
  });

  it("drops a description that is only spaces", () => {
    seed();
    render(<CapacityPlannerClient />);
    const desc = screen.getByLabelText("Description for Ann");
    fireEvent.change(desc, { target: { value: "   " } });
    expect(plan()?.members[0].description).toBeUndefined();
  });

  it("adds a blank member and logs it; the only member can't be removed", () => {
    seed([BOB]);
    render(<CapacityPlannerClient />);
    expect(screen.getByRole("button", { name: "Remove member Bob" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add Member" }));
    const members = plan()?.members ?? [];
    expect(members).toHaveLength(2);
    expect(members[1]).toMatchObject({ name: "", role: "", availability: 100, daysOff: 0 });
    expect(logs).toContainEqual(["member_added", { memberId: members[1].id, name: "" }]);
    expect(screen.getByRole("button", { name: "Remove member Bob" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove member (unnamed)" })).toBeInTheDocument();
  });
});

describe("per-person breakdown", () => {
  it("shows named members with their share of a full-time person's hours", () => {
    seed([ANN, BOB, { ...BOB, id: "m3", name: "", daysOff: 2 }]);
    render(<CapacityPlannerClient />);
    expect(screen.getByRole("heading", { name: "Per-Person Breakdown" })).toBeInTheDocument();
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(screen.getByRole("progressbar", { name: "Ann capacity utilisation" })).toHaveAttribute(
      "aria-valuenow",
      "72"
    );
    expect(screen.getByRole("progressbar", { name: "Bob capacity utilisation" })).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
    expect(screen.getByText("1 day off")).toBeInTheDocument();
    expect(screen.getByText("0 days off")).toBeInTheDocument();
    expect(screen.getByText("Mornings only", { selector: "p" })).toBeInTheDocument();
  });

  it("is hidden until someone has a name", () => {
    seed([{ ...BOB, name: "" }]);
    render(<CapacityPlannerClient />);
    expect(screen.queryByRole("heading", { name: "Per-Person Breakdown" })).toBeNull();
  });
});

describe("forecast confidence", () => {
  it("appears once there are finished sprints", () => {
    seed();
    const done = (id: string, pts: number): Sprint => ({
      id,
      name: id,
      startDate: "2026-01-05",
      endDate: "2026-01-19",
      pointsPlanned: 30,
      pointsCompleted: pts,
      status: "completed",
    });
    const { unmount } = render(<CapacityPlannerClient />);
    expect(screen.queryByText("Forecast confidence")).toBeNull();
    unmount();

    useWorkspaceStore.setState({ sprints: [done("a", 28), done("b", 30)] });
    render(<CapacityPlannerClient />);
    expect(screen.getByText("Forecast confidence")).toBeInTheDocument();
    expect(
      screen.getByTitle("Bayesian forecast confidence based on 2 completed sprints")
    ).toBeInTheDocument();
  });
});
