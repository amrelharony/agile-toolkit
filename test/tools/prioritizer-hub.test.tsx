import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * The Backlog Prioritizer as the shared-backlog hub: no seed for a new
 * user, the standard example load/clear (legacy `default:item-*` seeds
 * count as example rows), the "All methods" tab with Score-with links,
 * renaming an item renames its linked rows, and deleting offers Undo.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
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

import { PrioritizerClient } from "@/app/(tools)/prioritizer/prioritizer-client";
import { buildExample } from "@/app/(tools)/prioritizer/example";
import { MoSCoWTab } from "@/app/(tools)/prioritizer/components/moscow-tab";
import { evaluateItemIn } from "@/lib/prioritization/methods";

const backlogItem = (
  id: string,
  name: string,
  partial: Partial<BacklogItem> = {}
): BacklogItem => ({
  id,
  name,
  moscow: "should",
  businessValue: 5,
  timeCriticality: 5,
  riskReduction: 5,
  jobSize: 5,
  reach: 100,
  impact: 1,
  confidence: 80,
  effort: 1,
  value: 5,
  matrixEffort: 5,
  ...partial,
});

const row = (
  id: string,
  framework: PrioritizationItem["framework"],
  extra: Partial<PrioritizationItem>
): PrioritizationItem => ({
  id,
  framework,
  title: `Row ${id}`,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
  ...extra,
});

const state = () => useWorkspaceStore.getState();
const renderHub = () =>
  render(
    <TooltipProvider>
      <PrioritizerClient />
    </TooltipProvider>
  );
/** The desktop table's copy of a control (the phone cards hold a second one). */
const first = (role: string, name: string | RegExp) => screen.getAllByRole(role, { name })[0];
/** The "All methods" table (the desktop copy): the one with a Kano column. */
const allMethodsTable = () =>
  screen
    .getAllByRole("table")
    .find((t) => within(t).queryByRole("columnheader", { name: /Kano/ }))!;
const ids = () => (state().backlogItems ?? []).map((b) => b.id);
const storedRow = (id: string) => (state().prioritizations ?? []).find((p) => p.id === id);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("a new backlog", () => {
  it("isn't seeded, even when the slice was never set", () => {
    useWorkspaceStore.setState({ backlogItems: undefined });
    renderHub();
    expect(state().backlogItems).toBeUndefined();
    expect(screen.getByText(/Your backlog is empty/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
  });

  it("starts empty, and the last item can be removed", () => {
    useWorkspaceStore.setState({ backlogItems: [backlogItem("b1", "Only one")] });
    renderHub();
    const remove = first("button", "Delete Only one");
    expect(remove).toBeEnabled();
    fireEvent.click(remove);
    expect(state().backlogItems).toEqual([]);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });
});

describe("example", () => {
  it("uses example- ids so the methods disagree on a realistic backlog", () => {
    const rows = buildExample();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.id.startsWith("example-"))).toBe(true);
    // Every bucket used, and one item not sorted yet (the example is scored unevenly).
    expect(new Set(rows.map((r) => r.moscow))).toEqual(
      new Set(["must", "should", "could", "wont", undefined])
    );
  });

  it("is stamped and on the Fibonacci scale, so every bucket reads as chosen", () => {
    const rows = buildExample("2026-10-26T09:00:00.000Z");
    expect(rows.every((r) => r.updatedAt === "2026-10-26T09:00:00.000Z")).toBe(true);
    expect(rows.every((r) => r.value === undefined)).toBe(true);
    const parts = rows
      .flatMap((r) => [r.businessValue, r.timeCriticality, r.riskReduction, r.jobSize])
      .filter((n) => n !== undefined);
    expect(parts.every((n) => [1, 2, 3, 5, 8, 13, 20].includes(n as number))).toBe(true);
    // Read through the registry (old-default fingerprints cleared): no bucket lost.
    const buckets = rows.map((r) => evaluateItemIn(r, [], "moscow").bucket);
    expect(buckets).toEqual(["must", "must", "should", "should", "could", "could", "wont", null]);
    const quadrants = new Set(rows.map((r) => evaluateItemIn(r, [], "value-effort").bucket));
    expect(quadrants).toEqual(
      new Set(["quick_wins", "big_bets", "fill_ins", "time_wasters", null])
    );
    // The card-declined fix wins WSJF; the rebuild is near the bottom.
    const wsjf = rows
      .map((r) => ({ name: r.name, score: evaluateItemIn(r, [], "wsjf").score }))
      .filter((r): r is { name: string; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score);
    expect(wsjf[0].name).toBe("Clearer card-declined message");
    expect(wsjf.findIndex((r) => r.name.startsWith("Rebuild"))).toBeGreaterThanOrEqual(5);
  });

  it("loads, and Clear example removes only the example rows", () => {
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(ids()).toEqual(buildExample().map((r) => r.id));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: /^Item/ }), {
      target: { value: "My item" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(ids()).toHaveLength(buildExample().length + 1);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(state().backlogItems).toHaveLength(1);
    expect(state().backlogItems![0].name).toBe("My item");
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });

  it("treats the legacy default:item-* seed as example rows", () => {
    useWorkspaceStore.setState({
      backlogItems: [
        backlogItem("default:item-auth", "User authentication"),
        backlogItem("mine", "My item"),
      ],
      prioritizations: [row("i1", "ice", { backlogItemId: "default:item-auth", score: 10 })],
    });
    renderHub();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ids()).toEqual(["mine"]);
    // The row that scored it stays, unlinked.
    expect(storedRow("i1")?.backlogItemId).toBeUndefined();
  });
});

describe("All methods tab", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      backlogItems: [
        backlogItem("b1", "Auth", {
          moscow: "must",
          businessValue: 9,
          timeCriticality: 8,
          riskReduction: 7,
          jobSize: 3,
          reach: 500,
          impact: 2,
          confidence: 90,
          effort: 2,
          value: 9,
          matrixEffort: 3,
        }),
        backlogItem("b2", "Dark mode"),
      ],
      prioritizations: [
        // Scores come from the fields (the engine recomputes; a cached score is never read).
        row("ice-old", "ice", {
          backlogItemId: "b1",
          score: 100,
          fields: { impact: 5, confidence: 5, ease: 4 },
        }),
        row("ice-new", "ice", {
          backlogItemId: "b1",
          score: 320,
          fields: { impact: 8, confidence: 8, ease: 5 },
          updatedAt: "2026-10-09T09:00:00.000Z",
        }),
        row("kano", "kano", { backlogItemId: "b1", fields: { category: "must-be" } }),
        row("unlinked", "cost-of-delay", { score: 5000 }),
      ],
    });
  });

  it("is the first tab and shows every method per item", () => {
    renderHub();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveTextContent("All methods");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveTextContent("Decide order");

    const table = allMethodsTable();
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.replace(", sort", ""));
    expect(headers).toEqual([
      "Item",
      "MoSCoW",
      "WSJF",
      "RICE",
      "Value/Effort",
      "ICE",
      "Kano",
      "Cost of Delay",
    ]);

    const auth = within(table).getByRole("row", { name: /^Auth/ });
    const cells = within(auth)
      .getAllByRole("cell")
      .map((c) => c.textContent);
    expect(cells.slice(0, 7)).toEqual([
      "Auth",
      "Must have",
      "8.00",
      "450",
      "Quick Wins (value 9, effort 3)",
      "320",
      "Must-be",
    ]);
    // No linked Cost of Delay row: the cell links to the tool with the item preselected.
    const codLink = within(auth).getByRole("link", { name: "Score with Cost of Delay: Auth" });
    expect(codLink).toHaveAttribute("href", "/cost-of-delay?backlogItem=b1");
  });

  it("offers Score-with links for the methods an item hasn't been scored in", () => {
    renderHub();
    const table = allMethodsTable();
    // "Dark mode" holds only the old "Add item" defaults: Not scored in every method.
    const dark = within(table).getByRole("row", { name: /^Dark mode/ });
    const links = within(dark)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/moscow?backlogItem=b2",
      "/wsjf?backlogItem=b2",
      "/rice-scoring?backlogItem=b2",
      "/value-effort-matrix?backlogItem=b2",
      "/ice-score?backlogItem=b2",
      "/kano-model?backlogItem=b2",
      "/cost-of-delay?backlogItem=b2",
    ]);
  });

  it("explains which method to pick, linking each tool", () => {
    renderHub();
    expect(screen.getByRole("heading", { name: "Which method?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kano" })).toHaveAttribute("href", "/kano-model");
    expect(screen.getByRole("link", { name: "WSJF" })).toHaveAttribute("href", "/wsjf");
  });
});

describe("MoSCoW tab", () => {
  it("groups by the registry's bucket: an old default 'should' is Not sorted yet", () => {
    render(
      <MoSCoWTab
        items={[
          backlogItem("old", "Legacy default"),
          { id: "s", name: "Chosen should", moscow: "should", updatedAt: "2026-10-01T09:00:00Z" },
          { id: "m", name: "A must", moscow: "must", updatedAt: "2026-10-01T09:00:00Z" },
        ]}
      />
    );
    const should = screen.getByRole("region", { name: "Should have" });
    expect(within(should).getByText("Chosen should")).toBeInTheDocument();
    expect(within(should).queryByText("Legacy default")).toBeNull();
    const unsorted = screen.getByRole("region", { name: "Not sorted yet" });
    expect(within(unsorted).getByText("Legacy default")).toBeInTheDocument();
    expect(within(unsorted).getByText("1 item")).toBeInTheDocument();
  });
});

describe("editing the backlog", () => {
  it("renaming an item renames the rows linked to it", () => {
    useWorkspaceStore.setState({
      backlogItems: [backlogItem("b1", "Auth"), backlogItem("b2", "Search")],
      prioritizations: [
        row("r1", "rice", { title: "Auth", backlogItemId: "b1" }),
        row("k1", "kano", { title: "Auth", backlogItemId: "b1" }),
        row("r2", "rice", { title: "Auth" }),
        row("r3", "rice", { title: "Search", backlogItemId: "b2" }),
      ],
    });
    renderHub();
    const nameInput = first("textbox", "Name of Auth");
    fireEvent.change(nameInput, { target: { value: "Passkey sign-in" } });
    fireEvent.blur(nameInput);

    expect(state().backlogItems![0].name).toBe("Passkey sign-in");
    expect(storedRow("r1")?.title).toBe("Passkey sign-in");
    expect(storedRow("k1")?.title).toBe("Passkey sign-in");
    expect(storedRow("r2")?.title).toBe("Auth");
    expect(storedRow("r3")?.title).toBe("Search");
  });

  it("deleting an item offers Undo, which restores it and its links", () => {
    useWorkspaceStore.setState({
      backlogItems: [backlogItem("b1", "Auth"), backlogItem("b2", "Search")],
      prioritizations: [row("r1", "rice", { backlogItemId: "b1" })],
    });
    renderHub();
    fireEvent.click(first("button", "Delete Auth"));
    expect(ids()).toEqual(["b2"]);
    expect(storedRow("r1")?.backlogItemId).toBeUndefined();
    expect(undo.last?.label).toBe("Deleted “Auth”");

    act(() => undo.last!.revert());
    expect(ids()).toEqual(["b2", "b1"]);
    expect(storedRow("r1")?.backlogItemId).toBe("b1");
  });
});
