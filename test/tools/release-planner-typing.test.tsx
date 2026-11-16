/**
 * The Release Planner's item forecast while someone types: each valid
 * keystroke in Items left or the weekly counts still saves, but the
 * forecast (up to three 10,000-run simulations) waits for a pause in the
 * typing or a commit, and the points mode runs no item forecast at all.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

vi.mock("@/lib/utils/toast", () => ({ toast: Object.assign(vi.fn(), { dismiss: vi.fn() }) }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
const forecastCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/sprints/throughput-forecast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sprints/throughput-forecast")>();
  return {
    ...actual,
    throughputForecast: (...args: Parameters<typeof actual.throughputForecast>) => {
      forecastCalls.n++;
      return actual.throughputForecast(...args);
    },
  };
});

import {
  ReleasePlannerClient,
  TYPING_PAUSE_MS,
} from "@/app/(tools)/release-planner/release-planner-client";
import {
  EMPTY_CONFIG,
  useReleasePlannerStore,
  type ReleasePlannerConfig,
} from "@/app/(tools)/release-planner/store";

const config = () => useReleasePlannerStore.getState().config;
const verdict = () => screen.getByTestId("items-verdict").textContent ?? "";
const itemsBox = () => screen.getByLabelText("Items left to finish");
const countsBox = () => screen.getByLabelText("Items finished per week, oldest first");
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

const ITEMS: ReleasePlannerConfig = {
  ...EMPTY_CONFIG,
  mode: "items",
  throughputSource: "typed",
  throughputInput: "4, 4, 4, 4",
  itemsSource: "typed",
  itemsCount: 20,
  startDate: "2026-11-16",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(2026, 10, 12, 9, 0, 0));
  forecastCalls.n = 0;
  useReleasePlannerStore.setState({ config: EMPTY_CONFIG });
  useWorkspaceStore.setState({
    sprints: [],
    stories: [],
    storyMaps: [],
    ceremonyCadences: [],
    kanbanBoards: [],
    epicRoadmaps: [],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("typing in the item count mode", () => {
  it("saves each keystroke, and forecasts once the typing pauses", () => {
    useReleasePlannerStore.setState({ config: ITEMS });
    render(<ReleasePlannerClient />);
    expect(verdict()).toMatch(/^20 items are done by /);

    fireEvent.change(itemsBox(), { target: { value: "4" } });
    fireEvent.change(itemsBox(), { target: { value: "48" } });
    // Saved as typed, but the forecast still shows what was there before.
    expect(config().itemsCount).toBe(48);
    expect(verdict()).toMatch(/^20 items are done by /);
    wait(TYPING_PAUSE_MS - 1);
    expect(verdict()).toMatch(/^20 items are done by /);
    wait(1);
    expect(verdict()).toMatch(/^48 items are done by /);
  });

  it("starts the wait again with each keystroke", () => {
    useReleasePlannerStore.setState({ config: ITEMS });
    render(<ReleasePlannerClient />);
    fireEvent.change(itemsBox(), { target: { value: "3" } });
    wait(TYPING_PAUSE_MS - 50);
    fireEvent.change(itemsBox(), { target: { value: "30" } });
    wait(TYPING_PAUSE_MS - 50);
    // Never a forecast for the "3" on its way to "30".
    expect(verdict()).toMatch(/^20 items are done by /);
    wait(50);
    expect(verdict()).toMatch(/^30 items are done by /);
  });

  it("forecasts at once when the field commits", () => {
    useReleasePlannerStore.setState({ config: ITEMS });
    render(<ReleasePlannerClient />);
    fireEvent.change(itemsBox(), { target: { value: "48" } });
    fireEvent.blur(itemsBox());
    expect(verdict()).toMatch(/^48 items are done by /);
  });

  it("shows the weekly counts as typed while the forecast waits", () => {
    useReleasePlannerStore.setState({ config: { ...ITEMS, itemsCount: 40 } });
    render(<ReleasePlannerClient />);
    const before = verdict();
    fireEvent.change(countsBox(), { target: { value: "4, 4, 4, 4, 8" } });
    expect(config().throughputInput).toBe("4, 4, 4, 4, 8");
    expect(screen.getByText("5 weeks, about 4.8 items a week.")).toBeInTheDocument();
    expect(verdict()).toBe(before);
    wait(TYPING_PAUSE_MS);
    expect(verdict()).not.toBe(before);
  });

  it("runs no item forecast in the points mode", () => {
    useReleasePlannerStore.setState({ config: { ...ITEMS, mode: undefined } });
    render(<ReleasePlannerClient />);
    expect(screen.getByLabelText("Sprint length")).toBeInTheDocument();
    expect(forecastCalls.n).toBe(0);
    fireEvent.click(screen.getByRole("radio", { name: "Item count" }));
    expect(forecastCalls.n).toBeGreaterThan(0);
    expect(verdict()).toMatch(/^20 items are done by /);
  });
});
