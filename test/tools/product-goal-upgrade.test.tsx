/**
 * Product Goal against the tool UX contract: an empty state that writes the
 * goal or opens an in-memory example; a form that says what is missing and
 * holds the caps; one active goal (a new one closes the current one as
 * achieved or abandoned, with one Undo); closing, reopening and deleting
 * with Undo; the check list; the vision saved for the checks and Ask Amr;
 * the AI drafts filling the form without saving; the export; and the
 * history it logs.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ProductGoal, Story } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/product-goal",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (toolId: string, reason: string) => cheers.push(`${toolId}:${reason}`),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { ProductGoalClient } from "@/app/(tools)/product-goal/product-goal-client";
import { buildExample } from "@/app/(tools)/product-goal/example";
import { toMarkdown } from "@/app/(tools)/product-goal/markdown";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { PRODUCT_GOAL_ACTIONS } from "@/lib/history/event-actions";

const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_a",
  statement: "Shop owners take payments anywhere without a card machine",
  measures: ["Weekly active shops"],
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const goals = () => useWorkspaceStore.getState().productGoals ?? [];
const seed = (productGoals: ProductGoal[], stories: Story[] = []) =>
  useWorkspaceStore.setState({ productGoals, stories, backlogItems: [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ProductGoalClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  useProductGoalPrefs.setState({ vision: "" });
  seed([]);
});

describe("empty state and example", () => {
  it("offers to write the goal or look at an example", async () => {
    renderPage();
    expect(await screen.findByText(/No Product Goal yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write the goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load an example/ })).toBeInTheDocument();
  });

  it("shows the example in memory only, and clears it", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    expect(document.querySelector('[data-field="statement"]')?.textContent).toMatch(
      /take every in-person payment on their own phone/
    );
    expect(screen.getByRole("list", { name: "Earlier goals" })).toBeInTheDocument();
    expect(goals()).toEqual([]);
    // Changes in the example stay in it.
    fireEvent.click(screen.getByRole("button", { name: "Mark achieved" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark achieved" }));
    expect(goals()).toEqual([]);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(await screen.findByText(/No Product Goal yet/)).toBeInTheDocument();
  });

  it("builds an example with one active goal and two closed ones", () => {
    const ex = buildExample(new Date("2026-11-12T00:00:00Z"));
    expect(ex.map((g) => g.status)).toEqual(["active", "achieved", "abandoned"]);
    expect(ex.every((g) => g.id.startsWith("example-"))).toBe(true);
  });
});

describe("writing the goal", () => {
  it("says what is missing and saves nothing until it is valid", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Write the goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the goal" }));
    expect(screen.getByText("Write the goal: one sentence about the outcome.")).toBeInTheDocument();
    expect(goals()).toEqual([]);
    type("The goal", "Shop owners can take a payment in under 10 seconds");
    // (A browser's date field never holds an impossible day; the model's test covers that.)
    type("Target date", "2027-06-30");
    type("How you'll know", "Time to take a payment\nShops with no card machine");
    fireEvent.click(screen.getByRole("button", { name: "Save the goal" }));
    expect(goals()).toEqual([
      expect.objectContaining({
        statement: "Shop owners can take a payment in under 10 seconds",
        measures: ["Time to take a payment", "Shops with no card machine"],
        targetDate: "2027-06-30",
        status: "active",
      }),
    ]);
    expect(logs.map((l) => l.action)).toEqual([PRODUCT_GOAL_ACTIONS.GOAL_CREATED]);
  });

  it("reads the draft against the check list as it is typed", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Write the goal" }));
    type("The goal", "Build the app and the reports and the admin");
    const list = screen.getByRole("region", { name: "Check list, as you type" });
    expect(within(list).getByText(/Say what changes for customers/)).toBeInTheDocument();
    expect(within(list).getByText(/Keep one objective/)).toBeInTheDocument();
  });

  it("edits the active goal in place", async () => {
    seed([goal()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type("Why it matters", "Card machines cost too much");
    fireEvent.click(screen.getByRole("button", { name: "Save the goal" }));
    expect(goals()[0]).toMatchObject({ id: "goal_a", why: "Card machines cost too much" });
    expect(logs.at(-1)?.action).toBe(PRODUCT_GOAL_ACTIONS.GOAL_UPDATED);
  });
});

describe("one active goal", () => {
  it("a new goal asks how the current one ended and closes it, with one Undo", async () => {
    seed([goal()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Set a new goal" }));
    expect(screen.getByText("How did the current goal end?")).toBeInTheDocument();
    type("The goal", "Shop owners see their money the next morning");
    fireEvent.click(screen.getByLabelText("Abandoned"));
    type("A note on how it ended", "The market moved");
    fireEvent.click(screen.getByRole("button", { name: "Save and make it active" }));
    const active = goals().filter((g) => g.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].statement).toBe("Shop owners see their money the next morning");
    expect(goals().find((g) => g.id === "goal_a")).toMatchObject({
      status: "abandoned",
      note: "The market moved",
    });
    expect(logs.map((l) => l.action)).toEqual([
      PRODUCT_GOAL_ACTIONS.GOAL_CREATED,
      PRODUCT_GOAL_ACTIONS.GOAL_ABANDONED,
    ]);
    undoLast();
    expect(goals()).toEqual([goal()]);
  });

  it("marking it achieved closes it with a note, cheers, and offers the next", async () => {
    seed([goal()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Mark achieved" }));
    type("What showed it was reached?", "70% of shops run without a machine");
    fireEvent.click(screen.getByRole("button", { name: "Mark achieved" }));
    expect(goals()[0]).toMatchObject({
      status: "achieved",
      note: "70% of shops run without a machine",
    });
    expect(goals()[0].closedAt).toBeTruthy();
    expect(cheers).toEqual(["product-goal:milestone"]);
    expect(logs.at(-1)?.action).toBe(PRODUCT_GOAL_ACTIONS.GOAL_ACHIEVED);
    expect(screen.getByRole("button", { name: "Write the next goal" })).toBeInTheDocument();
    undoLast();
    expect(goals()[0].status).toBe("active");
  });

  it("reopens an earlier goal only while none is active", async () => {
    seed([goal({ status: "abandoned", closedAt: "2026-10-01T00:00:00.000Z" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Make “.*” active again/ }));
    expect(goals()[0].status).toBe("active");
    expect(goals()[0]).not.toHaveProperty("closedAt");
    expect(screen.queryByRole("button", { name: /active again/ })).toBeNull();
  });

  it("deletes an earlier goal with Undo", async () => {
    seed([goal(), goal({ id: "goal_old", status: "achieved", statement: "Next-day payouts" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete “Next-day payouts”" }));
    expect(goals().map((g) => g.id)).toEqual(["goal_a"]);
    expect(logs.at(-1)?.action).toBe(PRODUCT_GOAL_ACTIONS.GOAL_REMOVED);
    undoLast();
    expect(
      goals()
        .map((g) => g.id)
        .sort()
    ).toEqual(["goal_a", "goal_old"]);
  });

  it("closes a second active goal a sync left, keeping the one shown", async () => {
    seed([
      goal(),
      goal({ id: "goal_b", statement: "Other", updatedAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    renderPage();
    expect(await screen.findByText(/Another goal is still marked active/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Keep the one shown/ }));
    expect(
      goals()
        .filter((g) => g.status === "active")
        .map((g) => g.id)
    ).toEqual(["goal_b"]);
  });
});

describe("the vision and Ask Amr", () => {
  it("saves the vision, and the check list compares the goal with it", async () => {
    seed([goal({ statement: "Patients book a doctor in a minute" })]);
    renderPage();
    const vision = await screen.findByLabelText("Product vision");
    fireEvent.change(vision, { target: { value: "Shop owners take payments anywhere" } });
    fireEvent.blur(vision);
    expect(useProductGoalPrefs.getState().vision).toBe("Shop owners take payments anywhere");
    expect(screen.getByText(/It shares no words with the vision/)).toBeInTheDocument();
  });

  it("drafts goals without AI and fills the form, saving nothing", async () => {
    useProductGoalPrefs.setState({ vision: "Shop owners take payments anywhere." });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Write the goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Suggest goal templates" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    fireEvent.click(within(list).getAllByRole("button", { name: /^Use:/ })[0]);
    expect((screen.getByLabelText("The goal") as HTMLTextAreaElement).value).toMatch(
      /shop owners take payments anywhere/
    );
    expect(goals()).toEqual([]);
  });
});

describe("export", () => {
  it("writes the goal, its measures, the check list and the record", async () => {
    seed([
      goal(),
      goal({
        id: "goal_old",
        status: "achieved",
        statement: "Next-day payouts",
        closedAt: "2026-05-01T00:00:00.000Z",
        note: "Done",
      }),
    ]);
    renderPage();
    await screen.findByText("The active goal");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("**Shop owners take payments anywhere without a card machine**");
    expect(md).toContain("- Weekly active shops");
    expect(md).toContain("- [x] Can you tell when it is reached?");
    expect(md).toContain("- Achieved 2026-05-01: Next-day payouts (Done)");
  });

  it("says plainly when nothing is active", () => {
    const md = toMarkdown({ active: undefined, history: [], vision: "", today: "2026-11-12" });
    expect(md).toContain("No Product Goal is active.");
    expect(md).toContain("## Earlier goals\n\nNone yet.");
  });
});

describe("hydration", () => {
  it("waits for the saved vision before showing it", async () => {
    localStorage.setItem(
      "agile-toolkit:product-goal",
      JSON.stringify({ state: { vision: "Saved" }, version: 0 })
    );
    renderPage();
    await waitFor(() =>
      expect((screen.getByLabelText("Product vision") as HTMLTextAreaElement).value).toBe("Saved")
    );
  });
});
