import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { KeyResult, Okr } from "@/lib/stores/workspace-types";

/**
 * OKR Tracker gap-filling: progress maths edges, Markdown fallbacks, the
 * example's quarter, and the client — adding objectives and key results,
 * editing text and numbers (commit on blur, clamping, blanks), the progress
 * badge, the analytics gates, and the untitled delete labels.
 */

const history = vi.hoisted(() => ({ log: vi.fn() }));
const undo = vi.hoisted(() => ({ label: "" }));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void }) => {
    undo.label = a.label;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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

import { OkrsClient } from "@/app/(tools)/okrs/okrs-client";
import { toMarkdown } from "@/app/(tools)/okrs/markdown";
import { buildExample } from "@/app/(tools)/okrs/example";
import { krProgress, objectiveHealth } from "@/app/(tools)/okrs/progress";
import { OKR_ACTIONS } from "@/lib/history/event-actions";

const NOW = new Date(2026, 9, 18);

const kr = (id: string, title: string, current: number, target: number, extra = {}): KeyResult => ({
  id,
  title,
  current,
  target,
  confidence: 7,
  ...extra,
});
const okr = (id: string, objective: string, keyResults: KeyResult[], extra = {}): Okr => ({
  id,
  objective,
  keyResults,
  quarter: "2026 Q4",
  ...extra,
});

const stored = () => useWorkspaceStore.getState().okrs;
const krOf = (okrId: string, krId: string) =>
  stored()
    .find((o) => o.id === okrId)!
    .keyResults.find((k) => k.id === krId)!;
const logged = (action: string) => history.log.mock.calls.filter(([a]) => a === action);

beforeEach(() => {
  history.log.mockClear();
  undo.label = "";
  useWorkspaceStore.setState({ okrs: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OKR progress maths", () => {
  it("is current ÷ target, clamped to 0..1", () => {
    expect(krProgress(kr("k", "", 30, 60))).toBe(0.5);
    expect(krProgress(kr("k", "", 150, 100))).toBe(1);
    expect(krProgress(kr("k", "", -5, 100))).toBe(0);
  });

  it("is 0 for a zero, negative-result or non-finite target or current", () => {
    expect(krProgress(kr("k", "", 10, 0))).toBe(0);
    expect(krProgress(kr("k", "", 10, -10))).toBe(0);
    expect(krProgress(kr("k", "", NaN, 100))).toBe(0);
    expect(krProgress(kr("k", "", 10, NaN))).toBe(0);
    expect(krProgress(kr("k", "", Infinity, 100))).toBe(0);
    expect(krProgress(kr("k", "", 10, Infinity))).toBe(0);
  });

  it("averages key results, and an objective without any is 0", () => {
    expect(objectiveHealth(okr("o", "O", []))).toBe(0);
    expect(
      objectiveHealth(
        okr("o", "O", [kr("a", "", 100, 100), kr("b", "", 0, 100), kr("c", "", 50, 0)])
      )
    ).toBeCloseTo(1 / 3);
  });
});

describe("OKR toMarkdown fallbacks", () => {
  it("names untitled rows, shows units, and a dash for unknown confidence", () => {
    const md = toMarkdown(
      [
        okr(
          "o",
          "",
          [
            kr("a", "", 3, 4, { unit: "k|users", confidence: undefined }),
            kr("b", "NPS", 20, 40, { confidence: 0 }),
          ],
          { quarter: "", owner: "Sam\n(PM)", description: "Why\nnow" }
        ),
      ],
      NOW
    );
    const lines = md.split("\n");
    // 75% and 50% → 63% (62.5 rounds up).
    expect(lines).toContain("**63% average progress** across 1 objective and 2 key results.");
    expect(lines).toContain("## Untitled objective — 63%");
    expect(lines).toContain("Owner: Sam (PM). Why now");
    expect(lines).toContain("| Untitled key result | 3 k\\|users | 4 k\\|users | 75% | — |");
    expect(lines).toContain("| NPS | 20 | 40 | 50% | 0/10 |");
  });

  it("says when an objective has no key results yet", () => {
    const md = toMarkdown([okr("o", "Grow", [])], NOW);
    expect(md).toContain("across 1 objective and 0 key results.");
    expect(md).toContain("## Grow (2026 Q4) — 0%\n\nNo key results yet.\n");
  });
});

describe("OKR example quarter", () => {
  it("follows the date it is built on", () => {
    expect(buildExample(new Date(2027, 0, 1))[0].quarter).toBe("2027 Q1");
    expect(buildExample(new Date(2026, 5, 30))[0].quarter).toBe("2026 Q2");
    expect(buildExample(new Date(2026, 11, 31))[1].quarter).toBe("2026 Q4");
    // The two objectives sit at 63% and 71%, as the example promises.
    expect(buildExample(NOW).map((o) => Math.round(objectiveHealth(o) * 100))).toEqual([63, 71]);
  });
});

describe("OKR Tracker: adding and editing", () => {
  it("adds an empty objective for this quarter, with one starter key result", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 2));
    render(<OkrsClient />);
    expect(screen.getByText(/No objectives yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New Objective/ }));
    const [added] = stored();
    expect(added).toMatchObject({ objective: "", quarter: "2026 Q2" });
    expect(added.keyResults).toEqual([
      { id: expect.any(String), title: "", target: 100, current: 0, confidence: 5 },
    ]);
    expect(logged(OKR_ACTIONS.OBJECTIVE_ADDED)).toHaveLength(1);
    expect(screen.queryByText(/No objectives yet/)).toBeNull();
  });

  it("commits objective, quarter and description on blur; a blank description is removed", () => {
    useWorkspaceStore.setState({
      okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)], { description: "Old" })],
    });
    render(<OkrsClient />);
    const objective = screen.getByRole("textbox", { name: "Objective" });
    fireEvent.change(objective, { target: { value: "Grow repeat orders" } });
    expect(stored()[0].objective).toBe("Grow");
    fireEvent.blur(objective);
    expect(stored()[0].objective).toBe("Grow repeat orders");

    const quarter = screen.getByRole("textbox", { name: "Quarter for Grow repeat orders" });
    fireEvent.change(quarter, { target: { value: "2027 Q1" } });
    fireEvent.blur(quarter);
    expect(stored()[0].quarter).toBe("2027 Q1");

    const description = screen.getByRole("textbox", { name: "Objective description" });
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.blur(description);
    expect(stored()[0].description).toBeUndefined();
  });

  it("updates progress when current or target is committed, and logs it", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)])] });
    render(<OkrsClient />);
    expect(screen.getByText("50%")).toBeInTheDocument();

    const current = screen.getByRole("spinbutton", { name: "Current value for Activation" });
    fireEvent.change(current, { target: { value: "45" } });
    // A draft until blur.
    expect(krOf("o", "a").current).toBe(30);
    fireEvent.keyDown(current, { key: "Enter" });
    fireEvent.blur(current);
    expect(krOf("o", "a").current).toBe(45);
    expect(screen.getByText("75%")).toBeInTheDocument();

    const target = screen.getByRole("spinbutton", { name: "Target for Activation" });
    fireEvent.change(target, { target: { value: "90" } });
    fireEvent.blur(target);
    expect(krOf("o", "a").target).toBe(90);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(logged(OKR_ACTIONS.PROGRESS_UPDATED).map(([, p]) => p)).toEqual([
      { okrId: "o", krId: "a", current: 45 },
      { okrId: "o", krId: "a", target: 90 },
    ]);
  });

  it("keeps confidence between 0 and 10", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)])] });
    render(<OkrsClient />);
    const confidence = screen.getByRole("spinbutton", {
      name: "Confidence (0-10) for Activation",
    });
    fireEvent.change(confidence, { target: { value: "15" } });
    fireEvent.blur(confidence);
    expect(krOf("o", "a").confidence).toBe(10);
    expect(confidence).toHaveValue(10);
    fireEvent.change(confidence, { target: { value: "-2" } });
    fireEvent.blur(confidence);
    expect(krOf("o", "a").confidence).toBe(0);
    expect(confidence).toHaveValue(0);
  });

  // Bug: Number("") is 0, so emptying a number box and leaving it set the
  // target (or current, or confidence) to 0 instead of keeping the value.
  it("puts the value back when a number box is left empty", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)])] });
    render(<OkrsClient />);
    const target = screen.getByRole("spinbutton", { name: "Target for Activation" });
    fireEvent.change(target, { target: { value: "" } });
    fireEvent.blur(target);
    expect(krOf("o", "a").target).toBe(60);
    expect(target).toHaveValue(60);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  // Bug: every blur committed, so tabbing through the numbers rewrote the
  // objective and logged "progress updated" though nothing changed.
  it("writes and logs nothing when a number box is left unchanged", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)])] });
    render(<OkrsClient />);
    const before = stored();
    for (const name of [
      "Current value for Activation",
      "Target for Activation",
      "Confidence (0-10) for Activation",
    ]) {
      const box = screen.getByRole("spinbutton", { name });
      fireEvent.focus(box);
      fireEvent.blur(box);
    }
    expect(stored()).toBe(before);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("adds a key result, and commits its title and description", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", [kr("a", "Activation", 30, 60)])] });
    render(<OkrsClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Key Result/ }));
    expect(stored()[0].keyResults).toHaveLength(2);
    expect(logged(OKR_ACTIONS.KEY_RESULT_ADDED)).toHaveLength(1);

    const titles = screen.getAllByRole("textbox", { name: "Key result" });
    fireEvent.change(titles[1], { target: { value: "NPS above 40" } });
    fireEvent.blur(titles[1]);
    expect(stored()[0].keyResults[1].title).toBe("NPS above 40");
    const descriptions = screen.getAllByRole("textbox", { name: "Key result description" });
    fireEvent.change(descriptions[1], { target: { value: "Quarterly survey" } });
    fireEvent.blur(descriptions[1]);
    expect(stored()[0].keyResults[1].description).toBe("Quarterly survey");
    fireEvent.change(descriptions[1], { target: { value: " " } });
    fireEvent.blur(descriptions[1]);
    expect(stored()[0].keyResults[1].description).toBeUndefined();
  });

  it("labels deletes of untitled rows", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "", [kr("a", "", 0, 100), kr("b", "B", 1, 2)])] });
    render(<OkrsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete key result: untitled" }));
    expect(undo.label).toBe("Deleted an untitled key result");
    expect(stored()[0].keyResults.map((k) => k.id)).toEqual(["b"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete objective: untitled" }));
    expect(undo.label).toBe("Deleted an untitled objective");
    expect(stored()).toEqual([]);
  });
});

describe("OKR Tracker: analytics gates", () => {
  const krs = (n: number, extra: KeyResult[] = []) => [
    ...Array.from({ length: n }, (_, i) => kr(`k${i}`, `KR ${i + 1}`, (i + 1) * 10, 100)),
    ...extra,
  ];

  it("draws the KR chart from 4 measurable key results; zero targets don't count", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", krs(3, [kr("z", "Zero", 5, 0)]))] });
    const { unmount } = render(<OkrsClient />);
    expect(screen.queryByText("KR progress (across KR sequence)")).toBeNull();
    unmount();

    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", krs(4))] });
    render(<OkrsClient />);
    expect(screen.getByText("KR progress (across KR sequence)")).toBeInTheDocument();
  });

  it("shows the across-the-list trend and projection only from 10 key results", () => {
    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", krs(9))] });
    const { unmount } = render(<OkrsClient />);
    expect(screen.queryByText(/^List /)).toBeNull();
    unmount();

    useWorkspaceStore.setState({ okrs: [okr("o", "Grow", krs(10))] });
    render(<OkrsClient />);
    // 10%, 20% … 100%: a clean rise down the list.
    expect(screen.getByText("List ↗")).toBeInTheDocument();
    expect(screen.getByText(/^List proj ~ \d+%$/)).toBeInTheDocument();
  });
});
