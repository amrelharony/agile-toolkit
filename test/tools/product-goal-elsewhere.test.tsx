/**
 * The active Product Goal where sprints are planned against it: a read-only
 * line on Sprint Goal (whose objective can name the part of it the sprint
 * serves, as text), on Sprint Planning (beside the sprint goal, with the
 * interrupt buffer in the capacity step), and on the team charter, card
 * list and Markdown kept as they were.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ProductGoal, Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/sprint-goal",
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE: cadence } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [cadence, () => {}] };
});
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintGoalClient } from "@/app/(tools)/sprint-goal/sprint-goal-client";
import { toMarkdown as sprintGoalMarkdown } from "@/app/(tools)/sprint-goal/markdown";
import { SprintPlanning } from "@/app/(tools)/sprint-planning/planning";
import { bufferPlanLine } from "@/app/(tools)/sprint-planning/buffer-field";
import { bufferPoints } from "@/lib/sprints/interrupts";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/interrupt-buffer";
import { charterCards, charterMarkdown, charterProductGoal } from "@/app/(meta)/team/charter-view";
import { ProductGoalLine } from "@/components/product-goal/product-goal-line";
import { SERVES_PREFIX } from "@/lib/product-goal/model";
import { SPRINT_PLANNING_ACTIONS } from "@/lib/history/event-actions";

const GOAL: ProductGoal = {
  id: "goal_a",
  statement: "Shop owners take payments anywhere",
  measures: ["Weekly active shops"],
  targetDate: "2027-06-30",
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const SPRINT: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-11-09",
  endDate: "2026-11-20",
  pointsPlanned: 0,
  status: "planned",
};

const wrap = (ui: ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  logs.length = 0;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [SPRINT],
    sprintGoals: [],
    stories: [],
    backlogItems: [],
    capacityPlans: [],
    productGoals: [GOAL],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [], productGoals: [] });
});

describe("the read-only line", () => {
  it("shows the active goal with its target, and a way to write one when there is none", () => {
    const { rerender } = wrap(<ProductGoalLine goal={GOAL} />);
    expect(screen.getByText("Shop owners take payments anywhere")).toBeInTheDocument();
    expect(screen.getByText("(by 30 Jun 2027)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the Product Goal/ })).toHaveAttribute(
      "href",
      "/product-goal"
    );
    rerender(
      <TooltipProvider>
        <ProductGoalLine goal={undefined} />
      </TooltipProvider>
    );
    expect(screen.getByText(/No Product Goal yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write the goal" })).toHaveAttribute(
      "href",
      "/product-goal"
    );
  });
});

describe("Sprint Goal", () => {
  it("shows the Product Goal and names it in the objective, as text", async () => {
    wrap(<SprintGoalClient />);
    expect(screen.getByText("Shop owners take payments anywhere")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Say which part of it this sprint serves" })
    );
    const doc = useWorkspaceStore.getState().sprintGoals?.find((g) => g.id.includes("s2"));
    expect(doc?.businessObjective).toBe(
      `${SERVES_PREFIX}: “Shop owners take payments anywhere”. This sprint moves it by: `
    );
    // Named once: the button goes, and the person carries on in the objective.
    expect(
      screen.queryByRole("button", { name: "Say which part of it this sprint serves" })
    ).toBeNull();
    const field = screen.getByLabelText("Business objective") as HTMLTextAreaElement;
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe(field.value.length);
  });

  it("puts the Product Goal in the export, and leaves an empty goal empty", () => {
    const goal = {
      businessObjective: "",
      goal: "Refunds from the phone",
      criteria: [],
      keyResults: [],
    };
    const md = sprintGoalMarkdown(goal, new Date(2026, 10, 12), { productGoal: GOAL.statement });
    expect(md).toContain("## Product Goal\n\nShop owners take payments anywhere");
    const empty = sprintGoalMarkdown({ ...goal, goal: "" }, new Date(2026, 10, 12), {
      productGoal: GOAL.statement,
    });
    expect(empty).toContain("No sprint goal yet.");
    expect(empty).not.toContain("Product Goal");
  });
});

describe("Sprint Planning", () => {
  it("shows the Product Goal beside the sprint goal", () => {
    wrap(<SprintPlanning />);
    expect(screen.getByText("Shop owners take payments anywhere")).toBeInTheDocument();
  });

  it("sets the interrupt buffer as a share of the points planned, and shows it as a share after", () => {
    wrap(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("Commit to"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Share of the points planned"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    // Stored as the Interrupt Buffer page and Amr store it, and logged.
    expect(useWorkspaceStore.getState().sprints[0].interruptBuffer).toEqual({ pct: 20 });
    expect(logs.filter((l) => l.action === SPRINT_PLANNING_ACTIONS.BUFFER_SET)).toEqual([
      { action: "buffer_set", payload: { sprintId: "s2", pct: 20, points: null } },
    ]);
    expect(
      screen.getByText(
        "20% of the points planned is kept for interrupts, once stories are in. To fit 30 with it, plan about 25 points of stories."
      )
    ).toBeInTheDocument();
    // The field still reads what was typed: a share, not points.
    expect(screen.getByLabelText("Keep for interrupts")).toHaveValue("pct");
    expect(screen.getByLabelText("Share of the points planned")).toHaveValue(20);
  });

  it("says what is wrong with a share out of range, and clears a blank buffer", () => {
    useWorkspaceStore.setState({ sprints: [{ ...SPRINT, interruptBuffer: { points: 4 } }] });
    wrap(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("Keep for interrupts"), { target: { value: "pct" } });
    fireEvent.change(screen.getByLabelText("Share of the points planned"), {
      target: { value: "95" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(screen.getByText(/from 1 to 90%/)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().sprints[0].interruptBuffer).toEqual({ points: 4 });
    fireEvent.change(screen.getByLabelText("Share of the points planned"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(useWorkspaceStore.getState().sprints[0].interruptBuffer).toBeUndefined();
    // Only the saves that changed the buffer are logged: the refused share isn't.
    expect(logs.filter((l) => l.action === SPRINT_PLANNING_ACTIONS.BUFFER_SET)).toEqual([
      { action: "buffer_set", payload: { sprintId: "s2", pct: null, points: null } },
    ]);
  });

  it("works out what to keep and what to plan", () => {
    expect(bufferPlanLine({ interruptBuffer: { points: 5 } }, 0, null)).toBe(
      "Keeps 5 points for interrupts."
    );
    expect(bufferPlanLine({ interruptBuffer: { points: 6 } }, 12, 30)).toBe(
      "Keeps 6 points of the 30 for interrupts: plan about 24 points of stories."
    );
    expect(bufferPlanLine({ interruptBuffer: { pct: 20 } }, 24, null)).toBe(
      "20% of the 24 points planned keeps 4.8 points for interrupts."
    );
    expect(bufferPlanLine({ interruptBuffer: { pct: 20 } }, 25, 30)).toBe(
      "20% of the 25 points planned keeps 5 points for interrupts. To fit 30 with it, plan about 25 points of stories."
    );
    expect(bufferPlanLine(SPRINT, 0, 30)).toBeNull();
  });

  it("gives 20% the same points whether Sprint Planning, the Interrupt Buffer page or Amr set it", async () => {
    const committed = { ...SPRINT, pointsPlanned: 24, status: "active" as const };
    // Sprint Planning.
    useWorkspaceStore.setState({ sprints: [committed] });
    const { unmount } = wrap(<SprintPlanning />);
    fireEvent.change(screen.getByLabelText("Share of the points planned"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    const fromPlanning = useWorkspaceStore.getState().sprints[0];
    unmount();
    // Amr.
    useWorkspaceStore.setState({ sprints: [committed] });
    const setBuffer = registry.get("tool.interrupt_buffer.set_buffer")!;
    await setBuffer.handler(setBuffer.paramsSchema.parse({ sprintId: "s2", pct: 20 }), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    });
    const fromAmr = useWorkspaceStore.getState().sprints[0];
    expect(fromPlanning.interruptBuffer).toEqual(fromAmr.interruptBuffer);
    expect(bufferPoints(fromPlanning)).toBe(4.8);
    expect(bufferPoints(fromAmr)).toBe(4.8);
  });
});

describe("the team charter", () => {
  const docs = {
    members: [],
    cadence: DEFAULT_CADENCE,
    agreement: undefined,
    dod: { items: [], history: [] },
    dor: { criteria: [], history: [] },
    estimation: { selectedScale: "Fibonacci", descriptions: {}, examples: {} },
  };

  it("reads the active goal, leaving the cards as they were", () => {
    expect(charterProductGoal({ productGoals: [GOAL] })).toEqual({
      statement: "Shop owners take payments anywhere",
      target: "by 30 Jun 2027",
      measures: ["Weekly active shops"],
    });
    expect(charterProductGoal({ productGoals: [{ ...GOAL, id: "example-g" }] })).toBeNull();
    expect(charterCards({ ...docs, productGoals: [GOAL] }).map((c) => c.id)).toEqual([
      "agreement",
      "dod",
      "dor",
      "estimation",
    ]);
  });

  it("puts the goal in the charter's Markdown, before the team", () => {
    const md = charterMarkdown({ ...docs, productGoals: [GOAL] }, "2026-11-12");
    expect(md).toContain(
      "## Product Goal\n\nShop owners take payments anywhere (by 30 Jun 2027)\n\n- Weekly active shops\n\n## Team"
    );
    expect(charterMarkdown({ ...docs, productGoals: [] }, "2026-11-12")).toContain(
      "## Product Goal\n\nNo Product Goal yet.\n\n## Team"
    );
    expect(charterMarkdown(docs, "2026-11-12")).not.toContain("## Product Goal");
  });
});
