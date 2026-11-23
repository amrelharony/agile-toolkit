import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Epic, StrategyMap } from "@/lib/stores/workspace-types";

/**
 * The Epic Roadmap's Now, Next, Later board (tools plan, phase 2, N25):
 * the view switch (Timeline stays the default, the pickers only show
 * there), the columns read from quarters, a move by hand with Undo and
 * back to its quarters (never touching them, focus kept on the select),
 * the mismatch hint, the crowded note, Done folded away, the From link
 * and the "Why:" line of an epic sent from an Impact Map, `?epic=` focus,
 * the Markdown section and the prompt's horizon column.
 *
 * "Now" is fixed at 23 Nov 2026, so the current quarter is 2026 Q4.
 */

const h = vi.hoisted(() => ({
  logs: [] as { action: string; payload: Record<string, unknown> }[],
}));
const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children, description }: { children: ReactNode; description?: string }) => (
    <div>
      <p data-testid="page-description">{description}</p>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { prompt: string }[] } }) => (
    <pre data-testid="ai-prompt">{config.prompts.map((p) => p.prompt).join("\n")}</pre>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => h.logs.push({ action, payload }),
  }),
}));

import { EpicRoadmapClient } from "@/app/(tools)/epic-roadmap/epic-roadmap-client";
import { crowdedNote } from "@/app/(tools)/epic-roadmap/horizons-board";
import { horizonsMarkdown, toMarkdown } from "@/app/(tools)/epic-roadmap/markdown";
import { epicViews, whyLine } from "@/app/(tools)/epic-roadmap/view";
import { readRoadmapView, useRoadmapView } from "@/app/(tools)/epic-roadmap/view-store";
import { metadata } from "@/app/(tools)/epic-roadmap/page";
import { getToolById } from "@/lib/constants/tools";

const NOW = new Date("2026-11-23T12:00:00Z");
const ER_ID = "epicRoadmap:current";

const epic = (
  id: string,
  title: string,
  start: string,
  end: string,
  extra: Partial<Epic> = {}
): Epic => ({ id, title, startQuarter: start, endQuarter: end, progress: 0, ...extra });

const MAP: StrategyMap = {
  id: "strategyMap_1",
  format: "impact-map",
  title: "Fewer refund calls",
  nodes: [
    { id: "g", parentId: null, level: 0, text: "Fewer refund calls" },
    { id: "a", parentId: "g", level: 1, text: "Shop owners" },
    { id: "i", parentId: "a", level: 2, text: "Refund without calling us" },
    { id: "d", parentId: "i", level: 3, text: "Refund button" },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const EPICS: Epic[] = [
  epic("billing", "Usage billing", "2026 Q3", "2027 Q1", { owner: "Sam" }),
  epic("refunds", "Refund button", "2027 Q1", "2027 Q1", {
    sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_1" },
  }),
  epic("offline", "Offline mode", "2027 Q4", "2028 Q1"),
  epic("audit", "Audit log", "2026 Q1", "2026 Q2", { progress: 100 }),
];

const epics = () =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)?.epics ?? [];
const find = (id: string) => epics().find((e) => e.id === id)!;
const setEpics = (list: Epic[]) =>
  useWorkspaceStore.setState({ epicRoadmaps: [{ id: ER_ID, epics: list }] });
const renderRoadmap = () =>
  render(
    <TooltipProvider>
      <EpicRoadmapClient />
    </TooltipProvider>
  );
const undoLast = () => act(() => toastSpy.mock.calls.at(-1)![1].action.onClick());
const column = (label: RegExp) => screen.getByRole("region", { name: label });
const toBoard = () => fireEvent.click(screen.getByRole("radio", { name: "Now, Next, Later" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  toastSpy.mockReset();
  h.logs = [];
  useRoadmapView.setState({ view: "timeline" });
  window.history.replaceState(null, "", "/epic-roadmap");
  setEpics(EPICS);
  useWorkspaceStore.setState({
    stories: [],
    teamMembers: [],
    pokerEstimationLogs: [],
    strategyMaps: [MAP],
  });
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/epic-roadmap");
});

describe("the view switch", () => {
  it("starts on the Timeline, with its quarter pickers, and switches to the board", () => {
    renderRoadmap();
    const views = screen.getByRole("radiogroup", { name: "Roadmap view" });
    expect(within(views).getByRole("radio", { name: "Timeline" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("View from")).toBeInTheDocument();
    toBoard();
    expect(useRoadmapView.getState().view).toBe("horizons");
    expect(screen.queryByText("View from")).not.toBeInTheDocument();
    expect(column(/^Now/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Timeline" }));
    expect(screen.getByText("View from")).toBeInTheDocument();
  });

  it("describes both views, in the header and in the page's metadata", () => {
    const registry = getToolById("epic-roadmap")!.description;
    expect(registry).toContain("Now, Next, Later");
    renderRoadmap();
    expect(screen.getByTestId("page-description")).toHaveTextContent(`${registry}.`);
    expect(metadata.description).toBe(registry);
    expect(metadata.title).toBe("Epic Roadmap");
  });

  it("reads anything stored but the board as the timeline", () => {
    expect(readRoadmapView("horizons")).toBe("horizons");
    expect(readRoadmapView("kanban")).toBe("timeline");
    expect(readRoadmapView(undefined)).toBe("timeline");
  });
});

describe("the board", () => {
  it("places epics from their quarters and folds Done away", () => {
    renderRoadmap();
    toBoard();
    expect(column(/^Now \(1\)/)).toHaveTextContent("Usage billing");
    expect(column(/^Next \(1\)/)).toHaveTextContent("Refund button");
    expect(column(/^Later \(1\)/)).toHaveTextContent("Offline mode");
    const done = screen.getByText("Done (1)").closest("details")!;
    expect(done).not.toHaveAttribute("open");
    expect(done).toHaveTextContent("Audit log");
    const billing = screen.getByRole("article", { name: "Usage billing" });
    expect(billing).toHaveTextContent("Owner: Sam");
    expect(billing).toHaveTextContent("2026 Q3 → 2027 Q1");
    expect(billing).toHaveTextContent("From its quarters");
    // Done epics can't be moved.
    expect(
      screen.queryByRole("combobox", { name: "Horizon for Audit log" })
    ).not.toBeInTheDocument();
  });

  it("moves an epic by hand with Undo, keeping its quarters and the focus", async () => {
    renderRoadmap();
    toBoard();
    fireEvent.change(screen.getByRole("combobox", { name: "Horizon for Offline mode" }), {
      target: { value: "now" },
    });
    expect(find("offline")).toEqual({ ...EPICS[2], horizon: "now" });
    expect(column(/^Now \(2\)/)).toHaveTextContent("Offline mode");
    const card = screen.getByRole("article", { name: "Offline mode" });
    expect(card).toHaveTextContent("Set by hand");
    expect(card).toHaveTextContent("Its quarters put it in Later.");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Horizon for Offline mode" })).toHaveFocus()
    );
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Moved “Offline mode” to Now");
    expect(h.logs).toEqual([
      { action: "horizon_changed", payload: { epicId: "offline", horizon: "now" } },
    ]);
    undoLast();
    expect(find("offline")).toEqual(EPICS[2]);
    expect(column(/^Later \(1\)/)).toHaveTextContent("Offline mode");
  });

  it("sets a moved epic back to its quarters", () => {
    setEpics([...EPICS.slice(0, 2), { ...EPICS[2], horizon: "next" }, EPICS[3]]);
    renderRoadmap();
    toBoard();
    expect(column(/^Next \(2\)/)).toHaveTextContent("Offline mode");
    fireEvent.change(screen.getByRole("combobox", { name: "Horizon for Offline mode" }), {
      target: { value: "" },
    });
    expect(find("offline")).not.toHaveProperty("horizon");
    expect(find("offline").startQuarter).toBe("2027 Q4");
    expect(column(/^Later \(1\)/)).toHaveTextContent("Offline mode");
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("“Offline mode” follows its quarters again");
    expect(h.logs).toEqual([{ action: "horizon_changed", payload: { epicId: "offline" } }]);
  });

  it("notes a crowded Now, inline", () => {
    setEpics(Array.from({ length: 4 }, (_, k) => epic(`e${k}`, `Epic ${k}`, "2026 Q4", "2027 Q1")));
    renderRoadmap();
    toBoard();
    expect(screen.getByText(crowdedNote(4))).toBeInTheDocument();
    expect(crowdedNote(5)).toBe(
      "Now holds 5 epics. Finishing some before starting more keeps the team focused."
    );
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("shows where an epic sent from an Impact Map came from, and why", () => {
    renderRoadmap();
    // The From link shows on the timeline's row too.
    const row = screen.getByRole("list", { name: "Epics, earliest start first" });
    expect(within(row).getByRole("link", { name: /From impact map/ })).toHaveAttribute(
      "href",
      "/impact-map?map=strategyMap_1"
    );
    toBoard();
    const card = screen.getByRole("article", { name: "Refund button" });
    expect(card).toHaveTextContent(
      "Why: Fewer refund calls → Shop owners → Refund without calling us"
    );
    expect(within(card).getByRole("link", { name: /From impact map/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Usage billing" })).not.toHaveTextContent("Why:");
  });

  it("has no Why line once the map is gone", () => {
    expect(whyLine(EPICS[1], [MAP])).toBe(
      "Fewer refund calls → Shop owners → Refund without calling us"
    );
    expect(whyLine(EPICS[1], [])).toBeNull();
    expect(whyLine(EPICS[0], [MAP])).toBeNull();
  });
});

describe("links, Markdown and the prompt", () => {
  it("?epic=<id> focuses that epic's row, or its card on the board", async () => {
    window.history.replaceState(null, "", "/epic-roadmap?epic=refunds");
    const { unmount } = renderRoadmap();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-epic-row")).toBe("refunds")
    );
    expect(window.location.search).toBe("");
    unmount();
    useRoadmapView.setState({ view: "horizons" });
    window.history.replaceState(null, "", "/epic-roadmap?epic=offline");
    renderRoadmap();
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Offline mode" })).toHaveFocus()
    );
  });

  it("drops a link to an epic that is gone", async () => {
    window.history.replaceState(null, "", "/epic-roadmap?epic=nope");
    renderRoadmap();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("adds the Now, Next, Later section after the verdict, rows unchanged", () => {
    const views = epicViews(
      [...EPICS.slice(0, 2), { ...EPICS[2], horizon: "next" }, EPICS[3]],
      [],
      NOW
    );
    const md = toMarkdown(views, NOW);
    expect(md).toContain("| Usage billing | 2026 Q3 | 2027 Q1 | Sam | 0% | Typed | Under way |");
    const verdict = md.indexOf("**");
    const section = md.indexOf("## Now, Next, Later");
    expect(section).toBeGreaterThan(verdict);
    expect(md).toContain("### Now (1)\n\n- Usage billing (2026 Q3 → 2027 Q1), 0%");
    expect(md).toContain("### Next (2)");
    expect(md).toContain("- Offline mode (2027 Q4 → 2028 Q1), 0%, set by hand");
    expect(md).toContain("### Later (0)\n\nNothing here yet.");
    expect(md).toContain("### Done (1)\n\n- Audit log (2026 Q1 → 2026 Q2), 100%");
    expect(horizonsMarkdown(epicViews([EPICS[0]], [], NOW), NOW)).not.toContain("### Done");
  });

  it("gives the copyable prompt each epic's horizon", () => {
    setEpics([...EPICS.slice(0, 2), { ...EPICS[2], horizon: "next" }]);
    renderRoadmap();
    const prompt = screen.getByTestId("ai-prompt").textContent ?? "";
    expect(prompt).toContain("Horizon");
    expect(prompt).toContain("Next (set by hand)");
    expect(prompt).toMatch(/Usage billing.*Now/);
  });
});
