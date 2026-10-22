import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * AI Safety Review Checklist: a fixed 20-item catalog in 5 sections whose
 * checked state lives in one synced singleton. Toggling writes the store,
 * the header shows done/total and a percentage progress bar, and the CSV
 * export lists every catalog item.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({
  csv: undefined as CsvData | undefined,
  json: undefined as unknown,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData, jsonData }: { csvData?: CsvData; jsonData?: unknown }) => {
    exported.csv = csvData;
    exported.json = jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { AISafetyChecklistClient } from "@/app/(tools)/ai-safety-checklist/ai-safety-checklist-client";

const CHECKLIST_ID = "aiSafetyChecklist:current";
const PII = "PII is scrubbed or never sent to the model";
const JAILBREAK = "Jailbreak attempts produce safe refusals";
const ROLLBACK = "Feature-flag rollback tested and documented";

const checks = () =>
  (useWorkspaceStore.getState().aiSafetyChecklists ?? []).find((c) => c.id === CHECKLIST_ID)
    ?.checks;
const seedChecks = (c: Record<string, boolean>) =>
  useWorkspaceStore.setState({ aiSafetyChecklists: [{ id: CHECKLIST_ID, checks: c }] });

beforeEach(() => {
  useWorkspaceStore.setState({ aiSafetyChecklists: [] });
  history.log.mockClear();
  exported.csv = undefined;
  exported.json = undefined;
});

describe("AI Safety Checklist: empty", () => {
  it("renders 5 sections of 20 unchecked items at 0%", () => {
    render(<AISafetyChecklistClient />);
    expect(screen.getByText("Completion: 0/20 (0%)")).toBeInTheDocument();
    for (const title of [
      "Data Privacy",
      "Security",
      "Content & Safety",
      "Operational",
      "Governance / NIST RMF Alignment",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(20);
    for (const b of boxes) expect(b).toHaveAttribute("aria-checked", "false");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-label", "Checklist completion 0 of 20");
    expect(useWorkspaceStore.getState().aiSafetyChecklists ?? []).toHaveLength(0);
  });
});

describe("AI Safety Checklist: toggling", () => {
  it("checks an item, creating the singleton, and updates the progress", () => {
    render(<AISafetyChecklistClient />);
    fireEvent.click(screen.getByRole("checkbox", { name: PII }));
    expect(checks()).toEqual({ "pii-scrub": true });
    expect(screen.getByRole("checkbox", { name: PII })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Completion: 1/20 (5%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    expect(history.log).toHaveBeenCalledWith("item_toggled", { id: "pii-scrub", on: true });
  });

  it("unchecks an item again and keeps the other items' state", () => {
    seedChecks({ "pii-scrub": true, jailbreak: true });
    render(<AISafetyChecklistClient />);
    expect(screen.getByText("Completion: 2/20 (10%)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: PII }));
    expect(checks()).toEqual({ "pii-scrub": false, jailbreak: true });
    expect(screen.getByText("Completion: 1/20 (5%)")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: JAILBREAK })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(history.log).toHaveBeenCalledWith("item_toggled", { id: "pii-scrub", on: false });
  });

  it("rounds the percentage and reaches 100% when everything is checked", () => {
    render(<AISafetyChecklistClient />);
    const boxes = screen.getAllByRole("checkbox");
    for (const b of boxes.slice(0, 7)) fireEvent.click(b);
    // 7/20 = 35%
    expect(screen.getByText("Completion: 7/20 (35%)")).toBeInTheDocument();
    for (const b of boxes.slice(7)) fireEvent.click(b);
    expect(screen.getByText("Completion: 20/20 (100%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("reflects a toggle made outside the page (agent / sync)", () => {
    render(<AISafetyChecklistClient />);
    act(() => seedChecks({ rollback: true }));
    expect(screen.getByRole("checkbox", { name: ROLLBACK })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByText("Completion: 1/20 (5%)")).toBeInTheDocument();
  });

  // Bug: "done" counted every truthy entry in the checks map, so an id left over
  // from a renamed/removed catalog item inflated the score (even past 100%).
  it("counts only catalog items toward completion", () => {
    seedChecks({ "pii-scrub": true, "retired-item": true, "another-old-one": true });
    render(<AISafetyChecklistClient />);
    expect(screen.getByText("Completion: 1/20 (5%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
  });
});

describe("AI Safety Checklist: export", () => {
  it("lists all 20 catalog items with yes/no and the raw checks as JSON", () => {
    seedChecks({ "pii-scrub": true, rollback: true, consent: false });
    render(<AISafetyChecklistClient />);
    expect(exported.csv?.headers).toEqual(["Section", "Item", "Done"]);
    expect(exported.csv?.rows).toHaveLength(20);
    expect(exported.csv?.rows[0]).toEqual(["Data Privacy", PII, "yes"]);
    expect(exported.csv?.rows[3]).toEqual([
      "Data Privacy",
      "User consent collected where required (GDPR/CCPA)",
      "no",
    ]);
    expect(exported.csv?.rows[15]).toEqual(["Operational", ROLLBACK, "yes"]);
    expect(exported.csv?.rows.filter((r) => r[2] === "yes")).toHaveLength(2);
    expect(exported.json).toEqual({ "pii-scrub": true, rollback: true, consent: false });
  });
});
