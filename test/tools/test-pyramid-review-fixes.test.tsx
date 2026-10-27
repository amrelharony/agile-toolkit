import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TEST_PYRAMID_ID } from "@/lib/quality/pyramid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TestPyramid } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { LEGACY_TEST_PYRAMID, TEST_PYRAMID } from "../stores/phase8-fixtures";

/**
 * Test Pyramid, after review: the snapshot comparison weighs the layers as
 * the page does (so "now" names the Shape card's shape, and a snapshot with
 * no minutes reads "No run times" by run time), a share that isn't there
 * reads "—" rather than "—%", the chart summary counts the snapshots with
 * shares, the forms stay mounted across a save (focus stays on Save; an
 * agent's save never replaces unsaved typing), an unchanged minutes save
 * writes nothing, focus has somewhere to go after a delete or a clear, and
 * the all-zero document the old page wrote on a blur still opens on the
 * empty state and the example.
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

import { TestPyramidClient } from "@/app/(tools)/test-pyramid/test-pyramid-client";
import { buildExample } from "@/app/(tools)/test-pyramid/example";
import {
  compareWithNow,
  dayLabel,
  shapeChartText,
  shapePoints,
  shareText,
} from "@/app/(tools)/test-pyramid/view";

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

/** Focus a button and press it, as a keyboard user does. */
const press = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

beforeEach(() => {
  seed(null);
  toastSpy.mockReset();
  logSpy.mockReset();
});

describe("the snapshot comparison, on the page's weighting", () => {
  const ex = buildExample(TODAY);
  const [first, , , last] = ex.snapshots ?? [];

  it("names both shapes by run time when the page weighs by run time", () => {
    // tps-4 by count is a pyramid; by its minutes (4 / 10 / 31) an ice-cream cone.
    expect(compareWithNow(last, ex).nowShape).toBe("Pyramid");
    const byTime = compareWithNow(last, ex, "runtime");
    expect(byTime).toMatchObject({
      thenShape: "Ice-cream cone",
      nowShape: "Ice-cream cone",
      basis: "by run time",
    });
    // The shares are of the minutes; the counts and their change are the tests'.
    expect(byTime.rows[2]).toMatchObject({ layer: "e2e", then: 110, now: 95, change: -15 });
    expect(byTime.rows[2].nowPct).toBe(63);
    // The same shape the snapshot table's Shape column gives that snapshot.
    expect(shapePoints(ex.snapshots ?? [], "runtime")[3].shape).toBe(byTime.thenShape);
  });

  it("reads a snapshot without minutes as 'No run times', with no shares", () => {
    const c = compareWithNow(first, ex, "runtime");
    expect(c.thenShape).toBe("No run times");
    expect(c.rows.every((r) => r.thenPct === null)).toBe(true);
    expect(c.rows[0]).toMatchObject({ then: 60, now: 1240, change: 1180 });
  });

  it("keeps the count basis by default, and words a missing share without a % sign", () => {
    expect(compareWithNow(first, ex)).toMatchObject({
      thenShape: "Ice-cream cone",
      basis: "by test count",
    });
    const empty = { ...first, unit: 0, integration: 0, e2e: 0 };
    const c = compareWithNow(empty, ex);
    expect(c.thenShape).toBe("Not counted yet");
    expect(c.rows[0].thenPct).toBeNull();
    expect(shareText(null)).toBe("—");
    expect(shareText(42)).toBe("42%");
  });

  it("captions the page's comparison with the basis, and the Shape card agrees", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Run time" }));
    expect(await screen.findByText(/^Ice-cream cone by run time:/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Compare today's counts with/), {
      target: { value: last.id },
    });
    expect(
      screen.getByRole("table", {
        name: `${dayLabel(last.takenOn)}: ice-cream cone · now: ice-cream cone (shares by run time)`,
      })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Compare today's counts with/), {
      target: { value: first.id },
    });
    const table = screen.getByRole("table", { name: /no run times · now: ice-cream cone/ });
    expect(within(table).getByText("60 (—)")).toBeInTheDocument();
    expect(within(table).queryByText(/—%/)).toBeNull();
  });
});

describe("the shape chart's summary", () => {
  it("says how many snapshots have shares when only one does", () => {
    const ex = buildExample(TODAY);
    const last = (ex.snapshots ?? [])[3];
    const text = shapeChartText(shapePoints(ex.snapshots ?? [], "runtime"));
    expect(text.summary).toBe(
      `Only 1 of 4 snapshots has layer shares: ice-cream cone on ${dayLabel(last.takenOn)}.`
    );
    expect(text.table.rows).toHaveLength(4);
  });

  it("keeps 'One snapshot so far' for a single snapshot", () => {
    const one = [(TEST_PYRAMID.snapshots ?? [])[1]];
    expect(shapeChartText(shapePoints(one, "count")).summary).toMatch(/^One snapshot so far: /);
  });
});

describe("the forms stay mounted across a save", () => {
  it("keeps focus on Save counts after the counts are saved", async () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Unit tests/), { target: { value: "300" } });
    const save = screen.getByRole("button", { name: "Save counts" });
    press(save);
    await waitFor(() => expect(doc()?.unit).toBe(300));
    expect(screen.getByRole("button", { name: "Save counts" })).toBe(save);
    expect(save).toHaveFocus();
  });

  it("keeps focus on Save minutes after the minutes are saved", async () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Unit minutes/), { target: { value: "2.456" } });
    const save = screen.getByRole("button", { name: "Save minutes" });
    press(save);
    await waitFor(() => expect(doc()?.runtime).toEqual({ unit: 2.46 }));
    expect(save).toHaveFocus();
    // The draft follows what was stored (rounded), without a remount.
    expect(screen.getByLabelText(/^Unit minutes/)).toHaveValue("2.46");
  });

  it("takes in a save from elsewhere, but never over unsaved typing", () => {
    seed(LEGACY_TEST_PYRAMID);
    renderPage();
    const unit = screen.getByLabelText(/^Unit tests/);
    act(() => seed({ ...LEGACY_TEST_PYRAMID, unit: 150 }));
    expect(unit).toHaveValue("150");

    fireEvent.change(unit, { target: { value: "999" } });
    act(() => seed({ ...LEGACY_TEST_PYRAMID, unit: 150, e2e: 70 }));
    expect(unit).toHaveValue("999");
    expect(screen.getByLabelText(/^End-to-end tests/)).toHaveValue("60");
  });
});

describe("saving the minutes", () => {
  it("writes and logs nothing when they are unchanged", () => {
    seed(TEST_PYRAMID);
    renderPage();
    const before = doc();
    fireEvent.click(screen.getByRole("button", { name: "Save minutes" }));
    expect(doc()).toBe(before);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("labels the stamp as the document's last save, which a minutes save moves", async () => {
    seed(TEST_PYRAMID);
    renderPage();
    expect(screen.getByText(`Last saved ${dayLabel("2026-10-26")}.`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Unit minutes/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save minutes" }));
    await waitFor(() => expect(doc()?.updatedOn).toBe(TODAY));
    expect(screen.queryByText(/Counts last saved/)).toBeNull();
  });
});

describe("focus after a delete or a clear", () => {
  it("moves to the neighbouring snapshot's Delete, then to the snapshot form", async () => {
    seed(TEST_PYRAMID);
    renderPage();
    const [july, october] = TEST_PYRAMID.snapshots ?? [];
    press(
      screen.getAllByRole("button", { name: `Delete the snapshot of ${dayLabel(july.takenOn)}` })[0]
    );
    await waitFor(() => expect(doc()?.snapshots).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: `Delete the snapshot of ${dayLabel(october.takenOn)}`,
        })[0]
      ).toHaveFocus()
    );

    press(
      screen.getAllByRole("button", {
        name: `Delete the snapshot of ${dayLabel(october.takenOn)}`,
      })[0]
    );
    await waitFor(() => expect(doc()?.snapshots).toHaveLength(0));
    await waitFor(() => expect(screen.getByLabelText(/^Counts as of/)).toHaveFocus());
  });

  it("moves to the first count after the pyramid is cleared", async () => {
    seed(TEST_PYRAMID);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(doc()).toBeNull());
    await waitFor(() => expect(screen.getByLabelText(/^Unit tests/)).toHaveFocus());
    // The counts form followed the clear: no stale numbers left in it.
    expect(screen.getByLabelText(/^Unit tests/)).toHaveValue("");
  });
});

describe("the all-zero document the old page wrote on a blur", () => {
  /** What the old page upserted when a count field was focused and left. */
  const ZEROS: TestPyramid = { id: TEST_PYRAMID_ID, unit: 0, integration: 0, e2e: 0 };

  it("opens on the empty state and the example, not a dashboard of zeros", () => {
    seed(ZEROS);
    renderPage();
    expect(screen.getByText(/Not counted yet/)).toBeInTheDocument();
    expect(screen.queryByText("Total tests")).toBeNull();
    expect(screen.queryByRole("button", { name: "Take snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save minutes" })).toBeNull();
    // The counts form shows what is stored.
    expect(screen.getByLabelText(/^Unit tests/)).toHaveValue("0");

    fireEvent.click(screen.getByRole("button", { name: /Load an example/ }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getByText("Total tests")).toBeInTheDocument();
    // The example never touched the stored document.
    expect(doc()).toEqual(ZEROS);
  });

  it("shows the dashboard once a count above 0 is saved", async () => {
    seed(ZEROS);
    renderPage();
    fireEvent.change(screen.getByLabelText(/^Unit tests/), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save counts" }));
    await waitFor(() => expect(doc()?.unit).toBe(40));
    expect(screen.queryByText(/Not counted yet\. Enter/)).toBeNull();
    expect(screen.getByText("Total tests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take snapshot" })).toBeInTheDocument();
  });

  it("keeps the dashboard for zero counts with snapshots, which have a history to show", () => {
    seed({ ...ZEROS, snapshots: TEST_PYRAMID.snapshots });
    renderPage();
    expect(screen.queryByText(/Not counted yet\. Enter/)).toBeNull();
    expect(screen.getByRole("heading", { name: /^Snapshots/ })).toBeInTheDocument();
  });
});

describe("the guidance", () => {
  it("says what the 5-point tolerance does without promising one test can't flip a shape", () => {
    renderPage();
    expect(
      screen.getByText(/a small change between near-equal layers doesn.t flip the shape/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/one test never flips/)).toBeNull();
  });
});
