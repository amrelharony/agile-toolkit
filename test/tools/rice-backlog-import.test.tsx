import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * RICE and the shared backlog: "Import from backlog" prefills the form and
 * links the next initiative; "Add to backlog" turns a row into a backlog
 * item and links it; a "Score with…" link (?backlogItem=) preselects the
 * item. The same import + link wiring is checked in all seven method tools.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { RiceScoringClient } from "@/app/(tools)/rice-scoring/rice-scoring-client";
import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";
import { MoscowClient } from "@/app/(tools)/moscow/moscow-client";
import { IceScoreClient } from "@/app/(tools)/ice-score/ice-score-client";
import { ValueEffortMatrixClient } from "@/app/(tools)/value-effort-matrix/value-effort-matrix-client";
import { KanoModelClient } from "@/app/(tools)/kano-model/kano-model-client";
import { CostOfDelayClient } from "@/app/(tools)/cost-of-delay/cost-of-delay-client";

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

const riceRow = (
  id: string,
  title: string,
  fields: Record<string, number>
): PrioritizationItem => ({
  id,
  framework: "rice",
  title,
  score: 1,
  fields,
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const state = () => useWorkspaceStore.getState();
const rows = () => state().prioritizations ?? [];
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);

function openImportMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Import from backlog" }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("RICE: Import from backlog", () => {
  const searches = backlogItem("b1", "Saved searches", {
    reach: 500,
    impact: 2,
    confidence: 90,
    effort: 3,
  });

  it("prefills the form, links the new initiative and writes edited inputs back", async () => {
    useWorkspaceStore.setState({ backlogItems: [searches, backlogItem("b2", "CSV import")] });
    render(<RiceScoringClient />);

    openImportMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Saved searches" }));

    expect(screen.getByLabelText("Initiative title")).toHaveValue("Saved searches");
    expect(screen.getByLabelText("Reach (people per quarter)")).toHaveValue(500);
    expect(screen.getByLabelText("Impact (0.25–3)")).toHaveValue(2);
    expect(screen.getByLabelText("Confidence (0–100%)")).toHaveValue(90);
    expect(screen.getByLabelText("Effort (person-months)")).toHaveValue(3);
    expect(screen.getByText("Linked to Saved searches")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Reach (people per quarter)"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    const [added] = rows();
    expect(added).toMatchObject({
      title: "Saved searches",
      backlogItemId: "b1",
      fields: { reach: 800, impact: 2, confidence: 90, effort: 3 },
    });
    // The edited input reaches the backlog item, with Undo.
    expect(storedItem("b1")?.reach).toBe(800);
    expect(undo.last?.label).toBe("Updated “Saved searches” in the backlog");
    act(() => undo.last!.revert());
    expect(storedItem("b1")?.reach).toBe(500);

    // The pending link is used up, and the row shows it's linked.
    expect(screen.queryByText("Linked to Saved searches")).toBeNull();
    const chip = screen.getByRole("link", { name: /Backlog: linked to Saved searches/ });
    expect(chip).toHaveAttribute("href", "/prioritizer");
    expect(screen.queryByRole("button", { name: "Add Saved searches to the backlog" })).toBeNull();
  });

  it("adds an unlinked initiative after the link is dismissed", async () => {
    useWorkspaceStore.setState({ backlogItems: [searches] });
    render(<RiceScoringClient />);
    openImportMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Saved searches" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't link to Saved searches" }));
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));

    expect(rows()).toHaveLength(1);
    expect(rows()[0].backlogItemId).toBeUndefined();
    expect(storedItem("b1")).toEqual(searches);
  });

  it("marks backlog items this method already scored", async () => {
    useWorkspaceStore.setState({
      backlogItems: [searches, backlogItem("b2", "CSV import")],
      prioritizations: [{ ...riceRow("r1", "Saved searches", {}), backlogItemId: "b1" }],
    });
    render(<RiceScoringClient />);
    openImportMenu();
    expect(await screen.findByRole("menuitem", { name: /Saved searches\s*scored/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "CSV import" })).toBeInTheDocument();
  });

  it("points to the Backlog Prioritizer when the backlog is empty", async () => {
    render(<RiceScoringClient />);
    openImportMenu();
    const open = await screen.findByRole("menuitem", { name: "Open the Backlog Prioritizer" });
    expect(open).toHaveAttribute("href", "/prioritizer");
  });

  it("preselects the item from a Score-with link", () => {
    useWorkspaceStore.setState({ backlogItems: [searches] });
    window.history.replaceState({}, "", "/rice-scoring?backlogItem=b1");
    render(<RiceScoringClient />);
    expect(screen.getByLabelText("Initiative title")).toHaveValue("Saved searches");
    expect(screen.getByLabelText("Reach (people per quarter)")).toHaveValue(500);
    expect(screen.getByText("Linked to Saved searches")).toBeInTheDocument();
  });
});

describe("RICE: Add to backlog", () => {
  it("creates a backlog item from the row's inputs and links the row", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        riceRow("r1", "Order tracking", { reach: 800, impact: 1.5, confidence: 70, effort: 2 }),
      ],
    });
    render(<RiceScoringClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add Order tracking to the backlog" }));

    const [created] = state().backlogItems ?? [];
    expect(created).toMatchObject({
      name: "Order tracking",
      reach: 800,
      impact: 1, // 1.5 snaps to the allowed step below
      confidence: 70,
      effort: 2,
      moscow: "should",
    });
    expect(rows()[0].backlogItemId).toBe(created.id);
    expect(undo.last?.label).toBe("Added “Order tracking” to the backlog");
    expect(screen.getByRole("link", { name: /Backlog: linked to Order tracking/ })).toBeVisible();

    act(() => undo.last!.revert());
    expect(state().backlogItems).toEqual([]);
    expect(rows()[0].backlogItemId).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Add Order tracking to the backlog" })
    ).toBeInTheDocument();
  });

  it("isn't offered on example rows", () => {
    useWorkspaceStore.setState({
      prioritizations: [riceRow("example-rice-1", "Example idea", { reach: 1 })],
    });
    render(<RiceScoringClient />);
    expect(screen.getByRole("button", { name: "Remove Example idea" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Example idea to the backlog" })).toBeNull();
  });
});

describe("every method tool", () => {
  const cases: {
    name: string;
    Client: ComponentType;
    path: string;
    titleLabel: string;
    add: string | RegExp;
    framework: PrioritizationItem["framework"];
    /** Fill the inputs the backlog can't prefill but the tool requires. */
    fill?: () => void;
  }[] = [
    {
      name: "RICE",
      Client: RiceScoringClient,
      path: "/rice-scoring",
      titleLabel: "Initiative title",
      add: /Add & score/,
      framework: "rice",
    },
    {
      name: "WSJF",
      Client: WsjfClient,
      path: "/wsjf",
      titleLabel: "Feature title",
      add: /Add & score/,
      framework: "wsjf",
    },
    {
      name: "MoSCoW",
      Client: MoscowClient,
      path: "/moscow",
      titleLabel: "Scope item",
      add: "Add",
      framework: "moscow",
    },
    {
      name: "ICE",
      Client: IceScoreClient,
      path: "/ice-score",
      titleLabel: "Title",
      add: /Add & score/,
      framework: "ice",
      // The backlog holds no ICE scores, and ICE requires all three.
      fill: () => {
        for (const label of ["Impact (1–10)", "Confidence (1–10)", "Ease (1–10)"]) {
          fireEvent.change(screen.getByLabelText(label), { target: { value: "6" } });
        }
      },
    },
    {
      name: "Value/Effort",
      Client: ValueEffortMatrixClient,
      path: "/value-effort-matrix",
      titleLabel: "Item title",
      add: "Plot",
      framework: "value-effort",
    },
    {
      name: "Kano",
      Client: KanoModelClient,
      path: "/kano-model",
      titleLabel: "Feature title",
      add: "Add",
      framework: "kano",
    },
    {
      name: "Cost of Delay",
      Client: CostOfDelayClient,
      path: "/cost-of-delay",
      titleLabel: "Initiative title",
      add: "Add",
      framework: "cost-of-delay",
    },
  ];

  it.each(cases)("$name: a Score-with link preselects, and the new row links", (c) => {
    const item = backlogItem("b1", "Passkey sign-in", {
      moscow: "must",
      value: 8,
      matrixEffort: 3,
    });
    useWorkspaceStore.setState({ backlogItems: [item] });
    window.history.replaceState({}, "", `${c.path}?backlogItem=b1`);
    render(<c.Client />);

    expect(screen.getByLabelText(c.titleLabel)).toHaveValue("Passkey sign-in");
    c.fill?.();
    fireEvent.click(screen.getByRole("button", { name: c.add }));

    const added = rows().find((r) => r.framework === c.framework);
    expect(added).toMatchObject({ title: "Passkey sign-in", backlogItemId: "b1" });
    // The prefilled inputs went in unchanged, so the backlog item didn't move.
    expect(storedItem("b1")).toEqual(item);
    const link = screen.getByRole("link", { name: /Backlog: linked to Passkey sign-in/ });
    expect(within(link).getByText("Backlog")).toBeInTheDocument();
  });

  it.each(cases)("$name: an unlinked row offers Add to backlog", (c) => {
    useWorkspaceStore.setState({
      prioritizations: [
        {
          id: "x1",
          framework: c.framework,
          title: "Offline mode",
          score: 1,
          fields:
            c.framework === "moscow"
              ? { bucket: "could" }
              : c.framework === "kano"
                ? { category: "attractive" }
                : {},
          status: "scored",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    });
    render(<c.Client />);
    fireEvent.click(screen.getByRole("button", { name: "Add Offline mode to the backlog" }));
    const [created] = state().backlogItems ?? [];
    expect(created.name).toBe("Offline mode");
    expect(rows()[0].backlogItemId).toBe(created.id);
    if (c.framework === "moscow") expect(created.moscow).toBe("could");
  });
});
