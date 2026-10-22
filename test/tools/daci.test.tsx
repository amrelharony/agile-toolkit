import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DACIDecision } from "@/lib/stores/workspace-types";

/**
 * DACI Decision Doc: drafting a decision (with the comma / line separated
 * list fields), the KPI strip, the newest-first list, Mark decided, the
 * status picker, removal and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = p.csvData;
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

import { DaciClient } from "@/app/(tools)/daci/daci-client";

const decision = (
  id: string,
  title: string,
  status: DACIDecision["status"],
  date: string,
  extra: Partial<DACIDecision> = {}
): DACIDecision => ({ id, title, status, date, ...extra });

const decisions = () => useWorkspaceStore.getState().daciDecisions ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const addDecision = () => fireEvent.click(screen.getByRole("button", { name: "Add decision" }));
const kpi = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
/** Decision titles in display order (each card's first line). */
const listTitles = () =>
  Array.from(document.querySelectorAll("li > div > span.font-medium")).map((s) => s.textContent);

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ daciDecisions: [] });
});

describe("DACI: empty state", () => {
  it("shows zeroed KPIs and no decision list", () => {
    render(<DaciClient />);
    expect(kpi("Total")).toBe("0");
    expect(kpi("Open")).toBe("0");
    expect(kpi("Decided")).toBe("0");
    expect(screen.queryByText(/^Decisions \(/)).toBeNull();
  });
});

describe("DACI: drafting a decision", () => {
  it("saves every field, splitting the list inputs, and resets the form", () => {
    render(<DaciClient />);
    type("Decision title", "Pick a feature-flag vendor");
    type("Context", "Our homegrown flags don't scale.");
    type("Driver", "Ana");
    type("Approver", "Ben");
    // Not blurred: the raw buffers still make it into the record.
    type("Contributors (comma-separated)", "Cai, Dee ,, Eve,");
    type("Informed (comma-separated)", "Support");
    type("Options considered (one per line)", "LaunchDarkly\n\n  Unleash \r\nBuild our own\n");
    type("Recommendation", "Unleash");
    addDecision();

    expect(decisions()).toHaveLength(1);
    const d = decisions()[0];
    expect(d).toMatchObject({
      title: "Pick a feature-flag vendor",
      context: "Our homegrown flags don't scale.",
      driver: "Ana",
      approver: "Ben",
      contributors: ["Cai", "Dee", "Eve"],
      informed: ["Support"],
      options: ["LaunchDarkly", "Unleash", "Build our own"],
      recommendation: "Unleash",
      status: "open",
    });
    expect(Number.isNaN(Date.parse(d.date ?? ""))).toBe(false);

    for (const label of [
      "Decision title",
      "Driver",
      "Contributors (comma-separated)",
      "Options considered (one per line)",
    ]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    expect(kpi("Total")).toBe("1");
    expect(kpi("Open")).toBe("1");
  });

  it("commits a list field on blur and shows it joined back", () => {
    render(<DaciClient />);
    const contributors = screen.getByLabelText("Contributors (comma-separated)");
    fireEvent.change(contributors, { target: { value: "Cai,Dee,  " } });
    fireEvent.blur(contributors);
    expect(contributors).toHaveValue("Cai, Dee");

    const options = screen.getByLabelText("Options considered (one per line)");
    fireEvent.change(options, { target: { value: "A\n\nB" } });
    fireEvent.blur(options);
    expect(options).toHaveValue("A\nB");
  });

  it("a list field cleared after blurring saves as empty", () => {
    render(<DaciClient />);
    type("Decision title", "Move standup");
    const informed = screen.getByLabelText("Informed (comma-separated)");
    fireEvent.change(informed, { target: { value: "Alice, Bob" } });
    fireEvent.blur(informed);
    fireEvent.change(informed, { target: { value: "" } });
    expect(informed).toHaveValue("");
    addDecision();
    expect(decisions()[0].informed).toEqual([]);
  });

  it("does nothing without a title", () => {
    render(<DaciClient />);
    type("Driver", "Ana");
    addDecision();
    type("Decision title", "   ");
    addDecision();
    expect(decisions()).toEqual([]);
    expect(screen.getByLabelText("Driver")).toHaveValue("Ana");
  });

  // Bug: add() checked `draft.title.trim()` but saved the raw draft, so a
  // title typed with stray spaces (and a whitespace-only Driver, which then
  // rendered an empty "D:" line) was stored as typed.
  it("trims the text fields it saves", () => {
    render(<DaciClient />);
    type("Decision title", "  Pick a vendor  ");
    type("Driver", "   ");
    type("Approver", " Ben ");
    addDecision();
    expect(decisions()[0]).toMatchObject({ title: "Pick a vendor", approver: "Ben" });
    expect(decisions()[0].driver ?? "").toBe("");
    expect(screen.queryByText("D:")).toBeNull();
  });
});

describe("DACI: the decision list", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      daciDecisions: [
        decision("old", "Oldest", "implemented", "2026-09-01T09:00:00.000Z"),
        decision("bad", "No date", "open", "not a date"),
        decision("new", "Newest", "open", "2026-10-10T09:00:00.000Z", {
          context: "Why now",
          driver: "Ana",
          approver: "Ben",
          contributors: ["Cai", "Dee"],
          informed: ["Support"],
          recommendation: "Go",
        }),
        decision("mid", "Middle", "decided", "2026-10-01T09:00:00.000Z"),
      ],
    });
  });

  it("lists newest first, with a malformed date last, and counts the KPIs", () => {
    render(<DaciClient />);
    expect(screen.getByText("Decisions (4)")).toBeInTheDocument();
    expect(listTitles()).toEqual(["Newest", "Middle", "Oldest", "No date"]);
    expect(kpi("Total")).toBe("4");
    expect(kpi("Open")).toBe("2");
    // Decided counts implemented ones too.
    expect(kpi("Decided")).toBe("2");
    // The store order is untouched by the sort.
    expect(decisions().map((d) => d.id)).toEqual(["old", "bad", "new", "mid"]);
  });

  it("shows the roles, context and recommendation of a decision", () => {
    render(<DaciClient />);
    const card = screen.getByText("Newest").closest("li")!;
    expect(card).toHaveTextContent("Why now");
    expect(card).toHaveTextContent("D: Ana");
    expect(card).toHaveTextContent("A: Ben");
    expect(card).toHaveTextContent("C: Cai, Dee");
    expect(card).toHaveTextContent("I: Support");
    expect(card).toHaveTextContent("Rec: Go");
    // A bare decision shows no empty role lines.
    expect(screen.getByText("Middle").closest("li")).not.toHaveTextContent("D:");
  });

  it("Mark decided closes an open decision, and only open ones offer it", () => {
    render(<DaciClient />);
    expect(screen.queryByRole("button", { name: "Mark decided: Middle" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark decided: Newest" }));
    const saved = decisions().find((d) => d.id === "new")!;
    expect(saved.status).toBe("decided");
    // Nothing else on the record changed.
    expect(saved.contributors).toEqual(["Cai", "Dee"]);
    expect(screen.queryByRole("button", { name: "Mark decided: Newest" })).toBeNull();
    expect(kpi("Open")).toBe("1");
    expect(kpi("Decided")).toBe("3");
  });

  it("the status picker sets any status", () => {
    render(<DaciClient />);
    const trigger = screen.getByRole("combobox", { name: "Status for Middle" });
    expect(trigger).toHaveTextContent("decided");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "revisit" }));
    expect(decisions().find((d) => d.id === "mid")?.status).toBe("revisit");
    expect(kpi("Decided")).toBe("1");
  });

  it("removes exactly the clicked decision", () => {
    render(<DaciClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove decision: Middle" }));
    expect(decisions().map((d) => d.id)).toEqual(["old", "bad", "new"]);
    expect(screen.getByText("Decisions (3)")).toBeInTheDocument();
  });

  it("exports the full DACI record to CSV", () => {
    render(<DaciClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Title",
      "Context",
      "Driver",
      "Approver",
      "Contributors",
      "Informed",
      "Options",
      "Recommendation",
      "Status",
    ]);
    const newest = exported.csv?.rows.find((r) => r[1] === "Newest");
    expect(newest).toEqual([
      "2026-10-10T09:00:00.000Z",
      "Newest",
      "Why now",
      "Ana",
      "Ben",
      "Cai; Dee",
      "Support",
      "",
      "Go",
      "open",
    ]);
    const bare = exported.csv?.rows.find((r) => r[1] === "Oldest");
    expect(bare).toEqual([
      "2026-09-01T09:00:00.000Z",
      "Oldest",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "implemented",
    ]);
  });
});
