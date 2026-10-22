import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis } from "@/lib/stores/workspace-types";

/**
 * Hypothesis Tracker: add / edit (commit on blur) / status lifecycle /
 * delete, the KPI row (validation rate, median time to learn) and the
 * Kaplan-Meier survival section.
 */

const h = vi.hoisted(() => ({
  log: vi.fn(),
  sonify: vi.fn(),
  exported: {} as { csvData?: { headers: string[]; rows: unknown[][] }; jsonData?: unknown },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: {
    csvData?: { headers: string[]; rows: unknown[][] };
    jsonData?: unknown;
  }) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: h.sonify }));
// The survival chart is a next/dynamic import; expose its props instead.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: Record<string, unknown>) {
      return <div data-testid="survival-chart" data-props={JSON.stringify(props)} />;
    },
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { HypothesisTrackerClient } from "@/app/(tools)/hypothesis-tracker/hypothesis-tracker-client";

const HT_ID = "hypothesisTracker:current";

const hyp = (id: string, patch: Partial<Hypothesis> = {}): Hypothesis => ({
  id,
  believe: `believe ${id}`,
  willDo: "",
  toLearn: "",
  successMetric: "",
  status: "drafted",
  raisedAt: "2026-10-01",
  ...patch,
});

const seed = (...hs: Hypothesis[]) =>
  useWorkspaceStore.setState({ hypothesisTrackers: [{ id: HT_ID, hypotheses: hs }] });

const stored = () =>
  (useWorkspaceStore.getState().hypothesisTrackers ?? []).find((d) => d.id === HT_ID)?.hypotheses ??
  [];

/** The value shown under a KPI label. */
const stat = (label: string) =>
  screen.getByText(label).parentElement!.nextElementSibling!.textContent;

function chooseStatus(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const listbox = screen.getByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: label }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
  h.log.mockClear();
  h.sonify.mockClear();
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  useWorkspaceStore.setState({ hypothesisTrackers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Hypothesis Tracker — empty state", () => {
  it("shows the empty state and neutral KPIs", () => {
    render(<HypothesisTrackerClient />);
    expect(screen.getByText(/No hypotheses yet/)).toBeInTheDocument();
    expect(stat("Total")).toBe("0");
    expect(stat("Validation Rate")).toBe("0%");
    expect(stat("Median Time to Learn")).toBe("—");
    expect(screen.queryByText("Validation survival curve")).not.toBeInTheDocument();
    expect(h.exported.csvData?.rows).toEqual([]);
  });
});

describe("Hypothesis Tracker — adding", () => {
  it("creates the tracker doc with a drafted hypothesis raised today", () => {
    render(<HypothesisTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /New Hypothesis/ }));

    const [added] = stored();
    expect(stored()).toHaveLength(1);
    expect(added).toMatchObject({
      believe: "",
      willDo: "",
      toLearn: "",
      successMetric: "",
      status: "drafted",
      raisedAt: "2026-10-18",
    });
    expect(added.resolvedAt).toBeUndefined();
    expect(screen.getByText("raised 2026-10-18")).toBeInTheDocument();
    expect(screen.queryByText(/No hypotheses yet/)).not.toBeInTheDocument();
    expect(h.log).toHaveBeenCalledWith("hypothesis_added", { hypothesisId: added.id });
  });

  it("puts the new hypothesis above the existing ones", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /New Hypothesis/ }));
    expect(stored().map((x) => x.id)[1]).toBe("h1");
    expect(stored()).toHaveLength(2);
    expect(stat("Total")).toBe("2");
    expect((screen.getAllByLabelText("We believe")[1] as HTMLTextAreaElement).value).toBe(
      "believe h1"
    );
  });
});

describe("Hypothesis Tracker — editing", () => {
  it("commits a field on blur, not per keystroke, and logs which field changed", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    const believe = screen.getByLabelText("We believe");
    fireEvent.change(believe, { target: { value: "users want dark mode" } });
    expect(stored()[0].believe).toBe("believe h1");

    fireEvent.blur(believe);
    expect(stored()[0].believe).toBe("users want dark mode");
    expect(h.log).toHaveBeenCalledWith("hypothesis_updated", {
      hypothesisId: "h1",
      fields: ["believe"],
    });
  });

  it("does not write or log when a field is blurred unchanged", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    const before = useWorkspaceStore.getState().hypothesisTrackers;
    fireEvent.blur(screen.getByLabelText("We believe"));
    expect(useWorkspaceStore.getState().hypothesisTrackers).toBe(before);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("lets a field be cleared", () => {
    seed(hyp("h1", { successMetric: "30% activation" }));
    render(<HypothesisTrackerClient />);
    const metric = screen.getByLabelText("Success metric");
    fireEvent.change(metric, { target: { value: "" } });
    fireEvent.blur(metric);
    expect(stored()[0].successMetric).toBe("");
    expect((metric as HTMLInputElement).value).toBe("");
  });

  it("commits every editable field to the right hypothesis", () => {
    seed(hyp("h1"), hyp("h2"));
    render(<HypothesisTrackerClient />);
    const edit = (el: HTMLElement, value: string) => {
      fireEvent.change(el, { target: { value } });
      fireEvent.blur(el);
    };
    edit(screen.getAllByLabelText("Description (optional)")[1], "why we care");
    edit(screen.getAllByLabelText("We will do")[1], "ship a toggle");
    edit(screen.getAllByLabelText("To learn")[1], "whether it is used");
    edit(screen.getAllByLabelText("Success metric")[1], "20% enable it");
    edit(screen.getAllByLabelText("Experiment design")[1], "A/B for two weeks");

    expect(stored()[0]).toEqual(hyp("h1"));
    expect(stored()[1]).toMatchObject({
      description: "why we care",
      willDo: "ship a toggle",
      toLearn: "whether it is used",
      successMetric: "20% enable it",
      experiment: "A/B for two weeks",
    });
  });

  it("caps a committed field at 4000 characters", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    const toLearn = screen.getByLabelText("To learn");
    fireEvent.change(toLearn, { target: { value: "x".repeat(4500) } });
    fireEvent.blur(toLearn);
    expect(stored()[0].toLearn).toHaveLength(4000);
  });

  it("re-syncs a field when the store changes underneath it (e.g. an MCP write)", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    act(() => seed(hyp("h1", { believe: "edited elsewhere" })));
    expect((screen.getByLabelText("We believe") as HTMLTextAreaElement).value).toBe(
      "edited elsewhere"
    );
  });
});

describe("Hypothesis Tracker — status lifecycle", () => {
  it("stamps resolvedAt on a terminal status, keeps it across terminal moves, clears it on reopen", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();

    chooseStatus(screen.getByRole("combobox", { name: "Hypothesis status" }), "validated");
    expect(stored()[0]).toMatchObject({ status: "validated", resolvedAt: "2026-10-18" });
    expect(screen.getByText("resolved 2026-10-18")).toBeInTheDocument();
    expect(screen.getByLabelText("Outcome")).toBeInTheDocument();
    expect(h.sonify).toHaveBeenLastCalledWith("hypothesis-tracker", "validated");
    expect(h.log).toHaveBeenCalledWith("status_changed", {
      hypothesisId: "h1",
      from: "drafted",
      to: "validated",
    });

    // A later terminal move keeps the original resolution date.
    vi.setSystemTime(new Date(2026, 9, 20, 10, 0));
    chooseStatus(screen.getByRole("combobox", { name: "Hypothesis status" }), "inconclusive");
    expect(stored()[0]).toMatchObject({ status: "inconclusive", resolvedAt: "2026-10-18" });
    expect(h.sonify).toHaveBeenLastCalledWith("hypothesis-tracker", "status-change");

    chooseStatus(screen.getByRole("combobox", { name: "Hypothesis status" }), "invalidated");
    expect(h.sonify).toHaveBeenLastCalledWith("hypothesis-tracker", "invalidated");

    // Re-opening clears the resolution and hides the outcome field.
    chooseStatus(screen.getByRole("combobox", { name: "Hypothesis status" }), "running");
    expect(stored()[0].status).toBe("running");
    expect(stored()[0].resolvedAt).toBeUndefined();
    expect(screen.queryByLabelText("Outcome")).not.toBeInTheDocument();
    expect(screen.queryByText(/^resolved /)).not.toBeInTheDocument();
  });

  it("commits the outcome of a resolved hypothesis", () => {
    seed(hyp("h1", { status: "validated", resolvedAt: "2026-10-10" }));
    render(<HypothesisTrackerClient />);
    const outcome = screen.getByLabelText("Outcome");
    fireEvent.change(outcome, { target: { value: "42% enabled it" } });
    fireEvent.blur(outcome);
    expect(stored()[0].outcome).toBe("42% enabled it");
  });
});

describe("Hypothesis Tracker — KPIs", () => {
  it("validation rate = validated over all closed hypotheses (open ones excluded)", () => {
    seed(
      hyp("a", { status: "validated", resolvedAt: "2026-10-05" }),
      hyp("b", { status: "invalidated", resolvedAt: "2026-10-05" }),
      hyp("c", { status: "inconclusive", resolvedAt: "2026-10-05" }),
      hyp("d", { status: "running" }),
      hyp("e")
    );
    render(<HypothesisTrackerClient />);
    expect(stat("Total")).toBe("5");
    expect(stat("Validation Rate")).toBe("33%");
  });

  // Bug: "closed" was tested with `resolvedAt`, so a validated hypothesis
  // written without one (MCP add_hypothesis / synced data) counted as open.
  it("counts a terminal-status hypothesis as closed even without a resolvedAt", () => {
    seed(hyp("a", { status: "validated" }), hyp("b", { status: "running" }));
    render(<HypothesisTrackerClient />);
    expect(stat("Validation Rate")).toBe("100%");
    // ...and its outcome can be written down.
    expect(screen.getAllByLabelText("Outcome")).toHaveLength(1);
  });

  it("draws the survival curve and median once 4 hypotheses are resolved", () => {
    seed(
      hyp("a", { status: "validated", resolvedAt: "2026-10-03" }),
      hyp("b", { status: "validated", resolvedAt: "2026-10-05" }),
      hyp("c", { status: "invalidated", resolvedAt: "2026-10-07" }),
      hyp("d", { status: "inconclusive", resolvedAt: "2026-10-09" })
    );
    render(<HypothesisTrackerClient />);
    expect(stat("Median Time to Learn")).toBe("4d");
    expect(screen.getByText("Validation survival curve")).toBeInTheDocument();
    expect(screen.getByText("Median 4d")).toBeInTheDocument();
    expect(
      screen.getByText(/Kaplan-Meier estimate over 4 resolved hypotheses/)
    ).toBeInTheDocument();
    const { data } = JSON.parse(screen.getByTestId("survival-chart").dataset.props!) as {
      data: { t: number; survival: number }[];
    };
    expect(data).toEqual([
      { t: 0, survival: 1 },
      { t: 2, survival: 0.75 },
      { t: 4, survival: 0.5 },
      { t: 6, survival: 0.25 },
      { t: 8, survival: 0 },
    ]);
  });

  it("treats open hypotheses as censored in the survival curve", () => {
    seed(
      hyp("a", { status: "validated", resolvedAt: "2026-10-03" }),
      hyp("b", { status: "validated", resolvedAt: "2026-10-03" }),
      hyp("c", { status: "validated", resolvedAt: "2026-10-03" }),
      hyp("d", { status: "validated", resolvedAt: "2026-10-03" }),
      // Raised 2026-10-01, still open on 2026-10-18 → censored at day 17.
      hyp("e", { status: "running" }),
      hyp("f", { status: "running" })
    );
    render(<HypothesisTrackerClient />);
    // 4 of 6 resolve at day 2 → survival 2/6 ≈ 0.333 ≤ 0.5.
    expect(stat("Median Time to Learn")).toBe("2d");
    const { data } = JSON.parse(screen.getByTestId("survival-chart").dataset.props!) as {
      data: { t: number; survival: number }[];
    };
    expect(data).toEqual([
      { t: 0, survival: 1 },
      { t: 2, survival: 0.333 },
    ]);
  });

  it("needs 4 resolved hypotheses and skips malformed dates without showing NaN", () => {
    seed(
      hyp("a", { status: "validated", resolvedAt: "2026-10-03" }),
      hyp("b", { status: "validated", resolvedAt: "2026-10-05" }),
      hyp("c", { status: "validated", resolvedAt: "2026-10-07" }),
      hyp("d", { status: "validated", raisedAt: "not a date", resolvedAt: "2026-10-09" })
    );
    const { container } = render(<HypothesisTrackerClient />);
    expect(screen.queryByText("Validation survival curve")).not.toBeInTheDocument();
    expect(stat("Median Time to Learn")).toBe("—");
    expect(stat("Validation Rate")).toBe("100%");
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });
});

describe("Hypothesis Tracker — delete", () => {
  it("removes exactly the clicked hypothesis", () => {
    seed(hyp("h1"), hyp("h2"), hyp("h3"));
    render(<HypothesisTrackerClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete hypothesis" })[1]);
    expect(stored().map((x) => x.id)).toEqual(["h1", "h3"]);
    expect(h.log).toHaveBeenCalledWith("hypothesis_removed", {
      hypothesisId: "h2",
      believe: "believe h2",
    });
    expect(stat("Total")).toBe("2");
  });

  it("returns to the empty state after the last one is deleted", () => {
    seed(hyp("h1"));
    render(<HypothesisTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete hypothesis" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No hypotheses yet/)).toBeInTheDocument();
  });
});

describe("Hypothesis Tracker — export", () => {
  it("exports one CSV row per hypothesis with blanks for optional fields", () => {
    seed(
      hyp("h1", {
        description: "context",
        willDo: "w",
        toLearn: "l",
        successMetric: "m",
        experiment: "x",
        outcome: "o",
        status: "validated",
        resolvedAt: "2026-10-09",
      }),
      hyp("h2")
    );
    render(<HypothesisTrackerClient />);
    expect(h.exported.csvData?.headers).toEqual([
      "Description",
      "Believe",
      "Will do",
      "To learn",
      "Success metric",
      "Experiment",
      "Outcome",
      "Status",
      "Raised",
      "Resolved",
    ]);
    expect(h.exported.csvData?.rows).toEqual([
      ["context", "believe h1", "w", "l", "m", "x", "o", "validated", "2026-10-01", "2026-10-09"],
      ["", "believe h2", "", "", "", "", "", "drafted", "2026-10-01", ""],
    ]);
    expect(h.exported.jsonData).toEqual(stored());
  });
});
