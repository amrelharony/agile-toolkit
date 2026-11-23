/**
 * Product Metrics against the tool UX contract: an empty state that adds
 * the North Star or loads an example (cleared without touching the EBM
 * example's rows); a metric form that says what is missing and refuses a
 * second North Star; readings added and pasted with bad lines named;
 * Set as North Star, the funnel period, the funnel set-up and deletes with
 * Undo, the delete warning for a linked metric; HEART cards on a phone;
 * the funnel's leakiest stage; Ask Amr's answer without AI; the export;
 * and the history it logs (none for the example).
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ProductMetric } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/product-metrics",
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
vi.mock("@/components/presentation/wall-view", () => ({
  WallViewButton: ({ title }: { title: string }) => (
    <button type="button">Wall mode: {title}</button>
  ),
}));

import { ProductMetricsClient } from "@/app/(tools)/product-metrics/product-metrics-client";
import { PRODUCT_METRICS_ACTIONS } from "@/lib/history/event-actions";
import { todayIso } from "@/lib/sprints/series";

const NOW = "2026-11-01T00:00:00.000Z";
const metric = (over: Partial<ProductMetric> = {}): ProductMetric => ({
  id: "metric_a",
  name: "Weekly teams",
  direction: "increase",
  readings: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});
const metrics = () => useWorkspaceStore.getState().productMetrics ?? [];
const seed = (ms: ProductMetric[]) =>
  useWorkspaceStore.setState({
    productMetrics: ms,
    productGoals: [],
    hypothesisTrackers: [],
    abTests: [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ProductMetricsClient />
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
const view = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  seed([]);
});

describe("empty state and the example", () => {
  it("offers to add the North Star or look at an example", async () => {
    renderPage();
    expect(
      (await screen.findAllByText(/No metrics yet\. Start with the North Star/)).length
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add the North Star" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Load an example/ })).toBeInTheDocument();
  });

  it("loads the example's North Star, rising and 42% of the way, and logs nothing", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(screen.getByText("Teams that hold a retro each week")).toBeInTheDocument();
    expect(screen.getAllByText("42% of the way to the target").length).toBeGreaterThan(0);
    expect(screen.getByText("Rising over 8 readings.")).toBeInTheDocument();
    expect(screen.getByText("Inputs (3 of 5)")).toBeInTheDocument();
    expect(logs).toEqual([]);
  });

  it("clears only its own rows: an EBM example row stays, read as the EBM example's", async () => {
    seed([
      metric({ id: "example-ebm-nps", name: "NPS", kva: "current-value" }),
      metric({ id: "example-pm-x", name: "Example row" }),
    ]);
    renderPage();
    view("All metrics");
    expect(await screen.findByText("from the EBM example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(metrics().map((m) => m.id)).toEqual(["example-ebm-nps"]);
    expect(screen.queryByText("Example data.")).toBeNull();
  });
});

describe("the metric form", () => {
  it("says what is missing, then adds the North Star and opens its readings", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add the North Star" }));
    fireEvent.click(screen.getByRole("button", { name: "Add the metric" }));
    expect(await screen.findByText("Name the metric.")).toBeInTheDocument();
    expect(metrics()).toEqual([]);
    type(/^Name/, "Teams with a weekly retro");
    type(/^Target/, "80");
    fireEvent.click(screen.getByRole("button", { name: "Add the metric" }));
    expect(metrics()).toHaveLength(1);
    expect(metrics()[0]).toMatchObject({
      name: "Teams with a weekly retro",
      role: "north-star",
      target: 80,
    });
    expect(logs.at(-1)).toMatchObject({
      action: PRODUCT_METRICS_ACTIONS.METRIC_ADDED,
      payload: { role: "north-star" },
    });
    expect(
      screen.getByRole("region", { name: /Readings for Teams with a weekly retro/ })
    ).toBeInTheDocument();
  });

  it("refuses a second North Star and a target on the wrong side of the baseline", async () => {
    seed([metric({ id: "metric_ns", name: "Weekly teams", role: "north-star" })]);
    renderPage();
    view("All metrics");
    fireEvent.click(await screen.findByRole("button", { name: "Add a metric" }));
    type(/^Name/, "Another");
    fireEvent.change(screen.getByLabelText("North Star"), { target: { value: "north-star" } });
    type(/^Baseline/, "10");
    type(/^Target/, "5");
    fireEvent.click(screen.getByRole("button", { name: "Add the metric" }));
    expect(await screen.findByText(/must be above the baseline/)).toBeInTheDocument();
    type(/^Target/, "20");
    fireEvent.click(screen.getByRole("button", { name: "Add the metric" }));
    expect(await screen.findByText(/“Weekly teams” is the North Star/)).toBeInTheDocument();
    expect(metrics()).toHaveLength(1);
  });

  it("edits a metric and logs the update", async () => {
    seed([metric({ role: "north-star" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit “Weekly teams”" }));
    type(/^Name/, "Weekly active teams");
    fireEvent.click(screen.getByRole("button", { name: "Save the metric" }));
    expect(metrics()[0].name).toBe("Weekly active teams");
    expect(logs.at(-1)?.action).toBe(PRODUCT_METRICS_ACTIONS.METRIC_UPDATED);
  });
});

describe("readings", () => {
  it("adds a reading and replaces one on the same day", async () => {
    seed([metric({ role: "north-star" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reading for “Weekly teams”" }));
    type(/^Value/, "12");
    fireEvent.click(screen.getByRole("button", { name: "Add the reading" }));
    expect(metrics()[0].readings.map((r) => r.value)).toEqual([12]);
    expect(logs.at(-1)).toMatchObject({ action: PRODUCT_METRICS_ACTIONS.READING_ADDED });
    type(/^Value/, "14");
    fireEvent.click(screen.getByRole("button", { name: "Add the reading" }));
    expect(metrics()[0].readings.map((r) => r.value)).toEqual([14]);
  });

  it("refuses a reading after today", async () => {
    seed([metric({ role: "north-star" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reading for “Weekly teams”" }));
    type(/^Day/, "2999-01-01");
    type(/^Value/, "3");
    fireEvent.click(screen.getByRole("button", { name: "Add the reading" }));
    expect(
      await screen.findByText("A reading can't be for a day after today.")
    ).toBeInTheDocument();
    expect(metrics()[0].readings).toEqual([]);
  });

  it("says a reading older than all 52 kept isn't saved, rather than dropping it quietly", async () => {
    const full = Array.from({ length: 52 }, (_, i) => ({
      id: `r${i}`,
      date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      value: i,
    }));
    seed([metric({ role: "north-star", readings: full })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Reading/ }));
    type(/^Day/, "2024-12-31");
    type(/^Value/, "3");
    fireEvent.click(screen.getByRole("button", { name: "Add the reading" }));
    expect(
      screen.getByText(
        "Only the newest 52 readings are kept, and this one is older than all of them. Nothing was saved."
      )
    ).toHaveAttribute("role", "alert");
    expect(metrics()[0].readings).toEqual(full);
    expect(logs).toEqual([]);
  });

  it("pastes readings, names the bad lines, and undoes them together", async () => {
    seed([metric({ role: "north-star" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reading for “Weekly teams”" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste readings" }));
    type(/^Paste readings/, "2026-10-01, 40\nnonsense\n2026-10-08, 42");
    fireEvent.click(screen.getByRole("button", { name: "Add these readings" }));
    expect(metrics()[0].readings.map((r) => r.value)).toEqual([40, 42]);
    expect(
      screen.getByText(/Line 2 \(“nonsense”\): Write a day, then the number\./)
    ).toBeInTheDocument();
    expect(logs.at(-1)).toMatchObject({
      action: PRODUCT_METRICS_ACTIONS.READINGS_IMPORTED,
      payload: { readings: 2, metrics: 1 },
    });
    undoLast();
    expect(metrics()[0].readings).toEqual([]);
  });
});

describe("the North Star", () => {
  it("sets a new North Star, clearing the old one, with one Undo for both, and cheers", async () => {
    seed([
      metric({ id: "metric_old", name: "Old star", role: "north-star" }),
      metric({ id: "metric_new", name: "New star", role: "input" }),
    ]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Set “New star” as the North Star" })
    );
    expect(metrics().map((m) => [m.id, m.role])).toEqual([
      ["metric_old", undefined],
      ["metric_new", "north-star"],
    ]);
    expect(logs.at(-1)?.action).toBe(PRODUCT_METRICS_ACTIONS.NORTH_STAR_SET);
    expect(cheers).toEqual(["product-metrics:milestone"]);
    undoLast();
    expect(metrics().map((m) => [m.id, m.role])).toEqual([
      ["metric_old", "north-star"],
      ["metric_new", "input"],
    ]);
  });

  it("shows the Product Goal above it and a check list, and offers Wall mode", async () => {
    useWorkspaceStore.setState({
      productMetrics: [metric({ role: "north-star" })],
      productGoals: [
        {
          id: "goal_a",
          statement: "Teams improve every sprint",
          measures: [],
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    renderPage();
    expect(await screen.findByText("Teams improve every sprint")).toBeInTheDocument();
    expect(screen.getByText("It moves before revenue does.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wall mode: North Star" })).toBeInTheDocument();
  });
});

describe("HEART", () => {
  it("groups by feature, with a card per category for a phone and Add for the missing ones", async () => {
    seed([
      metric({
        id: "metric_h",
        name: "Rate follow-up well",
        heart: { category: "happiness", feature: "Action follow-up", goal: "Teams like it" },
      }),
    ]);
    renderPage();
    view("HEART");
    expect(await screen.findByText(/You don't need all five/)).toBeInTheDocument();
    const group = screen.getByRole("region", { name: "HEART for Action follow-up" });
    const cards = within(group).getAllByRole("listitem");
    expect(cards).toHaveLength(5);
    fireEvent.click(within(group).getByRole("button", { name: "Add Adoption" }));
    const form = screen
      .getByRole("button", { name: "Add the metric" })
      .closest("form") as HTMLElement;
    expect((within(form).getByLabelText(/^Feature/) as HTMLInputElement).value).toBe(
      "Action follow-up"
    );
    expect((within(form).getByLabelText("HEART category") as HTMLSelectElement).value).toBe(
      "adoption"
    );
  });
});

describe("the funnel", () => {
  it("names the leakiest stage with a Test a fix link", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    view("AARRR funnel");
    const line = screen.getAllByText(/Leakiest stage:/).find((el) => el.tagName !== "PRE");
    expect(line).toHaveTextContent(
      "Leakiest stage: Activation, at 35% of the stage before (up 1 point since the period before)."
    );
    expect(screen.getByRole("link", { name: "Test a fix" })).toHaveAttribute(
      "href",
      "/hypothesis-tracker?metric=example-pm-activation"
    );
  });

  it("says in the chart's table that Referral and Revenue are shares of Retention", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    view("AARRR funnel");
    fireEvent.click(screen.getByRole("button", { name: /View as table/ }));
    const table = screen.getByRole("table");
    for (const stage of ["Referral", "Revenue"]) {
      expect(within(table).getByRole("row", { name: new RegExp(`^${stage}`) })).toHaveTextContent(
        /\d+% of Retention/
      );
    }
    expect(within(table).getByRole("row", { name: /^Activation/ })).not.toHaveTextContent(
      /of Retention/
    );
  });

  it("sets up the missing stages, then adds a period, each with Undo", async () => {
    seed([metric({ id: "metric_acq", name: "Visitors", aarrr: "acquisition" })]);
    renderPage();
    view("AARRR funnel");
    fireEvent.click(await screen.findByRole("button", { name: "Set up the funnel" }));
    expect(metrics().map((m) => m.aarrr)).toEqual([
      "acquisition",
      "activation",
      "retention",
      "referral",
      "revenue",
    ]);
    const form = screen.getByRole("region", { name: "Add a period" });
    fireEvent.change(within(form).getByLabelText(/^Acquisition/), { target: { value: "100" } });
    fireEvent.change(within(form).getByLabelText(/^Activation/), { target: { value: "40" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add the period" }));
    const today = todayIso();
    expect(
      metrics()
        .filter((m) => m.readings.some((r) => r.date === today))
        .map((m) => m.aarrr)
    ).toEqual(["acquisition", "activation"]);
    expect(logs.at(-1)).toMatchObject({
      action: PRODUCT_METRICS_ACTIONS.FUNNEL_PERIOD_ADDED,
      payload: { date: today, stages: 2 },
    });
    undoLast();
    expect(metrics().every((m) => m.readings.length === 0)).toBe(true);
  });

  it("says when the counts don't nest", async () => {
    const day = todayIso();
    seed([
      metric({
        id: "a",
        name: "A",
        aarrr: "acquisition",
        readings: [{ id: "r1", date: day, value: 10 }],
      }),
      metric({
        id: "b",
        name: "B",
        aarrr: "activation",
        readings: [{ id: "r2", date: day, value: 20 }],
      }),
    ]);
    renderPage();
    view("AARRR funnel");
    expect((await screen.findAllByText(/These counts don't nest/)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Leakiest stage:/).filter((el) => el.tagName !== "PRE")).toEqual(
      []
    );
  });
});

describe("deleting", () => {
  it("deletes with Undo, and logs it", async () => {
    seed([metric({ role: "north-star" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete “Weekly teams”" }));
    expect(metrics()).toEqual([]);
    expect(logs.at(-1)?.action).toBe(PRODUCT_METRICS_ACTIONS.METRIC_REMOVED);
    undoLast();
    expect(metrics()).toHaveLength(1);
  });

  it("warns first when the metric is an EBM measure or measures a hypothesis", async () => {
    useWorkspaceStore.setState({
      productMetrics: [metric({ role: "north-star", kva: "current-value" })],
      hypothesisTrackers: [
        {
          id: "hypothesisTracker:current",
          hypotheses: [
            {
              id: "h1",
              believe: "b",
              willDo: "w",
              toLearn: "t",
              successMetric: "s",
              status: "running",
              raisedAt: "2026-10-01",
              measuredBy: { kind: "metric", metricId: "metric_a" },
            },
          ],
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete “Weekly teams”" }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/it is an EBM measure, and 1 hypothesis is measured by it/);
    expect(alert).toHaveTextContent(/read “metric removed”/);
    expect(metrics()).toHaveLength(1);
    fireEvent.click(within(alert).getByRole("button", { name: "Delete it" }));
    expect(metrics()).toEqual([]);
  });
});

describe("Ask Amr, without AI", () => {
  it("needs the product first, then suggests templates to add with Undo", async () => {
    seed([metric({ id: "metric_x", name: "Something" })]);
    renderPage();
    const ask = await screen.findByRole("button", { name: "Suggest metrics" });
    fireEvent.click(ask);
    expect(metrics()).toHaveLength(1);
    type("What does your product do?", "A retro tool for remote teams");
    fireEvent.click(screen.getByRole("button", { name: "Suggest metrics" }));
    const list = await screen.findByRole("region", { name: "Suggested metrics" });
    expect(within(list).getByText(/Suggested without AI/)).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole("button", { name: "Add: People who got real value this week" })
    );
    expect(metrics().find((m) => m.role === "north-star")?.name).toBe(
      "People who got real value this week"
    );
    undoLast();
    expect(metrics()).toHaveLength(1);
  });

  it("lists a suggestion that would break a rule as already set, and doesn't offer it", async () => {
    seed([metric({ id: "metric_ns", name: "Our star", role: "north-star" })]);
    renderPage();
    await screen.findByLabelText("What does your product do?");
    type("What does your product do?", "A retro tool");
    fireEvent.click(screen.getByRole("button", { name: "Suggest metrics" }));
    await waitFor(() =>
      expect(screen.getByText(/Already set, so not offered/)).toBeInTheDocument()
    );
    expect(
      screen.getByText(/People who got real value this week \(already set\)/)
    ).toBeInTheDocument();
  });
});

describe("more of the contract", () => {
  it("removes a reading with Undo and logs it", async () => {
    seed([metric({ role: "north-star", readings: [{ id: "r1", date: "2026-10-01", value: 9 }] })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Reading for “Weekly teams”" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the reading of 2026-10-01" }));
    expect(metrics()[0].readings).toEqual([]);
    expect(logs.at(-1)).toMatchObject({
      action: PRODUCT_METRICS_ACTIONS.READING_REMOVED,
      payload: { date: "2026-10-01" },
    });
    undoLast();
    expect(metrics()[0].readings).toHaveLength(1);
  });

  it("logs nothing for the example's own rows", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Set “New teams that run a first retro” as the North Star",
      })
    );
    expect(metrics().find((m) => m.id === "example-pm-first-retro")?.role).toBe("north-star");
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
  });

  it("names each metric's Reading button after its metric", async () => {
    seed([
      metric({ id: "metric_ns", name: "Star", role: "north-star" }),
      metric({ id: "metric_in", name: "Input one", role: "input" }),
    ]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Reading for “Star”" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reading for “Input one”" })).toBeInTheDocument();
  });

  it("takes at most five inputs", async () => {
    seed([
      metric({ id: "metric_ns", name: "Star", role: "north-star" }),
      ...[1, 2, 3, 4, 5].map((i) =>
        metric({ id: `metric_${i}`, name: `Input ${i}`, role: "input" })
      ),
    ]);
    renderPage();
    expect(await screen.findByText("Inputs (5 of 5)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add an input" })).toBeNull();
  });

  it("declares a next step", async () => {
    const { toolsWithNextSteps } = await import("@/lib/tools/next-steps");
    expect(toolsWithNextSteps()).toContain("product-metrics");
  });
});

describe("the export", () => {
  it("writes every view as Markdown", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Product Metrics");
    expect(md).toContain("**Teams that hold a retro each week**");
    expect(md).toContain("| Input | Owner | Latest | Change | Target |");
    expect(md).toContain("### Action follow-up");
    expect(md).toContain("Leakiest stage: Activation.");
    expect(md).toContain("## All metrics");
  });
});
