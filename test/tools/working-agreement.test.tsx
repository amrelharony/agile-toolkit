import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CharterRule, WorkingAgreement } from "@/lib/stores/workspace-types";

/**
 * Working Agreement Builder: the starter catalog, custom rules, editing a
 * rule's text and who agreed, the still-working check-in, the KPIs, team
 * name / description, publishing a version and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";

const WA_ID = "workingAgreement:current";

const doc = () =>
  (useWorkspaceStore.getState().workingAgreements ?? []).find((d) => d.id === WA_ID);
const seed = (rules: CharterRule[], meta: WorkingAgreement["meta"] = { version: 0 }) =>
  useWorkspaceStore.setState({ workingAgreements: [{ id: WA_ID, rules, meta }] });
const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  ...extra,
});

const kpi = (label: string) => {
  const span = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  return span.parentElement!.parentElement!.textContent ?? "";
};
/** The rule count next to a category heading in the rule list. */
const countOf = (label: string) =>
  screen
    .getAllByText(label)
    .map((el) => el.nextElementSibling)
    .find((el) => el?.classList.contains("font-data"))?.textContent;
const catalogButton = (text: string) => screen.getByText(text).closest("button")!;
const ruleRow = (text: string) =>
  screen.getByRole("button", { name: `Remove ${text}` }).closest(".rounded-lg") as HTMLElement;

function choose(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  logs.length = 0;
  exported.csv = undefined;
  useWorkspaceStore.setState({ workingAgreements: [] });
});

describe("Working Agreement: empty charter", () => {
  it("prompts to start, with neutral KPIs and publishing disabled", () => {
    render(<WorkingAgreementClient />);
    expect(screen.getByText("Empty charter.")).toBeInTheDocument();
    expect(kpi("Total rules")).toBe("Total rules0");
    expect(kpi("Version")).toBe("Versionv0unpublished");
    expect(kpi("Adherence")).toBe("Adherence—no check-ins");
    expect(kpi("With agreement")).toBe("With agreement0%rules signed");
    expect(screen.getByRole("button", { name: /Publish v1/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "New check-in round" })).toBeNull();
  });
});

describe("Working Agreement: adding rules", () => {
  it("adds a catalog rule once and hides it from the catalog", () => {
    render(<WorkingAgreementClient />);
    fireEvent.click(catalogButton("Critique the work, not the person"));
    expect(doc()?.rules).toEqual([
      expect.objectContaining({
        category: "conflict",
        text: "Critique the work, not the person",
        agreedBy: [],
      }),
    ]);
    expect(logs[0]).toMatchObject({ action: "rule_added", payload: { source: "catalog" } });
    // Gone from the catalog, shown in the rule list under its category.
    expect(screen.queryByText("Critique the work, not the person")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Critique the work, not the person" })
    ).toBeInTheDocument();
    expect(kpi("Total rules")).toBe("Total rules1");
    expect(screen.queryByText("Empty charter.")).toBeNull();
  });

  it("adds a trimmed custom rule in the chosen category and clears the form", () => {
    render(<WorkingAgreementClient />);
    choose(screen.getByRole("combobox", { name: "Rule category" }), "Meetings");
    fireEvent.change(screen.getAllByRole("textbox", { name: "Rule text" })[0], {
      target: { value: "  Demos on Thursdays " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rule description" }), {
      target: { value: "  So the PO can join  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(doc()?.rules[0]).toMatchObject({
      category: "meetings",
      text: "Demos on Thursdays",
      description: "So the PO can join",
      agreedBy: [],
    });
    expect(screen.getAllByRole("textbox", { name: "Rule text" })[0]).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Rule description" })).toHaveValue("");
    expect(screen.getByText("So the PO can join")).toBeInTheDocument();
    expect(logs[0]).toMatchObject({ action: "rule_added", payload: { source: "custom" } });
  });

  it("ignores a blank custom rule, and adds on Enter or Ctrl+Enter", () => {
    render(<WorkingAgreementClient />);
    const text = screen.getAllByRole("textbox", { name: "Rule text" })[0];
    fireEvent.change(text, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(doc()).toBeUndefined();

    fireEvent.change(text, { target: { value: "First" } });
    fireEvent.keyDown(text, { key: "Enter" });
    fireEvent.change(screen.getAllByRole("textbox", { name: "Rule text" })[0], {
      target: { value: "Second" },
    });
    const desc = screen.getByRole("textbox", { name: "Rule description" });
    fireEvent.keyDown(desc, { key: "Enter" });
    expect(doc()?.rules.map((r) => r.text)).toEqual(["First"]);
    fireEvent.keyDown(desc, { key: "Enter", metaKey: true });
    expect(doc()?.rules.map((r) => r.text)).toEqual(["First", "Second"]);
    // The default category is Communication; no description stored when blank.
    expect(doc()?.rules[0]).toMatchObject({ category: "communication", description: undefined });
  });

  it("hides a catalog rule once a custom rule with the same text and category exists", () => {
    seed([rule("r1", "Critique the work, not the person", { category: "conflict" })]);
    render(<WorkingAgreementClient />);
    expect(screen.queryAllByText("Critique the work, not the person")).toHaveLength(0);
    // The same text in another category doesn't hide it.
    act(() => seed([rule("r1", "Critique the work, not the person", { category: "other" })]));
    expect(catalogButton("Critique the work, not the person")).toBeInTheDocument();
  });

  it("removes only the chosen rule", () => {
    seed([rule("r1", "Pair on hard bugs"), rule("r2", "No Friday deploys")]);
    render(<WorkingAgreementClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Pair on hard bugs" }));
    expect(doc()?.rules.map((r) => r.id)).toEqual(["r2"]);
    expect(logs.at(-1)).toMatchObject({
      action: "rule_removed",
      payload: { ruleId: "r1", text: "Pair on hard bugs" },
    });
  });

  it("groups rules by category in a fixed order with a count", () => {
    seed([
      rule("r1", "Escalate in a day", { category: "conflict" }),
      rule("r2", "Async first", { category: "communication" }),
      rule("r3", "Reply within 4h", { category: "communication" }),
    ]);
    render(<WorkingAgreementClient />);
    const rows = screen
      .getAllByRole("button", { name: /^Remove / })
      .map((b) => b.getAttribute("aria-label"));
    expect(rows).toEqual([
      "Remove Async first",
      "Remove Reply within 4h",
      "Remove Escalate in a day",
    ]);
    expect(countOf("Communication")).toBe("2");
    expect(countOf("Conflict")).toBe("1");
    // Categories without rules get no heading.
    expect(screen.queryByText("Work")).toBeNull();
  });
});

describe("Working Agreement: editing rules", () => {
  beforeEach(() => seed([rule("r1", "Pair on hard bugs"), rule("r2", "No Friday deploys")]));

  it("saves an edited rule text on blur", () => {
    render(<WorkingAgreementClient />);
    const text = within(ruleRow("Pair on hard bugs")).getByRole("textbox", { name: "Rule text" });
    fireEvent.change(text, { target: { value: "Pair on every hard bug" } });
    expect(doc()?.rules[0].text).toBe("Pair on hard bugs");
    fireEvent.blur(text);
    expect(doc()?.rules[0].text).toBe("Pair on every hard bug");
    expect(logs.at(-1)).toMatchObject({
      action: "rule_updated",
      payload: { ruleId: "r1", text: "Pair on every hard bug" },
    });
  });

  it("parses who agreed from a comma list, dropping blanks", () => {
    render(<WorkingAgreementClient />);
    const agreed = within(ruleRow("Pair on hard bugs")).getByRole("textbox", { name: "Agreed by" });
    fireEvent.change(agreed, { target: { value: " Ann, , Bob ,Cy ," } });
    expect(doc()?.rules[0].agreedBy).toEqual([]);
    fireEvent.blur(agreed);
    expect(doc()?.rules[0].agreedBy).toEqual(["Ann", "Bob", "Cy"]);
    expect(agreed).toHaveValue("Ann, Bob, Cy");
    expect(kpi("With agreement")).toContain("50%");
    expect(logs.at(-1)).toMatchObject({
      action: "rule_updated",
      payload: { ruleId: "r1", agreedBy: ["Ann", "Bob", "Cy"] },
    });

    fireEvent.change(agreed, { target: { value: "" } });
    fireEvent.blur(agreed);
    expect(doc()?.rules[0].agreedBy).toEqual([]);
    expect(kpi("With agreement")).toContain("0%");
  });

  it("checks a rule in as Working, then flips Working ↔ Not working", () => {
    render(<WorkingAgreementClient />);
    const status = () =>
      within(ruleRow("Pair on hard bugs")).getByRole("button", { name: /still-working status/ });
    expect(status()).toHaveAccessibleName("Check in (still-working status for Pair on hard bugs)");
    fireEvent.click(status());
    expect(doc()?.rules[0].stillWorking).toBe(true);
    expect(status()).toHaveTextContent("Working");
    expect(kpi("Adherence")).toBe("Adherence100%still working");
    expect(screen.getByText(/1 of 2 rules checked in this round/)).toBeInTheDocument();

    fireEvent.click(status());
    expect(doc()?.rules[0].stillWorking).toBe(false);
    expect(status()).toHaveTextContent("Not working");
    expect(kpi("Adherence")).toBe("Adherence0%still working");

    fireEvent.click(status());
    expect(doc()?.rules[0].stillWorking).toBe(true);
    expect(logs.map((l) => l.payload.stillWorking)).toEqual([true, false, true]);
  });
});

describe("Working Agreement: adherence", () => {
  it("rates adherence over checked-in rules only", () => {
    seed([
      rule("r1", "A", { stillWorking: true }),
      rule("r2", "B", { stillWorking: true }),
      rule("r3", "C", { stillWorking: false }),
      rule("r4", "D"),
    ]);
    render(<WorkingAgreementClient />);
    expect(kpi("Adherence")).toBe("Adherence67%still working");
    expect(screen.getByText(/3 of 4 rules checked in this round/)).toBeInTheDocument();
  });

  it("says rule, not rules, for a one-rule charter", () => {
    seed([rule("r1", "A")]);
    render(<WorkingAgreementClient />);
    expect(screen.getByText(/0 of 1 rule checked in this round/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New check-in round" })).toBeDisabled();
  });
});

describe("Working Agreement: charter meta and publishing", () => {
  it("publishes the next version with a timestamp", () => {
    seed([rule("r1", "A")], { version: 2, teamName: "Otters" });
    render(<WorkingAgreementClient />);
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: /Publish v3/ }));
    const meta = doc()!.meta;
    expect(meta.version).toBe(3);
    expect(meta.teamName).toBe("Otters");
    expect(Date.parse(meta.publishedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(kpi("Version")).toContain("v3");
    expect(kpi("Version")).not.toContain("unpublished");
    expect(screen.getByRole("button", { name: /Publish v4/ })).toBeEnabled();
    expect(logs.at(-1)).toMatchObject({
      action: "charter_published",
      payload: { version: 3, ruleCount: 1, teamName: "Otters" },
    });
  });

  it("saves a trimmed team name and description on blur, and clears them when blank", () => {
    seed([rule("r1", "A")]);
    render(<WorkingAgreementClient />);
    const team = screen.getByRole("textbox", { name: "Team name" });
    fireEvent.change(team, { target: { value: "  Otters " } });
    expect(doc()?.meta.teamName).toBeUndefined();
    fireEvent.blur(team);
    expect(doc()?.meta.teamName).toBe("Otters");
    expect(team).toHaveValue("Otters");

    const desc = screen.getByRole("textbox", { name: "Charter description" });
    fireEvent.change(desc, { target: { value: " How we work " } });
    fireEvent.blur(desc);
    expect(doc()?.meta.description).toBe("How we work");

    fireEvent.change(team, { target: { value: "   " } });
    fireEvent.blur(team);
    expect(doc()?.meta.teamName).toBeUndefined();
    expect(team).toHaveValue("");
    // Version untouched by meta edits.
    expect(doc()?.meta.version).toBe(0);
  });

  it("shows a team name set elsewhere", () => {
    seed([rule("r1", "A")]);
    render(<WorkingAgreementClient />);
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue("");
    act(() => seed([rule("r1", "A")], { version: 0, teamName: "Badgers" }));
    expect(screen.getByRole("textbox", { name: "Team name" })).toHaveValue("Badgers");
  });
});

describe("Working Agreement: export", () => {
  it("exports one CSV row per rule with signers and check-in", () => {
    seed([
      rule("r1", "A", { agreedBy: ["Ann", "Bob"], stillWorking: true, description: "Why" }),
      rule("r2", "B", { stillWorking: false, category: "meetings" }),
      rule("r3", "C"),
    ]);
    render(<WorkingAgreementClient />);
    expect(exported.csv?.headers).toEqual([
      "Category",
      "Rule",
      "Description",
      "Agreed By",
      "Still Working?",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["work", "A", "Why", "Ann; Bob", "Yes"],
      ["meetings", "B", "", "", "No"],
      ["work", "C", "", "", ""],
    ]);
  });
});
