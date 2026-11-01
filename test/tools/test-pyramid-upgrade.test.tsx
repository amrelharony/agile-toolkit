import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/impediments/model";
import { TEST_PYRAMID_ID, classifyShape, layerShares, shapeVerdict } from "@/lib/quality/pyramid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { LEGACY_TEST_PYRAMID, TEST_PYRAMID } from "../stores/phase8-fixtures";

/**
 * Test Pyramid: the counts saved together, draft-then-save with inline
 * errors (never a 0 for a blank layer, never a write per blur), the shape
 * from all three layers' shares with a 5-point tolerance, a "by run time"
 * toggle that needs all three runtimes, snapshots (take, compare, delete
 * with Undo), a clear with Undo, an in-memory example, Markdown, and the
 * page and tool.test_pyramid.list_state naming the same shape. The page
 * keeps the fields its forms don't show (run times, weighting, snapshots,
 * updatedOn) when it saves.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
const logSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: logSpy }),
}));
vi.mock("@/app/(tools)/test-pyramid/charts", () => ({ ShapeOverTimeChart: () => null }));

import "@/lib/actions/tools/test-pyramid";
import { TestPyramidClient } from "@/app/(tools)/test-pyramid/test-pyramid-client";
import { buildExample } from "@/app/(tools)/test-pyramid/example";
import { pyramidMarkdown } from "@/app/(tools)/test-pyramid/markdown";
import {
  validateCounts,
  validateRuntime,
  validateSnapshot,
} from "@/app/(tools)/test-pyramid/forms";
import { compareWithNow, shapeChartText, shapePoints } from "@/app/(tools)/test-pyramid/view";

const TODAY = todayLocalISO();

const doc = () =>
  (useWorkspaceStore.getState().testPyramids ?? []).find((d) => d.id === TEST_PYRAMID_ID) ?? null;
const seed = (d: TestPyramid | null) => useWorkspaceStore.setState({ testPyramids: d ? [d] : [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <TestPyramidClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  act(() => call?.[1]?.action?.onClick());
};

const typeCounts = (unit: string, integration: string, e2e: string) => {
  fireEvent.change(screen.getByLabelText(/^Unit tests/), { target: { value: unit } });
  fireEvent.change(screen.getByLabelText(/^Integration tests/), { target: { value: integration } });
  fireEvent.change(screen.getByLabelText(/^End-to-end tests/), { target: { value: e2e } });
};

const agentState = async () => {
  const action = registry.get("tool.test_pyramid.list_state")!;
  return (await action.handler!({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
    shape: string;
    verdict: string;
    snapshotCount: number;
  };
};

beforeEach(() => {
  seed(null);
  toastSpy.mockReset();
  logSpy.mockReset();
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("the shape, from all three layers", () => {
  const shapeOf = (unit: number, integration: number, e2e: number) =>
    classifyShape(layerShares({ unit, integration, e2e }));

  it("names each shape, and an empty suite", () => {
    expect(shapeOf(70, 20, 10)).toBe("pyramid");
    expect(shapeOf(10, 20, 70)).toBe("ice-cream-cone");
    expect(shapeOf(48, 6, 46)).toBe("hourglass");
    expect(shapeOf(20, 60, 20)).toBe("diamond");
    expect(shapeOf(34, 33, 33)).toBe("even");
    expect(shapeOf(0, 0, 0)).toBe("empty");
  });

  it("reads layers exactly 5 points apart as level, and 6 apart as a shape", () => {
    expect(shapeOf(40, 35, 25)).toBe("pyramid");
    expect(shapeOf(36, 33, 31)).toBe("even");
    expect(shapeOf(37, 32, 31)).toBe("pyramid");
  });

  it("weighs by run time only with all three runtimes", () => {
    const counts = { unit: 100, integration: 10, e2e: 5 };
    expect(layerShares(counts, "runtime", { unit: 2, integration: 3 })).toBeNull();
    const byTime = layerShares(counts, "runtime", { unit: 2, integration: 3, e2e: 15 });
    expect(classifyShape(byTime)).toBe("ice-cream-cone");
  });
});

describe("the forms' checks", () => {
  it("needs every count, and never reads a blank as 0", () => {
    expect(validateCounts({ unit: "", integration: "3", e2e: "1.5", description: "" })).toEqual({
      ok: false,
      errors: {
        unit: "Enter the number of unit tests.",
        e2e: "Enter a whole number of 0 or more.",
      },
    });
    expect(validateCounts({ unit: "0", integration: "0", e2e: "0", description: " x " })).toEqual({
      ok: true,
      values: { unit: 0, integration: 0, e2e: 0, description: "x" },
    });
  });

  it("takes minutes per layer, any of them left blank", () => {
    expect(validateRuntime({ unit: "4", integration: "", e2e: "26.456" })).toEqual({
      ok: true,
      values: { unit: 4, e2e: 26.46 },
    });
    expect(validateRuntime({ unit: "-1", integration: "", e2e: "" })).toEqual({
      ok: false,
      errors: { unit: "Enter minutes of 0 or more." },
    });
  });

  it("backdates a snapshot but refuses a day after today", () => {
    expect(validateSnapshot({ takenOn: addDays(TODAY, -40), note: "" }, TODAY).ok).toBe(true);
    expect(validateSnapshot({ takenOn: addDays(TODAY, 1), note: "" }, TODAY)).toEqual({
      ok: false,
      errors: { takenOn: "The day can't be after today." },
    });
    expect(validateSnapshot({ takenOn: "", note: "" }, TODAY)).toEqual({
      ok: false,
      errors: { takenOn: "Enter the day the counts are for." },
    });
  });
});

describe("chart text, comparison and Markdown", () => {
  it("summarises the shape over the snapshots, a gap where run times are missing", () => {
    const points = shapePoints(TEST_PYRAMID.snapshots ?? [], "runtime");
    expect(points[0].percents).toBeNull();
    expect(points[0].shape).toBe("No run times");
    const byCount = shapeChartText(shapePoints(TEST_PYRAMID.snapshots ?? [], "count"));
    expect(byCount.summary).toMatch(
      /went from hourglass to pyramid; unit tests rose from 59% to 82%/
    );
    expect(byCount.table.rows).toHaveLength(2);
  });

  it("sets a snapshot beside today's counts", () => {
    const c = compareWithNow((TEST_PYRAMID.snapshots ?? [])[0], TEST_PYRAMID);
    expect(c.thenShape).toBe("Hourglass");
    expect(c.nowShape).toBe("Pyramid");
    expect(c.rows[0]).toMatchObject({ layer: "unit", then: 300, now: 820, change: 520 });
  });

  it("exports the verdict, the layers and the snapshots", () => {
    const md = pyramidMarkdown(TEST_PYRAMID);
    expect(md).toContain("> Ice-cream cone by run time:");
    expect(md).toContain("| Layer | Tests | Share of run time | Run time |");
    expect(md).toContain("| Unit | 820 |");
    expect(md).toContain("## Snapshots");
    expect(md).toContain("| 2026-07-01 | 300 | 90 | 120 | No run times | Before the cleanup |");
    expect(pyramidMarkdown(null)).toContain("No tests counted yet.");
  });

  it("builds an example of example snapshots that move toward a pyramid", () => {
    const ex = buildExample(TODAY);
    expect(ex.snapshots?.every((s) => s.id.startsWith("example-"))).toBe(true);
    const shapes = shapePoints(ex.snapshots ?? [], "count").map((p) => p.shape);
    expect(shapes).toEqual(["Ice-cream cone", "Hourglass", "Pyramid", "Pyramid"]);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("opens on an empty state and an in-memory example", () => {
    renderPage();
    expect(screen.getByText(/Not counted yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByText(/^Pyramid: /)).toBeInTheDocument();
    expect(doc()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.getByText(/Not counted yet/)).toBeInTheDocument();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("shows inline errors and saves nothing until every count is valid", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));
    expect(await screen.findByText("Enter the number of unit tests.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Unit tests/)).toHaveFocus();
    expect(doc()).toBeNull();
  });

  it("saves the counts, names the shape, and the agent names the same one", async () => {
    renderPage();
    typeCounts("48", "6", "46");
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));
    const verdict = "Hourglass: 48% unit, 6% integration, 46% e2e. The middle layer is thin.";
    expect(await screen.findByText(verdict)).toBeInTheDocument();
    expect(doc()).toMatchObject({ unit: 48, integration: 6, e2e: 46, updatedOn: TODAY });
    const agent = await agentState();
    expect(agent.shape).toBe("hourglass");
    expect(agent.verdict).toBe(verdict);
  });

  it("keeps the run times, weighting and snapshots when the counts are saved", async () => {
    seed(TEST_PYRAMID);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Unit tests/), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));
    await waitFor(() => expect(doc()?.unit).toBe(900));
    expect(doc()).toMatchObject({
      runtime: TEST_PYRAMID.runtime,
      weighting: "runtime",
      snapshots: TEST_PYRAMID.snapshots,
      description: TEST_PYRAMID.description,
      updatedOn: TODAY,
    });
  });

  it("writes nothing when the counts are saved unchanged", () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    const before = doc();
    fireEvent.blur(screen.getByLabelText(/^Unit tests/));
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));
    expect(doc()).toBe(before);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("reads a legacy pyramid with no run times as counts", () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    const shares = layerShares(LEGACY_TEST_PYRAMID);
    expect(screen.getByText(shapeVerdict(classifyShape(shares), shares))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Run time" })).toBeDisabled();
    expect(screen.getByText(/Run time needs the minutes of all three layers/)).toBeInTheDocument();
  });

  it("weighs by run time once all three minutes are in, and falls back when one is cleared", async () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Unit minutes/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Integration minutes/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/^End-to-end minutes/), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save minutes" }));
    await waitFor(() => expect(doc()?.runtime).toEqual({ unit: 2, integration: 3, e2e: 15 }));
    fireEvent.click(screen.getByRole("radio", { name: "Run time" }));
    await waitFor(() => expect(doc()?.weighting).toBe("runtime"));
    expect(screen.getByText(/^Ice-cream cone by run time:/)).toBeInTheDocument();
    expect((await agentState()).shape).toBe("ice-cream-cone");

    fireEvent.change(screen.getByLabelText(/^End-to-end minutes/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save minutes" }));
    await waitFor(() => expect(doc()?.weighting).toBe("count"));
    expect(doc()?.runtime).toEqual({ unit: 2, integration: 3 });
  });

  it("takes a backdated snapshot, refuses a future one, compares, and deletes with Undo", async () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    const day = screen.getByLabelText(/^Counts as of/);
    fireEvent.change(day, { target: { value: addDays(TODAY, 2) } });
    fireEvent.click(screen.getByRole("button", { name: "Take snapshot" }));
    expect(await screen.findByText("The day can't be after today.")).toBeInTheDocument();
    expect(doc()?.snapshots ?? []).toHaveLength(0);

    fireEvent.change(day, { target: { value: addDays(TODAY, -10) } });
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: "Release 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Take snapshot" }));
    await waitFor(() => expect(doc()?.snapshots).toHaveLength(1));
    expect(doc()?.snapshots?.[0]).toMatchObject({
      takenOn: addDays(TODAY, -10),
      unit: 120,
      integration: 40,
      e2e: 60,
      note: "Release 4",
    });
    expect((await agentState()).snapshotCount).toBe(1);

    const id = doc()?.snapshots?.[0].id as string;
    fireEvent.change(screen.getByLabelText(/^Compare today's counts with/), {
      target: { value: id },
    });
    expect(screen.getByRole("table", { name: /now: hourglass/ })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete the snapshot of/ })[0]);
    await waitFor(() => expect(doc()?.snapshots).toHaveLength(0));
    undoLast();
    await waitFor(() => expect(doc()?.snapshots?.map((s) => s.id)).toEqual([id]));
  });

  it("clears after a confirm, and Undo puts the document back", async () => {
    seed(TEST_PYRAMID);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(doc()).toBeNull());
    undoLast();
    await waitFor(() => expect(doc()).toEqual(TEST_PYRAMID));
  });
});
