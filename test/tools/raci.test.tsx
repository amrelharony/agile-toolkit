import { describe, it, expect, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * RACI Matrix Builder: the persisted matrix, assigning R/A/C/I, validation
 * (exactly one A, at least one R), adding / renaming / removing roles and
 * activities, descriptions, Reset, and the clipboard / CSV / JSON exports.
 *
 * The RACI store is module-local and persisted, so the first test reads a
 * seeded matrix and every later test starts from Reset (three default roles
 * and activities, all blank). Both the mobile cards and the desktop table
 * render in jsdom, so most controls appear twice.
 */

// The store hydrates from localStorage when its module loads: seed it first.
vi.hoisted(() => {
  localStorage.setItem(
    "agile-toolkit:raci",
    JSON.stringify({
      state: {
        roles: [
          { id: "po", name: "Product Owner", description: "Owns the backlog" },
          { id: "dev", name: "Dev Team" },
        ],
        activities: [
          { id: "ship", name: "Ship release" },
          { id: "plan", name: "Plan sprint" },
          { id: "idle", name: "Idle" },
        ],
        matrix: {
          ship: { po: "A", dev: "A" }, // two A's and no R
          plan: { po: "A", dev: "R" }, // fine
          idle: {}, // nothing at all
        },
      },
      version: 0,
    })
  );
});

const exported = vi.hoisted(() => ({
  clipboard: undefined as string | undefined,
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
  json: undefined as unknown,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: {
    clipboardText?: string;
    csvData?: { headers: string[]; rows: (string | number)[][] };
    jsonData?: unknown;
  }) => {
    exported.clipboard = p.clipboardText;
    exported.csv = p.csvData;
    exported.json = p.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { RACIClient } from "@/app/(tools)/raci/raci-client";
import { generateRACIPrompts } from "@/lib/ai-prompts/raci";

const OPTION: Record<string, RegExp> = {
  "": /^- \(None\)/,
  R: /^R\s*Responsible/,
  A: /^A\s*Accountable/,
  C: /^C\s*Consulted/,
  I: /^I\s*Informed/,
};

/** A cell's trigger (the mobile card's; the desktop one shares its callbacks). */
const cell = (activity: string, role: string) =>
  screen.getAllByRole("combobox", { name: `${activity}: ${role}` })[0];
const cellValue = (activity: string, role: string) => cell(activity, role).textContent;

function assign(activity: string, role: string, letter: "" | "R" | "A" | "C" | "I") {
  fireEvent.pointerDown(cell(activity, role), { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(
    within(screen.getByRole("listbox")).getByRole("option", { name: OPTION[letter] })
  );
}

/** Render and press Reset: 3 default roles × 3 default activities, all blank. */
function renderFresh() {
  const view = render(<RACIClient />);
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  return view;
}

/** Column headers of the desktop table, after the corner cell. */
const roleNames = () =>
  within(screen.getByRole("table"))
    .getAllByRole("columnheader")
    .slice(1, -1)
    .map((th) => within(th).getAllByRole("button")[0].textContent);
const activityNames = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1, -1)
    .map((tr) => within(tr).getAllByRole("button")[0].textContent);

function rename(current: string, next: string) {
  const button = screen.getAllByRole("button", { name: current }).at(-1)!;
  fireEvent.click(button);
  const input = screen.getByRole("textbox", { name: `Rename ${current}` });
  fireEvent.change(input, { target: { value: next } });
  fireEvent.blur(input);
}

describe("RACI: the saved matrix", () => {
  it("loads roles, activities and assignments, and lists every validation issue", () => {
    render(<RACIClient />);
    expect(roleNames()).toEqual(["Product Owner", "Dev Team"]);
    expect(activityNames()).toEqual(["Ship release", "Plan sprint", "Idle"]);
    expect(cellValue("Ship release", "Product Owner")).toBe("A");
    expect(cellValue("Plan sprint", "Dev Team")).toBe("R");
    expect(cellValue("Idle", "Dev Team")).toBe("-");

    expect(screen.getByText("4 validation issues")).toBeInTheDocument();
    const issues = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent)
      .filter((t) => t?.startsWith('"'));
    expect(issues).toEqual([
      '"Ship release" has 2 Accountable (A) roles. Must be exactly 1.',
      '"Ship release" has no Responsible (R) role assigned. Add at least one R.',
      '"Idle" has no Accountable (A) role assigned.',
      '"Idle" has no Responsible (R) role assigned. Add at least one R.',
    ]);
    // The role's description shows in its input and as the header tooltip.
    expect(screen.getAllByLabelText("Description for role Product Owner")[0]).toHaveValue(
      "Owns the backlog"
    );
  });
});

describe("RACI: Reset", () => {
  it("starts over with the three default roles and activities, all blank", () => {
    renderFresh();
    expect(roleNames()).toEqual(["Product Owner", "Scrum Master", "Dev Team"]);
    expect(activityNames()).toEqual(["Backlog Refinement", "Sprint Planning", "Daily Standup"]);
    expect(cellValue("Sprint Planning", "Scrum Master")).toBe("-");
    // Each activity lacks both an A and an R.
    expect(screen.getByText("6 validation issues")).toBeInTheDocument();
  });
});

describe("RACI: assigning", () => {
  it("validation clears once every activity has one A and at least one R", () => {
    renderFresh();
    for (const activity of ["Backlog Refinement", "Sprint Planning", "Daily Standup"]) {
      assign(activity, "Product Owner", "A");
      assign(activity, "Dev Team", "R");
    }
    expect(cellValue("Daily Standup", "Product Owner")).toBe("A");
    expect(screen.queryByText(/validation issue/)).toBeNull();
    expect(
      screen.getByText(
        /Every activity has exactly one Accountable \(A\) and at least one Responsible/
      )
    ).toBeInTheDocument();
  });

  it("flags a second A, and C / I don't count as R", () => {
    renderFresh();
    assign("Backlog Refinement", "Product Owner", "A");
    assign("Backlog Refinement", "Scrum Master", "A");
    assign("Backlog Refinement", "Dev Team", "C");
    expect(
      screen.getByText('"Backlog Refinement" has 2 Accountable (A) roles. Must be exactly 1.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '"Backlog Refinement" has no Responsible (R) role assigned. Add at least one R.'
      )
    ).toBeInTheDocument();
  });

  it("None clears a cell", () => {
    renderFresh();
    assign("Sprint Planning", "Scrum Master", "I");
    expect(cellValue("Sprint Planning", "Scrum Master")).toBe("I");
    assign("Sprint Planning", "Scrum Master", "");
    expect(cellValue("Sprint Planning", "Scrum Master")).toBe("-");
  });
});

describe("RACI: roles and activities", () => {
  it("adds numbered roles and activities with blank cells", () => {
    renderFresh();
    fireEvent.click(screen.getAllByRole("button", { name: "Add role" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Add role" })[0]);
    expect(roleNames()).toEqual(["Product Owner", "Scrum Master", "Dev Team", "Role 1", "Role 2"]);
    expect(cellValue("Daily Standup", "Role 2")).toBe("-");

    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    expect(activityNames().at(-1)).toBe("Activity 1");
    expect(cellValue("Activity 1", "Product Owner")).toBe("-");
    // The new activity has no A and no R either.
    expect(screen.getByText("8 validation issues")).toBeInTheDocument();
  });

  it("numbers a new role after the ones already taken", () => {
    renderFresh();
    rename("Scrum Master", "Role 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Add role" })[0]);
    expect(roleNames().at(-1)).toBe("Role 2");
  });

  it("removing a role drops its column and its assignments", () => {
    renderFresh();
    assign("Sprint Planning", "Scrum Master", "A");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove role Scrum Master" })[0]);
    expect(roleNames()).toEqual(["Product Owner", "Dev Team"]);
    expect(screen.queryAllByRole("combobox", { name: /Scrum Master/ })).toEqual([]);
    // Sprint Planning lost its A again.
    expect(screen.getByText(/"Sprint Planning" has no Accountable/)).toBeInTheDocument();
    expect(exported.csv?.headers).toEqual(["Activity", "Product Owner", "Dev Team"]);
  });

  it("removes an activity, but never the last one", () => {
    renderFresh();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove activity Sprint Planning" })[0]);
    expect(activityNames()).toEqual(["Backlog Refinement", "Daily Standup"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove activity Daily Standup" })[0]);
    expect(activityNames()).toEqual(["Backlog Refinement"]);
    expect(screen.queryByRole("button", { name: /Remove activity/ })).toBeNull();
  });

  it("the desktop table never offers to remove the last role", () => {
    renderFresh();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove role Product Owner" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove role Scrum Master" })[0]);
    expect(roleNames()).toEqual(["Dev Team"]);
    expect(screen.queryByRole("button", { name: /Remove role/ })).toBeNull();
  });

  it("renames a role and an activity; a blank rename keeps the old name", () => {
    renderFresh();
    rename("Scrum Master", "  Agile Coach  ");
    rename("Daily Standup", "Daily Scrum");
    expect(roleNames()).toEqual(["Product Owner", "Agile Coach", "Dev Team"]);
    expect(activityNames()).toEqual(["Backlog Refinement", "Sprint Planning", "Daily Scrum"]);
    expect(cell("Daily Scrum", "Agile Coach")).toBeInTheDocument();

    rename("Dev Team", "   ");
    expect(roleNames()).toEqual(["Product Owner", "Agile Coach", "Dev Team"]);
  });

  it("saves trimmed descriptions, and a blank one clears it", () => {
    renderFresh();
    const roleDesc = screen.getAllByLabelText("Description for role Dev Team")[0];
    fireEvent.change(roleDesc, { target: { value: "  Builds the increment  " } });
    fireEvent.blur(roleDesc);
    const activityDesc = screen.getAllByLabelText("Description for activity Sprint Planning")[0];
    fireEvent.change(activityDesc, { target: { value: "Pick the sprint goal" } });
    fireEvent.blur(activityDesc);

    expect(exported.json).toMatchObject({
      roles: [
        { name: "Product Owner", description: "" },
        { name: "Scrum Master", description: "" },
        { name: "Dev Team", description: "Builds the increment" },
      ],
    });
    // Typing keeps its spaces until the blur commits.
    const again = screen.getAllByLabelText("Description for role Dev Team")[0];
    fireEvent.change(again, { target: { value: "a b " } });
    expect(again).toHaveValue("a b ");
    fireEvent.change(again, { target: { value: "   " } });
    fireEvent.blur(again);
    expect((exported.json as { roles: { description: string }[] }).roles[2].description).toBe("");
  });
});

describe("RACI: exports", () => {
  function fill() {
    renderFresh();
    assign("Backlog Refinement", "Product Owner", "A");
    assign("Backlog Refinement", "Dev Team", "R");
    assign("Sprint Planning", "Scrum Master", "C");
  }

  it("copies an aligned plain-text matrix", () => {
    fill();
    const lines = exported.clipboard!.split("\n");
    expect(lines.slice(0, 2)).toEqual(["RACI Matrix", ""]);
    expect(lines).toContain("Roles");
    expect(lines).toContain("  - Product Owner");
    expect(lines).toContain("Activities");
    const header = lines.find((l) => l.startsWith("Activity "))!;
    expect(header).toBe("Activity           | Product Owner | Scrum Master | Dev Team");
    expect(lines).toContain("Backlog Refinement | A             | -            | R       ");
    expect(lines).toContain("Sprint Planning    | -             | C            | -       ");
  });

  it("writes the matrix plus a reference table to CSV", () => {
    fill();
    expect(exported.csv?.headers).toEqual([
      "Activity",
      "Product Owner",
      "Scrum Master",
      "Dev Team",
    ]);
    const rows = exported.csv!.rows;
    expect(rows.slice(0, 3)).toEqual([
      ["Backlog Refinement", "A", "", "R"],
      ["Sprint Planning", "", "C", ""],
      ["Daily Standup", "", "", ""],
    ]);
    expect(rows[3]).toEqual(["", "", "", ""]);
    expect(rows[4]).toEqual(["Reference", "", "", ""]);
    expect(rows[5]).toEqual(["Role", "Description", "", ""]);
    // Every row is as wide as the header.
    expect(rows.every((r) => r.length === 4)).toBe(true);
  });

  it("exports assignments to JSON keyed by role name", () => {
    fill();
    const json = exported.json as {
      activities: { name: string; assignments: Record<string, string> }[];
    };
    expect(json.activities[0]).toEqual({
      name: "Backlog Refinement",
      description: "",
      assignments: { "Product Owner": "A", "Scrum Master": "", "Dev Team": "R" },
    });
  });

  // Bug: assignments were keyed by role name, so two roles with the same name
  // collapsed in Object.fromEntries and one role's letters silently vanished
  // from the JSON export (the CSV and clipboard kept both columns).
  it("keeps both roles' assignments when two roles share a name", () => {
    fill();
    rename("Scrum Master", "Dev Team");
    assign("Daily Standup", "Dev Team", "I");
    const json = exported.json as {
      roles: { name: string }[];
      activities: { name: string; assignments: Record<string, string> }[];
    };
    expect(json.roles.map((r) => r.name)).toEqual(["Product Owner", "Dev Team", "Dev Team"]);
    expect(json.activities.map((a) => a.assignments)).toEqual([
      { "Product Owner": "A", "Dev Team": "", "Dev Team (2)": "R" },
      { "Product Owner": "", "Dev Team": "C", "Dev Team (2)": "" },
      { "Product Owner": "", "Dev Team": "I", "Dev Team (2)": "" },
    ]);
  });
});

describe("RACI: AI prompt", () => {
  const roles = [
    { id: "po", name: "Product Owner" },
    { id: "dev", name: "Dev Team" },
  ];
  const activities = [
    { id: "ship", name: "Ship release" },
    { id: "plan", name: "Plan sprint" },
  ];

  it("has no prompt without roles or activities", () => {
    expect(generateRACIPrompts({ roles: [], activities, matrix: {} })).toEqual([]);
    expect(generateRACIPrompts({ roles, activities: [], matrix: {} })).toEqual([]);
  });

  it("tabulates the matrix and flags missing or doubled Accountables", () => {
    const [prompt] = generateRACIPrompts({
      roles,
      activities,
      matrix: { ship: { po: "A", dev: "A" }, plan: { dev: "R" } },
    });
    expect(prompt.prompt).toContain("| Ship release | A | A |");
    expect(prompt.prompt).toContain("| Plan sprint | - | R |");
    expect(prompt.prompt).toContain('"Ship release" has 2 Accountable roles (should be 1)');
    expect(prompt.prompt).toContain('"Plan sprint" has no Accountable role');
  });

  // Bug: the page flags an activity with no Responsible (R), but the prompt's
  // "Validation Warnings" only checked A, so it called that matrix clean.
  it("warns about an activity with no Responsible, as the page does", () => {
    const [prompt] = generateRACIPrompts({
      roles,
      activities,
      matrix: { ship: { po: "A", dev: "C" }, plan: { po: "A", dev: "R" } },
    });
    expect(prompt.prompt).toContain("## Validation Warnings");
    expect(prompt.prompt).toContain('"Ship release" has no Responsible role');
    expect(prompt.prompt).not.toContain('"Plan sprint" has no');
  });
});
