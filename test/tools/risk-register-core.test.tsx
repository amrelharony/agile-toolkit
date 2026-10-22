import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Risk } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * Risk Register gap-filling: adding and editing a risk (title, P/I/status
 * selects, mitigation, due date), the score ordering and clamping, the
 * matrix and KPI counts, median time-to-mitigate, workspace import/push,
 * Undo of "Clear example", and Markdown edges. Example load/clear and
 * remove-Undo live in risk-register-example / risk-register-undo.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
const sync = vi.hoisted(() => ({
  onImport: undefined as undefined | (() => number),
  onPush: undefined as undefined | (() => number),
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
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/shared/workspace-sync-button", () => ({
  WorkspaceSyncButton: (p: { onImport: () => number; onPush: () => number }) => {
    sync.onImport = p.onImport;
    sync.onPush = p.onPush;
    return null;
  },
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

import { RiskRegisterClient } from "@/app/(tools)/risk-register/risk-register-client";
import { toMarkdown } from "@/app/(tools)/risk-register/markdown";

const KEY = "agile-toolkit:risk-register";
const NOW = new Date(2026, 9, 18);

const risk = (id: string, title: string, p: number, i: number, extra: Partial<Risk> = {}) =>
  ({
    id,
    title,
    probability: p,
    impact: i,
    status: "open",
    raisedAt: "2026-10-01",
    ...extra,
  }) as Risk;

const seed = (risks: unknown[]) => localStorage.setItem(KEY, JSON.stringify(risks));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Risk[];
const byId = (id: string) => stored().find((r) => r.id === id);

/** The score badge sits next to the risk's Remove button. */
const scoreOf = (title: string) =>
  screen.getByRole("button", { name: `Remove ${title}` }).previousElementSibling!.textContent;
const order = () =>
  screen.getAllByRole("button", { name: /^Remove / }).map((b) => b.getAttribute("aria-label"));
const kpi = (label: string) =>
  screen.getByText(label, { selector: "span.truncate" }).parentElement!.nextElementSibling!
    .textContent;
/** Matrix cells, row by row from P5 down to P1, I1 to I5 across. */
const matrixCell = (p: number, i: number) =>
  screen.getByText("5×5 Matrix").closest(".p-4")!.querySelectorAll(".h-8")[(5 - p) * 5 + (i - 1)]
    .textContent;

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  undo.last = null;
  sync.onImport = undefined;
  sync.onPush = undefined;
  localStorage.removeItem(KEY);
  useWorkspaceStore.setState({ risks: [] });
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Risk Register: adding and editing", () => {
  it("adds a blank open risk at the top, P3 × I3, raised today", () => {
    seed([risk("r1", "Vendor lock-in", 4, 4)]);
    render(<RiskRegisterClient />);
    fireEvent.click(screen.getByRole("button", { name: "New Risk" }));

    const [fresh, old] = stored();
    expect(old.id).toBe("r1");
    expect(fresh).toMatchObject({
      title: "",
      probability: 3,
      impact: 3,
      status: "open",
      raisedAt: todayLocalISO(),
    });
    expect(scoreOf("risk")).toBe("9");
    // Ranked by score: the 16 stays above the new 9.
    expect(order()).toEqual(["Remove Vendor lock-in", "Remove risk"]);
  });

  it("commits the title on blur", () => {
    seed([risk("r1", "", 3, 3)]);
    render(<RiskRegisterClient />);
    const title = screen.getByLabelText("Risk title");
    fireEvent.change(title, { target: { value: "Vendor lock-in" } });
    expect(byId("r1")!.title).toBe("");
    fireEvent.blur(title);
    expect(byId("r1")!.title).toBe("Vendor lock-in");
    expect(screen.getByRole("button", { name: "Remove Vendor lock-in" })).toBeInTheDocument();
  });

  it("rescores when probability or impact changes", () => {
    seed([risk("r1", "Vendor lock-in", 2, 2)]);
    render(<RiskRegisterClient />);
    choose("Probability for Vendor lock-in", "P5");
    choose("Impact for Vendor lock-in", "I4");
    expect(byId("r1")).toMatchObject({ probability: 5, impact: 4 });
    expect(scoreOf("Vendor lock-in")).toBe("20");
  });

  it("writes the mitigation on blur and previews it under the title", () => {
    seed([risk("r1", "Vendor lock-in", 3, 3)]);
    render(<RiskRegisterClient />);
    const plan = screen.getByLabelText("Mitigation plan for Vendor lock-in");
    fireEvent.change(plan, { target: { value: "Wrap the API behind a port" } });
    fireEvent.blur(plan);
    expect(byId("r1")!.mitigation).toBe("Wrap the API behind a port");
    expect(screen.getAllByText("Wrap the API behind a port")).toHaveLength(2);
  });

  it("sets and clears the mitigation due date", () => {
    seed([risk("r1", "Vendor lock-in", 3, 3)]);
    render(<RiskRegisterClient />);
    const due = screen.getByLabelText("Mitigation due");
    fireEvent.change(due, { target: { value: "2026-11-02" } });
    expect(byId("r1")!.mitigationDueAt).toBe("2026-11-02");
    fireEvent.change(due, { target: { value: "" } });
    expect(byId("r1")!.mitigationDueAt).toBeUndefined();
  });
});

describe("Risk Register: status", () => {
  it("stamps today on close, and keeps an earlier close date through reopen and re-close", () => {
    seed([
      risk("r1", "Vendor lock-in", 3, 3),
      risk("r2", "Key person", 2, 2, { status: "mitigating", resolvedAt: "2026-10-05" }),
    ]);
    render(<RiskRegisterClient />);

    choose("Status for Vendor lock-in", "Closed");
    expect(byId("r1")).toMatchObject({ status: "closed", resolvedAt: todayLocalISO() });

    choose("Status for Key person", "Closed");
    expect(byId("r2")).toMatchObject({ status: "closed", resolvedAt: "2026-10-05" });
    choose("Status for Key person", "Open");
    expect(byId("r2")).toMatchObject({ status: "open", resolvedAt: "2026-10-05" });
  });

  it("counts statuses, and leaves closed and accepted risks off the matrix", () => {
    seed([
      risk("a", "Open one", 4, 2),
      risk("b", "Mitigating one", 4, 2, { status: "mitigating" }),
      risk("c", "Closed one", 4, 2, { status: "closed", resolvedAt: "2026-10-04" }),
      risk("d", "Accepted one", 4, 2, { status: "accepted" }),
      risk("e", "Corner", 5, 5),
    ]);
    render(<RiskRegisterClient />);
    expect(kpi("Open")).toBe("2");
    expect(kpi("Mitigating")).toBe("1");
    expect(kpi("Closed")).toBe("1");
    expect(matrixCell(4, 2)).toBe("2");
    expect(matrixCell(5, 5)).toBe("1");
    expect(matrixCell(1, 1)).toBe("");
  });

  it("orders risks by score and clamps corrupt probability or impact into 1-5", () => {
    seed([
      risk("a", "Low", 1, 2),
      risk("b", "Corrupt high", 9, 4),
      risk("c", "Corrupt text", "x" as unknown as number, 3),
      risk("d", "Middle", 3, 3),
    ]);
    render(<RiskRegisterClient />);
    expect(order()).toEqual([
      "Remove Corrupt high",
      "Remove Middle",
      "Remove Corrupt text",
      "Remove Low",
    ]);
    expect(scoreOf("Corrupt high")).toBe("20");
    expect(scoreOf("Corrupt text")).toBe("3");
    // The corrupt rows land on the matrix's edge cells, not off the grid.
    expect(matrixCell(5, 4)).toBe("1");
    expect(matrixCell(1, 3)).toBe("1");
  });
});

describe("Risk Register: median time to mitigate", () => {
  it("shows a dash until a risk has been closed", () => {
    seed([risk("r1", "Vendor lock-in", 3, 3)]);
    render(<RiskRegisterClient />);
    expect(kpi("Median TTM")).toBe("—");
  });

  // Bug: the K-M call passed only raisedAt/resolvedAt, so a reopened risk's
  // preserved close date counted as a closure (BUG-T7-risk-register-3 added
  // the `status` input to the helper, but the register never passed it).
  it("counts a reopened risk as still open, not as mitigated", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    seed([
      risk("a", "Closed after ten days", 3, 3, { status: "closed", resolvedAt: "2026-10-11" }),
      risk("b", "Reopened", 3, 3, { status: "mitigating", resolvedAt: "2026-10-03" }),
    ]);
    render(<RiskRegisterClient />);
    expect(kpi("Median TTM")).toBe("10d");
  });
});

describe("Risk Register: workspace import and push", () => {
  it("imports only the workspace risks it doesn't have, at the top", () => {
    seed([risk("r1", "Local", 2, 2)]);
    useWorkspaceStore.setState({
      risks: [risk("r1", "Local (workspace copy)", 2, 2), risk("w1", "From workspace", 4, 4)],
    });
    render(<RiskRegisterClient />);
    let n = 0;
    act(() => {
      n = sync.onImport!();
    });
    expect(n).toBe(1);
    expect(stored().map((r) => [r.id, r.title])).toEqual([
      ["w1", "From workspace"],
      ["r1", "Local"],
    ]);
  });

  it("pushes only titled risks to the workspace", () => {
    seed([risk("r1", "Vendor lock-in", 2, 2), risk("r2", "   ", 3, 3)]);
    render(<RiskRegisterClient />);
    let n = 0;
    act(() => {
      n = sync.onPush!();
    });
    expect(n).toBe(1);
    expect((useWorkspaceStore.getState().risks ?? []).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("Risk Register: example and remove Undo", () => {
  it("puts cleared example risks back around the user's own", () => {
    render(<RiskRegisterClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "New Risk" }));
    const before = stored().map((r) => r.id);

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(undo.last!.label).toBe("Cleared the example");
    expect(stored()).toHaveLength(1);

    act(() => undo.last!.revert());
    expect(stored().map((r) => r.id)).toEqual(before);
    // A second Undo changes nothing.
    act(() => undo.last!.revert());
    expect(stored().map((r) => r.id)).toEqual(before);
  });

  it("labels the Undo of an untitled risk", () => {
    seed([risk("r1", "", 3, 3)]);
    render(<RiskRegisterClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove risk" }));
    expect(undo.last!.label).toBe("Removed an untitled risk");
    expect(stored()).toEqual([]);
  });
});

describe("Risk Register Markdown edges", () => {
  it("names an untitled risk, clamps corrupt inputs and counts a single risk", () => {
    const md = toMarkdown(
      [risk("r1", "", 7, "x" as unknown as number, { status: "mitigating" })],
      NOW
    );
    expect(md).toContain("1 risk: 1 mitigating.");
    expect(md).toContain("| 1 | (untitled) | 5 × 1 | 5 | Mitigating |  |  |");
  });

  it("skips statuses with no risks in the summary", () => {
    const md = toMarkdown(
      [risk("a", "A", 1, 1, { status: "accepted" }), risk("b", "B", 1, 1, { status: "accepted" })],
      NOW
    );
    expect(md).toContain("2 risks: 2 accepted.");
  });
});
