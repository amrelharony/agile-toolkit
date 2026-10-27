import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { addDays } from "@/lib/impediments/model";
import { FLAKY_BOARD_ID } from "@/lib/quality/flaky";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FlakyTest } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Flaky Test Scoreboard, after review: a quarantined or fixed test's
 * status day can be backdated in its edit form (a status change stamps
 * today, so triage logged after the fact was stuck on "quarantined today"),
 * with the agent's update_test taking the same day by the same checks; and
 * the editor takes focus when it opens in place of its card.
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
vi.mock("@/app/(tools)/flaky-tests/charts", () => ({
  FlakiestTestsChart: () => null,
  WeeklyNewChart: () => null,
  WeeklyControlChart: () => null,
}));

import "@/lib/actions/tools/flaky-tests";
import { FlakyTestsClient } from "@/app/(tools)/flaky-tests/flaky-tests-client";
import { draftFromTest, statusDayField, validateTest } from "@/app/(tools)/flaky-tests/test-form";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n);

const flaky = (id: string, name: string, extra: Partial<FlakyTest> = {}): FlakyTest => ({
  id,
  name,
  failureRate: 0.1,
  failures: 1,
  runs: 10,
  status: "active",
  firstSeenAt: ago(30),
  ...extra,
});

const tests = () =>
  (useWorkspaceStore.getState().flakyTestBoards ?? []).find((d) => d.id === FLAKY_BOARD_ID)
    ?.tests ?? [];
const seed = (...list: FlakyTest[]) =>
  useWorkspaceStore.setState({ flakyTestBoards: [{ id: FLAKY_BOARD_ID, tests: list }] });
const test = (id: string) => tests().find((t) => t.id === id);

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <FlakyTestsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const update = (params: Record<string, unknown>) => {
  const action = registry.get("tool.flaky_tests.update_test")!;
  return action.handler!(action.paramsSchema.parse(params), {
    userId: "u",
    source: "agent",
    squadProfileIds: [],
  }) as Promise<{ updated: boolean; reason?: string; message?: string }>;
};

beforeEach(() => {
  seed();
  toastSpy.mockReset();
  logSpy.mockReset();
});

describe("the status day in the edit form", () => {
  const quarantined = flaky("q", "checkout", { status: "quarantined", quarantinedAt: TODAY });

  it("is offered for a quarantined or fixed test only", () => {
    expect(statusDayField(quarantined)).toBe("quarantinedAt");
    expect(statusDayField(flaky("f", "f", { status: "fixed", fixedAt: TODAY }))).toBe("fixedAt");
    expect(statusDayField(flaky("a", "a"))).toBeNull();
    expect(statusDayField(undefined)).toBeNull();
    // An active test never gets a status day from the form, even a stray one.
    const active = flaky("a", "a", { fixedAt: ago(5) });
    const v = validateTest({ ...draftFromTest(active), quarantinedAt: ago(3) }, TODAY, active);
    expect(v.ok).toBe(true);
    expect(v.ok && "quarantinedAt" in v.values).toBe(false);
  });

  it("backdates the quarantine, never after today nor before the first-seen day", () => {
    const at = (day: string) =>
      validateTest({ ...draftFromTest(quarantined), quarantinedAt: day }, TODAY, quarantined);
    const ok = at(ago(20));
    expect(ok.ok && ok.values.quarantinedAt).toBe(ago(20));
    expect(at(addDays(TODAY, 1))).toEqual({
      ok: false,
      errors: { quarantinedAt: "The day can't be after today." },
    });
    // The clash is named on the day just typed, not on First seen.
    expect(at(ago(40))).toEqual({
      ok: false,
      errors: { quarantinedAt: `It can't come before the day it was first seen (${ago(30)}).` },
    });
  });

  it("keeps the stored day when left blank, and an unknown one unknown", () => {
    const blank = validateTest(
      { ...draftFromTest(quarantined), quarantinedAt: "" },
      TODAY,
      quarantined
    );
    expect(blank.ok && blank.values.quarantinedAt).toBe(TODAY);
    const legacy = flaky("l", "legacy", { status: "quarantined" });
    const v = validateTest(draftFromTest(legacy), TODAY, legacy);
    expect(v.ok).toBe(true);
    expect(v.ok && "quarantinedAt" in v.values).toBe(false);
  });

  it("still checks the first-seen day against the status day as edited", () => {
    const v = validateTest(
      { ...draftFromTest(quarantined), firstSeenAt: ago(10), quarantinedAt: ago(15) },
      TODAY,
      quarantined
    );
    expect(v).toEqual({
      ok: false,
      errors: { quarantinedAt: `It can't come before the day it was first seen (${ago(10)}).` },
    });
    const both = validateTest(
      { ...draftFromTest(quarantined), firstSeenAt: ago(25), quarantinedAt: ago(20) },
      TODAY,
      quarantined
    );
    expect(both.ok && both.values).toMatchObject({ firstSeenAt: ago(25), quarantinedAt: ago(20) });
  });

  it("saves a backdated quarantine on the page, which raises the 14-day alert", async () => {
    seed(flaky("q", "checkout", { status: "quarantined", quarantinedAt: TODAY }));
    renderPage();
    expect(screen.queryByText(/Quarantined 14 days or more:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit checkout" }));
    const editor = screen.getByRole("region", { name: "Edit “checkout”" });
    const day = within(editor).getByLabelText(/^Quarantined since/);
    expect(day).toHaveValue(TODAY);
    fireEvent.change(day, { target: { value: ago(20) } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(test("q")?.quarantinedAt).toBe(ago(20)));
    expect(screen.getByText(/Quarantined 14 days or more:/)).toBeInTheDocument();
  });

  it("backdates a fix on the page, and the agent's update_test stores the same", async () => {
    seed(flaky("f", "search", { status: "fixed", fixedAt: TODAY }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit search" }));
    const editor = screen.getByRole("region", { name: "Edit “search”" });
    fireEvent.change(within(editor).getByLabelText(/^Fixed on/), { target: { value: ago(6) } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(test("f")?.fixedAt).toBe(ago(6)));
    const byPage = test("f");

    seed(flaky("f", "search", { status: "fixed", fixedAt: TODAY }));
    expect(await update({ testId: "f", patch: { fixedAt: ago(6) } })).toEqual({ updated: true });
    expect(test("f")).toEqual(byPage);
  });

  it("refuses the agent a status day the test isn't in, or out of order", async () => {
    seed(
      flaky("a", "alpha"),
      flaky("q", "checkout", { status: "quarantined", quarantinedAt: TODAY })
    );
    expect(await update({ testId: "a", patch: { quarantinedAt: ago(2) } })).toMatchObject({
      updated: false,
      reason: "wrong_status",
    });
    expect(await update({ testId: "q", patch: { quarantinedAt: ago(40) } })).toEqual({
      updated: false,
      reason: "invalid_date",
      message: `quarantinedAt: It can't come before the day it was first seen (${ago(30)}).`,
    });
    expect(await update({ testId: "q", patch: { quarantinedAt: addDays(TODAY, 1) } })).toEqual({
      updated: false,
      reason: "invalid_date",
      message: "quarantinedAt: The day can't be after today.",
    });
    expect(test("q")?.quarantinedAt).toBe(TODAY);
  });
});

describe("the editor in place of a card", () => {
  it("takes focus on its first field when it opens", () => {
    seed(flaky("a", "alpha"));
    renderPage();
    const edit = screen.getByRole("button", { name: "Edit alpha" });
    edit.focus();
    fireEvent.click(edit);
    const editor = screen.getByRole("region", { name: "Edit “alpha”" });
    expect(within(editor).getByLabelText(/^Test name/)).toHaveFocus();
  });
});
