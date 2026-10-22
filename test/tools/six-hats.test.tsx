import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SixHatsThought } from "@/lib/stores/workspace-types";

/**
 * Six Thinking Hats: logging a thought under the chosen hat, the per-hat
 * columns and counts, removal, the emitted signal and the CSV export.
 */

type Csv = { headers: string[]; rows: unknown[][] };
const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ emit: vi.fn() }));

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
vi.mock("@/lib/signals/signal-bus", () => ({ emitSignal: signals.emit }));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { SixHatsClient } from "@/app/(tools)/six-hats/six-hats-client";
import { SIX_HATS_ACTIONS } from "@/lib/history/event-actions";

const HAT_LABELS = [
  "White — Facts",
  "Red — Feelings",
  "Black — Risks",
  "Yellow — Benefits",
  "Green — Creativity",
  "Blue — Process",
];

const thought = (id: string, hat: SixHatsThought["hat"], text: string): SixHatsThought => ({
  id,
  hat,
  text,
  loggedAt: "2026-10-01T09:00:00.000Z",
});

const stored = () => useWorkspaceStore.getState().sixHatsThoughts ?? [];

/** The column heading for a hat (not the dropdown's copy of the label). */
function heading(label: string): HTMLElement {
  const el = screen.getAllByText(label).find((e) => e.className.includes("uppercase"));
  if (!el) throw new Error(`no column for ${label}`);
  return el;
}
const count = (label: string) => heading(label).nextElementSibling!.textContent;
const column = (label: string) => heading(label).parentElement!.parentElement!;

function chooseHat(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Hat" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

const logButton = () => screen.getByRole("button", { name: "Log" });
const typeThought = (v: string) =>
  fireEvent.change(screen.getByLabelText("Your thought"), { target: { value: v } });

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  signals.emit.mockClear();
  useWorkspaceStore.setState({ sixHatsThoughts: [], whiteboardObjects: [] });
});

describe("Six Hats — empty state", () => {
  it("shows all six hat columns at zero and the White hat's hint", () => {
    render(<SixHatsClient />);
    expect(screen.getByText("Thoughts (0)")).toBeInTheDocument();
    for (const label of HAT_LABELS) expect(count(label)).toBe("0");
    expect(screen.getByRole("combobox", { name: "Hat" })).toHaveTextContent("White — Facts");
    expect(screen.getByText("Just the data — what do we know?")).toBeInTheDocument();
  });

  it("ignores Log with a blank or whitespace-only thought", () => {
    render(<SixHatsClient />);
    fireEvent.click(logButton());
    typeThought("   \n ");
    fireEvent.click(logButton());
    expect(stored()).toEqual([]);
    expect(signals.emit).not.toHaveBeenCalled();
  });
});

describe("Six Hats — logging thoughts", () => {
  it("logs a trimmed thought under the White hat by default and clears the box", () => {
    render(<SixHatsClient />);
    typeThought("  Churn rose 4% last quarter  ");
    fireEvent.click(logButton());

    expect(stored()).toHaveLength(1);
    const t = stored()[0];
    expect(t).toMatchObject({ hat: "white", text: "Churn rose 4% last quarter" });
    expect(Number.isNaN(Date.parse(t.loggedAt))).toBe(false);
    expect(screen.getByLabelText("Your thought")).toHaveValue("");
    expect(screen.getByText("Thoughts (1)")).toBeInTheDocument();
    expect(count("White — Facts")).toBe("1");
    expect(within(column("White — Facts")).getByText("Churn rose 4% last quarter")).toBeVisible();
    expect(history.log).toHaveBeenCalledWith(SIX_HATS_ACTIONS.THOUGHT_ADDED, { hat: "white" });
    expect(signals.emit).toHaveBeenCalledWith({
      kind: "sixHats.thoughtLogged",
      at: t.loggedAt,
      toolId: "six-hats",
      payload: t,
    });
  });

  it("switching hats updates the hint and files the thought under that hat", () => {
    render(<SixHatsClient />);
    chooseHat("Black — Risks");
    expect(screen.getByText("What could go wrong? Cautions, downsides")).toBeInTheDocument();
    typeThought("Vendor lock-in");
    fireEvent.click(logButton());
    expect(stored()[0].hat).toBe("black");
    expect(count("Black — Risks")).toBe("1");
    expect(count("White — Facts")).toBe("0");

    // The chosen hat sticks for the next thought.
    typeThought("Migration cost");
    fireEvent.click(logButton());
    expect(stored().map((x) => x.hat)).toEqual(["black", "black"]);
    expect(count("Black — Risks")).toBe("2");
  });

  it("keeps multi-line thoughts intact apart from the outer whitespace", () => {
    render(<SixHatsClient />);
    typeThought("\nLine one\nLine two\n");
    fireEvent.click(logButton());
    expect(stored()[0].text).toBe("Line one\nLine two");
  });
});

describe("Six Hats — seeded thoughts", () => {
  const seed = () =>
    useWorkspaceStore.setState({
      sixHatsThoughts: [
        thought("t1", "white", "NPS is 32"),
        thought("t2", "red", "Feels rushed"),
        thought("t3", "red", "Team is excited"),
        thought("t4", "blue", "Decide by Friday"),
      ],
    });

  it("groups thoughts by hat with per-hat counts", () => {
    seed();
    render(<SixHatsClient />);
    expect(screen.getByText("Thoughts (4)")).toBeInTheDocument();
    expect(count("White — Facts")).toBe("1");
    expect(count("Red — Feelings")).toBe("2");
    expect(count("Black — Risks")).toBe("0");
    expect(count("Blue — Process")).toBe("1");
    const red = column("Red — Feelings");
    expect(within(red).getByText("Feels rushed")).toBeInTheDocument();
    expect(within(red).getByText("Team is excited")).toBeInTheDocument();
    expect(within(red).queryByText("NPS is 32")).not.toBeInTheDocument();
  });

  it("skips a thought with an out-of-schema hat instead of crashing", () => {
    useWorkspaceStore.setState({
      sixHatsThoughts: [
        thought("t1", "white", "NPS is 32"),
        thought("bad", "purple" as SixHatsThought["hat"], "Legacy hat"),
      ],
    });
    render(<SixHatsClient />);
    expect(count("White — Facts")).toBe("1");
    expect(screen.queryByText("Legacy hat")).not.toBeInTheDocument();
  });

  it("removes only the clicked thought", () => {
    seed();
    render(<SixHatsClient />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Red — Feelings thought: Feels rushed" })
    );
    expect(stored().map((x) => x.id)).toEqual(["t1", "t3", "t4"]);
    expect(count("Red — Feelings")).toBe("1");
    expect(screen.getByText("Thoughts (3)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(SIX_HATS_ACTIONS.THOUGHT_REMOVED, { id: "t2" });
  });

  it("truncates a long thought to 40 characters in the remove button's label", () => {
    const long = "A".repeat(39) + "BCDEFG";
    useWorkspaceStore.setState({ sixHatsThoughts: [thought("t1", "green", long)] });
    render(<SixHatsClient />);
    expect(
      screen.getByRole("button", {
        name: `Remove Green — Creativity thought: ${"A".repeat(39)}B`,
      })
    ).toBeInTheDocument();
  });

  it("exports hat, thought and timestamp to CSV", () => {
    seed();
    render(<SixHatsClient />);
    expect(exported.csv?.headers).toEqual(["Hat", "Thought", "Logged"]);
    expect(exported.csv?.rows).toEqual([
      ["white", "NPS is 32", "2026-10-01T09:00:00.000Z"],
      ["red", "Feels rushed", "2026-10-01T09:00:00.000Z"],
      ["red", "Team is excited", "2026-10-01T09:00:00.000Z"],
      ["blue", "Decide by Friday", "2026-10-01T09:00:00.000Z"],
    ]);
  });
});
