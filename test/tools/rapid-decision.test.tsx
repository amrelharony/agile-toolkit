import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RAPIDDecision } from "@/lib/stores/workspace-types";

/**
 * RAPID Decision Matrix: the new-decision form (including the comma-separated
 * role buffers), the decisions list, status changes, "mark decided", remove
 * and the CSV export.
 */

type Csv = { headers: string[]; rows: unknown[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { RapidDecisionClient } from "@/app/(tools)/rapid-decision/rapid-decision-client";
import { RAPID_ACTIONS } from "@/lib/history/event-actions";

const decision = (id: string, title: string, over: Partial<RAPIDDecision> = {}): RAPIDDecision => ({
  id,
  title,
  status: "open",
  date: "2026-10-01T09:00:00.000Z",
  ...over,
});

const stored = () => useWorkspaceStore.getState().rapidDecisions ?? [];

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const AGREE = "Agree (A), comma-separated";
const PERFORM = "Perform (P), comma-separated";
const INPUT = "Input (I), comma-separated";
const addButton = () => screen.getByRole("button", { name: "Add" });

/** The list item for a decision title. */
const item = (title: string) => screen.getByText(title, { selector: "span" }).closest("li")!;

function chooseStatus(title: string, label: string) {
  const trigger = screen.getByRole("combobox", { name: `Status for ${title}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ rapidDecisions: [], whiteboardObjects: [] });
});

describe("RAPID — empty state and validation", () => {
  it("shows only the form when there are no decisions", () => {
    render(<RapidDecisionClient />);
    expect(screen.getByLabelText("Decision title")).toHaveValue("");
    expect(screen.queryByText(/^Decisions \(/)).not.toBeInTheDocument();
  });

  it("ignores Add with a blank or whitespace-only title", () => {
    render(<RapidDecisionClient />);
    fireEvent.click(addButton());
    type("Decision title", "   ");
    type("Recommend (R)", "Alice");
    fireEvent.click(addButton());
    expect(stored()).toEqual([]);
    // The draft is kept so the user can finish it.
    expect(screen.getByLabelText("Recommend (R)")).toHaveValue("Alice");
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("RAPID — adding a decision", () => {
  it("saves every role, splits comma lists, and resets the form", () => {
    render(<RapidDecisionClient />);
    type("Decision title", "Pick a payments vendor");
    type("Context", "Contract renews in Q1");
    type("Recommend (R)", "Alice");
    type("Decide (D)", "Dana");
    type(AGREE, "Bob, Carol ,, ");
    fireEvent.blur(screen.getByLabelText(AGREE));
    type(PERFORM, "Eng team");
    fireEvent.blur(screen.getByLabelText(PERFORM));
    type(INPUT, "Legal,Finance");
    fireEvent.blur(screen.getByLabelText(INPUT));
    fireEvent.click(addButton());

    expect(stored()).toHaveLength(1);
    const d = stored()[0];
    expect(d).toMatchObject({
      title: "Pick a payments vendor",
      context: "Contract renews in Q1",
      recommend: "Alice",
      decide: "Dana",
      agree: ["Bob", "Carol"],
      perform: ["Eng team"],
      input: ["Legal", "Finance"],
      status: "open",
    });
    expect(Number.isNaN(Date.parse(d.date))).toBe(false);
    expect(d.id).toBeTruthy();
    expect(history.log).toHaveBeenCalledWith(RAPID_ACTIONS.DECISION_ADDED, {
      title: "Pick a payments vendor",
    });

    for (const label of [
      "Decision title",
      "Context",
      "Recommend (R)",
      "Decide (D)",
      AGREE,
      PERFORM,
      INPUT,
    ]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
  });

  it("keeps commas and spaces while typing a role list (no per-keystroke split)", () => {
    render(<RapidDecisionClient />);
    type(AGREE, "Bob, ");
    expect(screen.getByLabelText(AGREE)).toHaveValue("Bob, ");
    type(AGREE, "Bob, Carol");
    expect(screen.getByLabelText(AGREE)).toHaveValue("Bob, Carol");
    fireEvent.blur(screen.getByLabelText(AGREE));
    expect(screen.getByLabelText(AGREE)).toHaveValue("Bob, Carol");
  });

  it("applies a role list that was typed but never blurred", () => {
    render(<RapidDecisionClient />);
    type("Decision title", "Ship v2");
    type(PERFORM, "Ops, SRE");
    fireEvent.click(addButton());
    expect(stored()[0].perform).toEqual(["Ops", "SRE"]);
  });

  it("lets a committed role list be cleared (it doesn't come back)", () => {
    render(<RapidDecisionClient />);
    type("Decision title", "Ship v2");
    type(AGREE, "Bob, Carol");
    fireEvent.blur(screen.getByLabelText(AGREE));
    type(AGREE, "");
    expect(screen.getByLabelText(AGREE)).toHaveValue("");
    fireEvent.blur(screen.getByLabelText(AGREE));
    expect(screen.getByLabelText(AGREE)).toHaveValue("");
    fireEvent.click(addButton());
    expect(stored()[0].agree).toEqual([]);
  });

  it("clearing a role list without blurring still saves it empty", () => {
    render(<RapidDecisionClient />);
    type("Decision title", "Ship v2");
    type(INPUT, "Legal");
    fireEvent.blur(screen.getByLabelText(INPUT));
    type(INPUT, "");
    fireEvent.click(addButton());
    expect(stored()[0].input).toEqual([]);
  });

  // Bug: add() checked `draft.title.trim()` but saved the raw draft, so
  // padding (and whitespace-only Recommend / Decide / Context) was stored.
  it("trims the title and the single-value roles it saves", () => {
    render(<RapidDecisionClient />);
    type("Decision title", "  Pick a vendor  ");
    type("Context", "   ");
    type("Recommend (R)", "  Alice ");
    type("Decide (D)", " Dana  ");
    fireEvent.click(addButton());
    expect(stored()[0]).toMatchObject({
      title: "Pick a vendor",
      context: "",
      recommend: "Alice",
      decide: "Dana",
    });
  });
});

describe("RAPID — decisions list", () => {
  const seeded = () =>
    useWorkspaceStore.setState({
      rapidDecisions: [
        decision("d1", "Pick a vendor", {
          context: "Contract renews in Q1",
          recommend: "Alice",
          decide: "Dana",
          agree: ["Bob", "Carol"],
          perform: ["Eng"],
          input: ["Legal", "Finance"],
        }),
        decision("d2", "Retire the monolith", { status: "decided" }),
      ],
    });

  it("renders the count, context and each RAPID role", () => {
    seeded();
    render(<RapidDecisionClient />);
    expect(screen.getByText("Decisions (2)")).toBeInTheDocument();
    const li = item("Pick a vendor");
    expect(li).toHaveTextContent("Contract renews in Q1");
    expect(li).toHaveTextContent("R: Alice");
    expect(li).toHaveTextContent("D: Dana");
    expect(li).toHaveTextContent("A: Bob, Carol");
    expect(li).toHaveTextContent("P: Eng");
    expect(li).toHaveTextContent("I: Legal, Finance");
    // A decision with no roles shows no role labels.
    expect(item("Retire the monolith")).not.toHaveTextContent("R:");
    expect(item("Retire the monolith")).not.toHaveTextContent("A:");
  });

  it("offers 'mark decided' only on open decisions and sets the status", () => {
    seeded();
    render(<RapidDecisionClient />);
    expect(
      screen.queryByRole("button", { name: "Mark Retire the monolith decided" })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Pick a vendor decided" }));
    expect(stored().find((d) => d.id === "d1")?.status).toBe("decided");
    expect(stored().find((d) => d.id === "d1")?.agree).toEqual(["Bob", "Carol"]);
    expect(
      screen.queryByRole("button", { name: "Mark Pick a vendor decided" })
    ).not.toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(RAPID_ACTIONS.DECISION_DECIDED, {
      title: "Pick a vendor",
    });
  });

  it("changes status from the dropdown", () => {
    seeded();
    render(<RapidDecisionClient />);
    chooseStatus("Retire the monolith", "implemented");
    expect(stored().find((d) => d.id === "d2")?.status).toBe("implemented");
    expect(stored().find((d) => d.id === "d1")?.status).toBe("open");
    // Back to open brings the shortcut back.
    chooseStatus("Retire the monolith", "open");
    expect(
      screen.getByRole("button", { name: "Mark Retire the monolith decided" })
    ).toBeInTheDocument();
  });

  it("removes only the clicked decision", () => {
    seeded();
    render(<RapidDecisionClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove decision: Pick a vendor" }));
    expect(stored().map((d) => d.id)).toEqual(["d2"]);
    expect(screen.getByText("Decisions (1)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(RAPID_ACTIONS.DECISION_REMOVED, { id: "d1" });
  });

  it("hides the list again once the last decision is removed", () => {
    useWorkspaceStore.setState({ rapidDecisions: [decision("d1", "Only one")] });
    render(<RapidDecisionClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove decision: Only one" }));
    expect(screen.queryByText(/^Decisions \(/)).not.toBeInTheDocument();
  });

  it("exports the full RAPID shape to CSV, blanking missing fields", () => {
    seeded();
    render(<RapidDecisionClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Title",
      "Context",
      "Recommend",
      "Agree",
      "Perform",
      "Input",
      "Decide",
      "Status",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "2026-10-01T09:00:00.000Z",
        "Pick a vendor",
        "Contract renews in Q1",
        "Alice",
        "Bob; Carol",
        "Eng",
        "Legal; Finance",
        "Dana",
        "open",
      ],
      ["2026-10-01T09:00:00.000Z", "Retire the monolith", "", "", "", "", "", "", "decided"],
    ]);
  });
});
