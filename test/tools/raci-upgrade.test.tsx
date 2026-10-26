import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RaciLetter, RaciMatrix, TeamMember } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  RACI_ID,
  RACI_LEGACY_KEY,
  activityIssues,
  countsByRole,
  isUntouchedDefault,
  loadWarnings,
  normalizeCell,
  normalizeRaci,
  planRaciMove,
  raciVerdict,
  removedActivity,
  removedRole,
  restoreActivity,
  restoreRole,
  toggleLetter,
  unassignedActivities,
  withCell,
  withoutActivity,
  withoutRole,
} from "@/lib/raci/model";

/**
 * RACI, upgraded: a workspace document (the old local store moves in once,
 * skipping its untouched defaults), cells holding several letters (A/R)
 * set with toggle chips, columns linked to roster people, the per-activity
 * checks counting A/R as both, load warnings with their thresholds, Undo
 * on every delete, Clear with confirm and Undo, an in-memory example and
 * the Markdown export.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const migrationMode = vi.hoisted(() => ({ value: "off" as string }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: () => migrationMode.value,
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
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { RACIClient } from "@/app/(tools)/raci/raci-client";
import { buildExample } from "@/app/(tools)/raci/example";
import { raciMarkdown } from "@/app/(tools)/raci/markdown";
import { EMPTY_NAME, validateName } from "@/app/(tools)/raci/form";
import { migrateRaciNow } from "@/app/(tools)/raci/migrate";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const matrix = (
  roles: string[],
  activities: string[],
  cells: Record<string, Record<string, RaciLetter[]>> = {}
): RaciMatrix => ({
  id: RACI_ID,
  roles: roles.map((id) => ({ id, name: id.toUpperCase() })),
  activities: activities.map((id) => ({ id, name: `Act ${id}` })),
  cells,
});

const ROSTER: TeamMember[] = [
  { id: "m1", name: "Ann" },
  { id: "m2", name: "Sam" },
];

const ws = () => useWorkspaceStore.getState();
const stored = () => normalizeRaci((ws().raciMatrices ?? []).find((d) => d.id === RACI_ID));
const seed = (doc: RaciMatrix | null, roster: TeamMember[] = ROSTER) =>
  useWorkspaceStore.setState({ raciMatrices: doc ? [doc] : [], teamMembers: roster });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <RACIClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
/** A cell's chips in the desktop table (the phone cards render the same cells). */
const cellIn = (activity: string, role: string) =>
  within(screen.getByRole("table", { name: "RACI matrix" })).getByRole("group", {
    name: `${activity}, ${role}`,
  });

beforeEach(() => {
  toastSpy.mockReset();
  migrationMode.value = "off";
  window.localStorage.clear();
  seed(null);
});

afterEach(() => seed(null, []));

/* ── The model ──────────────────────────────────────────────────────── */

describe("cells", () => {
  it("normalise to [], [R], [A], [A, R], [C] or [I], from old single letters too", () => {
    expect(normalizeCell("A")).toEqual(["A"]);
    expect(normalizeCell("a/r")).toEqual(["A", "R"]);
    expect(normalizeCell(["R", "A", "A"])).toEqual(["A", "R"]);
    expect(normalizeCell(["C", "A"])).toEqual(["A"]);
    expect(normalizeCell(["I", "C"])).toEqual(["C"]);
    expect(normalizeCell("")).toEqual([]);
    expect(normalizeCell("x")).toEqual([]);
    expect(normalizeCell(null)).toEqual([]);
  });

  it("toggle with chips: A and R together, C or I alone", () => {
    expect(toggleLetter([], "A")).toEqual(["A"]);
    expect(toggleLetter(["A"], "R")).toEqual(["A", "R"]);
    expect(toggleLetter(["A", "R"], "A")).toEqual(["R"]);
    expect(toggleLetter(["A", "R"], "C")).toEqual(["C"]);
    expect(toggleLetter(["C"], "C")).toEqual([]);
    expect(toggleLetter(["C"], "R")).toEqual(["R"]);
    expect(toggleLetter(["I"], "C")).toEqual(["C"]);
  });

  it("sets and clears a cell, dropping empty rows", () => {
    let doc = withCell(matrix(["a"], ["x"]), "x", "a", ["R", "A"]);
    expect(doc.cells).toEqual({ x: { a: ["A", "R"] } });
    doc = withCell(doc, "x", "a", []);
    expect(doc.cells).toEqual({});
  });
});

describe("reading a stored matrix", () => {
  it("reads the old zustand store, one letter per cell, and drops what doesn't fit", () => {
    const doc = normalizeRaci({
      state: {
        roles: [
          { id: "po", name: "Product Owner" },
          { id: "po", name: "Duplicate" },
          { id: "dev", name: "  " },
        ],
        activities: [{ id: "ship", name: "Ship", memberId: "stray" }],
        matrix: { ship: { po: "A", dev: "", ghost: "R" }, gone: { po: "R" } },
      },
      version: 0,
    });
    expect(doc).toEqual({
      id: RACI_ID,
      roles: [
        { id: "po", name: "Product Owner" },
        { id: "dev", name: "Unnamed role" },
      ],
      activities: [{ id: "ship", name: "Ship" }],
      cells: { ship: { po: ["A"] } },
    });
    expect(normalizeRaci(undefined)).toEqual({ id: RACI_ID, roles: [], activities: [], cells: {} });
  });
});

describe("the checks", () => {
  it("count A/R as an A and an R, and leave unassigned activities alone", () => {
    const doc = matrix(["a", "b"], ["x", "y", "z", "w"], {
      x: { a: ["A", "R"] },
      y: { a: ["A"], b: ["A"] },
      z: { a: ["C"] },
    });
    expect(activityIssues(doc).map((i) => [i.kind, i.activityId])).toEqual([
      ["many_a", "y"],
      ["no_r", "y"],
      ["no_a", "z"],
      ["no_r", "z"],
    ]);
    expect(activityIssues(doc)[0].message).toBe("“Act y” has 2 Accountable (A and B): keep one.");
    expect(unassignedActivities(doc).map((a) => a.id)).toEqual(["w"]);
  });

  it("warn when one role is Accountable for more than half of four or more activities", () => {
    const four = (aCount: number) =>
      matrix(
        ["a", "b"],
        ["1", "2", "3", "4"],
        Object.fromEntries(
          ["1", "2", "3", "4"].map((id, i) => [
            id,
            { [i < aCount ? "a" : "b"]: ["A"] as RaciLetter[] },
          ])
        )
      );
    expect(loadWarnings(four(3))).toMatchObject([
      {
        kind: "accountable_load",
        roleId: "a",
        count: 3,
        of: 4,
        message: "A is Accountable for 3 of 4 activities: share some of it out.",
      },
    ]);
    expect(loadWarnings(four(2))).toEqual([]);
    // Three activities: one A on each is fine, even all one role's.
    const three = matrix(["a"], ["1", "2", "3"], {
      1: { a: ["A"] },
      2: { a: ["A"] },
      3: { a: ["A"] },
    });
    expect(loadWarnings(three)).toEqual([]);
  });

  it("warn when an activity consults more than three roles", () => {
    const c: RaciLetter[] = ["C"];
    const doc = matrix(["a", "b", "c", "d", "e"], ["x"], {
      x: { a: ["A", "R"], b: c, c, d: c, e: c },
    });
    expect(loadWarnings(doc)).toMatchObject([
      { kind: "consulted_load", activityId: "x", count: 4 },
    ]);
    expect(loadWarnings(withCell(doc, "x", "e", []))).toEqual([]);
  });

  it("count the letters each role holds", () => {
    const doc = matrix(["a", "b"], ["x", "y"], { x: { a: ["A", "R"], b: ["I"] }, y: { a: ["C"] } });
    expect(countsByRole(doc)).toEqual([
      { roleId: "a", name: "A", R: 1, A: 1, C: 1, I: 0 },
      { roleId: "b", name: "B", R: 0, A: 0, C: 0, I: 1 },
    ]);
  });

  it("say it in one sentence", () => {
    expect(raciVerdict(matrix([], []))).toBe("No activities or roles yet.");
    expect(raciVerdict(matrix(["a"], ["x"]))).toBe("1 activity and 1 role, nothing assigned yet.");
    expect(raciVerdict(matrix(["a"], ["x", "y"], { x: { a: ["A", "R"] } }))).toBe(
      "The assigned activity has one Accountable and someone Responsible (1 activity not assigned yet)."
    );
    expect(raciVerdict(normalizeRaci(buildExample().doc))).toBe(
      "7 of 8 assigned activities have one Accountable and someone Responsible; “Incident response” has no Accountable (A)."
    );
  });
});

describe("removing and restoring", () => {
  it("brings a column back where it was, with its cells", () => {
    const doc = matrix(["a", "b", "c"], ["x", "y"], { x: { b: ["A"], a: ["R"] }, y: { b: ["C"] } });
    const removed = removedRole(doc, "b")!;
    const without = withoutRole(doc, "b");
    expect(without.cells).toEqual({ x: { a: ["R"] } });
    // A cell set meanwhile is kept; the removed one comes back.
    const back = restoreRole(withCell(without, "y", "a", ["I"]), removed);
    expect(back.roles.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(back.cells).toEqual({ x: { a: ["R"], b: ["A"] }, y: { a: ["I"], b: ["C"] } });
    expect(restoreRole(back, removed)).toBe(back);
  });

  it("brings an activity back where it was, with its row", () => {
    const doc = matrix(["a"], ["x", "y", "z"], { y: { a: ["A", "R"] } });
    const removed = removedActivity(doc, "y")!;
    const back = restoreActivity(withoutActivity(doc, "y"), removed);
    expect(back.activities.map((a) => a.id)).toEqual(["x", "y", "z"]);
    expect(back.cells).toEqual({ y: { a: ["A", "R"] } });
  });
});

describe("the old local store", () => {
  const legacy = (
    matrixCells: Record<string, Record<string, string>>,
    names?: [string[], string[]]
  ) =>
    JSON.stringify({
      state: {
        roles: (names?.[0] ?? ["Product Owner", "Scrum Master", "Dev Team"]).map((name, i) => ({
          id: `default:role-${i}`,
          name,
        })),
        activities: (names?.[1] ?? ["Backlog Refinement", "Sprint Planning", "Daily Standup"]).map(
          (name, i) => ({ id: `default:act-${i}`, name })
        ),
        matrix: matrixCells,
      },
      version: 0,
    });

  it("skips its untouched defaults and never writes over a workspace matrix", () => {
    expect(isUntouchedDefault(normalizeRaci(JSON.parse(legacy({}))))).toBe(true);
    expect(planRaciMove(legacy({}), undefined)).toBe(null);
    const assigned = legacy({ "default:act-0": { "default:role-0": "A" } });
    expect(planRaciMove(assigned, undefined)?.cells).toEqual({
      "default:act-0": { "default:role-0": ["A"] },
    });
    expect(planRaciMove(assigned, matrix(["x"], []))).toBe(null);
    expect(planRaciMove("not json", undefined)).toBe(null);
    // Renamed defaults are the team's.
    expect(
      planRaciMove(
        legacy({}, [
          ["PO", "SM", "Devs"],
          ["Refine", "Plan", "Standup"],
        ]),
        undefined
      )
    ).not.toBe(null);
  });

  it("moves once: writes, backs up, removes the key; a second run does nothing", () => {
    seed(null);
    window.localStorage.setItem(
      RACI_LEGACY_KEY,
      legacy({ "default:act-1": { "default:role-2": "R" } })
    );
    const first = migrateRaciNow(window.localStorage);
    expect(first.report).toEqual({ moved: true });
    expect(stored().cells).toEqual({ "default:act-1": { "default:role-2": ["R"] } });
    expect(window.localStorage.getItem(RACI_LEGACY_KEY)).toBe(null);
    expect(window.localStorage.getItem(`${RACI_LEGACY_KEY}:migrated`)).not.toBe(null);
    const second = migrateRaciNow(window.localStorage);
    expect(second.report).toBe(null);
    expect(stored().roles).toHaveLength(3);
  });

  it("backs up and removes an untouched default without writing it", () => {
    window.localStorage.setItem(RACI_LEGACY_KEY, legacy({}));
    migrateRaciNow(window.localStorage);
    expect(ws().raciMatrices).toEqual([]);
    expect(window.localStorage.getItem(RACI_LEGACY_KEY)).toBe(null);
  });

  it("runs from the page once it is safe to write", async () => {
    window.localStorage.setItem(
      RACI_LEGACY_KEY,
      legacy({ "default:act-2": { "default:role-1": "A" } })
    );
    migrationMode.value = "local";
    renderPage();
    await waitFor(() =>
      expect(stored().cells).toEqual({ "default:act-2": { "default:role-1": ["A"] } })
    );
    expect(window.localStorage.getItem(RACI_LEGACY_KEY)).toBe(null);
  });
});

describe("the add forms", () => {
  it("need a name and refuse one the matrix already has", () => {
    expect(validateName(EMPTY_NAME, [], "role")).toEqual({
      ok: false,
      errors: { name: "Name the person or role." },
    });
    expect(
      validateName({ name: " dev  team ", description: "" }, [{ name: "Dev Team" }], "role")
    ).toMatchObject({
      ok: false,
      errors: { name: "That role is already a column." },
    });
    expect(validateName({ name: "Release", description: " x " }, [], "activity")).toEqual({
      ok: true,
      values: { name: "Release", description: "x" },
    });
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("the page", () => {
  it("starts empty; the Scrum roles are a choice with Undo, and no errors show before anything is assigned", () => {
    renderPage();
    expect(screen.getByText(/No matrix yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start from the Scrum roles" }));
    expect(stored().roles.map((r) => r.name)).toEqual([
      "Product Owner",
      "Scrum Master",
      "Dev Team",
    ]);
    expect(screen.getByText("4 activities and 3 roles, nothing assigned yet.")).toBeInTheDocument();
    expect(screen.queryByText(/^Checks:/)).toBeNull();
    undoLast();
    expect(stored().roles).toEqual([]);
    expect(stored().activities).toEqual([]);
  });

  it("shows the example in memory only", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    const checks = screen.getByRole("list", { name: "Checks" });
    expect(checks).toHaveTextContent("Priya is Accountable for 5 of 8 activities");
    expect(checks).toHaveTextContent("“Architecture decisions” consults 4 roles");
    expect(checks).toHaveTextContent("“Incident response” has no Accountable (A)");
    fireEvent.click(
      within(cellIn("Daily standup", "Sam")).getByRole("button", { name: "Responsible" })
    );
    expect(ws().raciMatrices).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No matrix yet/)).toBeInTheDocument();
  });

  it("adds roster people as linked columns, group roles without, and refuses a blank or duplicate", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByText("Name the person or role.")).toBeInTheDocument();
    const name = screen.getByLabelText(/^Person or role/);
    fireEvent.change(name, { target: { value: "ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    fireEvent.change(screen.getByLabelText(/^Person or role/), { target: { value: "Dev Team" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(stored().roles).toMatchObject([{ name: "Ann", memberId: "m1" }, { name: "Dev Team" }]);
    expect(stored().roles[1].memberId).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/^Person or role/), { target: { value: "ANN" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByText("That role is already a column.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add everyone on the team (1)" }));
    expect(stored().roles.map((r) => r.name)).toEqual(["Ann", "Dev Team", "Sam"]);
  });

  it("sets A/R with the chips, then C alone, and the checks follow", () => {
    seed(matrix(["a", "b"], ["x"]));
    renderPage();
    const cell = () => cellIn("Act x", "A");
    fireEvent.click(within(cell()).getByRole("button", { name: "Accountable" }));
    fireEvent.click(within(cell()).getByRole("button", { name: "Responsible" }));
    expect(stored().cells).toEqual({ x: { a: ["A", "R"] } });
    expect(within(cell()).getByRole("button", { name: "Accountable" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Checks: all clear")).toBeInTheDocument();
    fireEvent.click(within(cell()).getByRole("button", { name: "Consulted" }));
    expect(stored().cells).toEqual({ x: { a: ["C"] } });
    expect(screen.getByText("Checks: 2 to look at")).toBeInTheDocument();
  });

  it("deletes a column and an activity with Undo, cells and all", () => {
    seed(matrix(["a", "b"], ["x", "y"], { x: { a: ["A"], b: ["R"] }, y: { b: ["A", "R"] } }));
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete role B" })[0]);
    expect(stored().roles.map((r) => r.id)).toEqual(["a"]);
    expect(stored().cells).toEqual({ x: { a: ["A"] } });
    undoLast();
    expect(stored().roles.map((r) => r.id)).toEqual(["a", "b"]);
    expect(stored().cells).toEqual({ x: { a: ["A"], b: ["R"] }, y: { b: ["A", "R"] } });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete activity Act y" })[0]);
    expect(stored().activities.map((a) => a.id)).toEqual(["x"]);
    undoLast();
    expect(stored().cells.y).toEqual({ b: ["A", "R"] });
  });

  it("clears the matrix with a confirm and Undo", () => {
    seed(matrix(["a"], ["x"], { x: { a: ["A"] } }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear the matrix" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear matrix" }));
    expect(stored()).toEqual({ id: RACI_ID, roles: [], activities: [], cells: {} });
    undoLast();
    expect(stored().cells).toEqual({ x: { a: ["A"] } });
  });
});

describe("the example and the export", () => {
  it("keeps every example row on example- ids", () => {
    const ex = buildExample();
    expect(ex.doc.roles.every((r) => isExampleId(r.id))).toBe(true);
    expect(ex.doc.activities.every((a) => isExampleId(a.id))).toBe(true);
    expect(ex.roster.every((m) => isExampleId(m.id))).toBe(true);
  });

  it("writes the roles, the matrix with A/R and the checks", () => {
    const ex = buildExample();
    const md = raciMarkdown(normalizeRaci(ex.doc), ex.roster);
    expect(md).toContain("- Priya (on the team): Product owner");
    expect(md).toContain("- Dev Team (group role): Everyone building the product");
    expect(md).toContain("| Roadmap | A/R | — | C | — | C |");
    expect(md).toContain("| Priya | 1 | 5 | 1 | 0 |");
    expect(md).toContain("- Priya is Accountable for 5 of 8 activities: share some of it out.");
    expect(raciMarkdown(matrix([], []), [])).toContain("No activities or roles yet.");
  });
});
