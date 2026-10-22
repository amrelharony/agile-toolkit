import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { JobStory } from "@/lib/stores/workspace-types";

/**
 * Job Story Mapper: adding "When / I want to / so I can" stories (optionally
 * under a parent), the hierarchy KPIs, the nested rendering, inline editing
 * and the CSV export. Removal + Undo is covered by jtbd-mapper-fixes.test.tsx.
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
// undo wrapper: run the change immediately
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { JtbdMapperClient } from "@/app/(tools)/jtbd-mapper/jtbd-mapper-client";
import { generateJtbdPrompts } from "@/lib/ai-prompts/jtbd-mapper";

const job = (id: string, situation: string, parentJobId?: string): JobStory => ({
  id,
  situation,
  motivation: `m-${id}`,
  outcome: `o-${id}`,
  ...(parentJobId ? { parentJobId } : {}),
});

const jobs = () => useWorkspaceStore.getState().jobStories ?? [];
/** The add form comes first, so its fields are the first match. */
const formField = (label: string) => screen.getAllByLabelText(label)[0];
const type = (label: string, value: string) =>
  fireEvent.change(formField(label), { target: { value } });
const addJob = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
const kpi = (label: string) =>
  screen.getByText(label).parentElement?.nextElementSibling?.textContent;
const sentence = (situation: string) =>
  screen
    .getByRole("button", { name: `Edit job story: when ${situation}` })
    .closest("div.rounded-lg")!;

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ jobStories: [] });
});

describe("JTBD: empty state", () => {
  it("prompts for the first story and zeroes the KPIs", () => {
    render(<JtbdMapperClient />);
    expect(screen.getByText(/No job stories yet/)).toBeInTheDocument();
    for (const label of ["Job stories", "Top-level", "Max depth", "Without children"]) {
      expect(kpi(label)).toBe("0");
    }
  });
});

describe("JTBD: adding a story", () => {
  it("saves the trimmed clauses as a top-level story and resets the form", () => {
    render(<JtbdMapperClient />);
    type("When (situation)", "  I open the app on Monday  ");
    type("I want to (motivation)", " see what's due ");
    type("So I can (outcome)", "plan my week");
    type("Description", "  From the onboarding interviews.  ");
    addJob();

    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({
      situation: "I open the app on Monday",
      motivation: "see what's due",
      outcome: "plan my week",
      parentJobId: undefined,
      description: "From the onboarding interviews.",
    });
    expect(sentence("I open the app on Monday")).toHaveTextContent(
      "When I open the app on Monday, I want to see what's due, so I can plan my week."
    );
    expect(screen.getByText("From the onboarding interviews.")).toBeInTheDocument();
    expect(formField("When (situation)")).toHaveValue("");
    expect(formField("Description")).toHaveValue("");
    expect(kpi("Job stories")).toBe("1");
    expect(kpi("Top-level")).toBe("1");
    expect(kpi("Max depth")).toBe("1");
    expect(kpi("Without children")).toBe("1");
  });

  it("accepts a partial story and shows placeholders for the missing clauses", () => {
    render(<JtbdMapperClient />);
    type("I want to (motivation)", "export to CSV");
    type("Description", "   ");
    addJob();
    expect(jobs()[0]).toMatchObject({ situation: "", motivation: "export to CSV", outcome: "" });
    expect(jobs()[0].description).toBeUndefined();
    expect(sentence("(situation)")).toHaveTextContent(
      "When (situation), I want to export to CSV, so I can (outcome)."
    );
  });

  it("does nothing when every clause is blank", () => {
    render(<JtbdMapperClient />);
    type("When (situation)", "   ");
    type("Description", "Only a description");
    addJob();
    expect(jobs()).toEqual([]);
    expect(formField("Description")).toHaveValue("Only a description");
  });

  it("caps each clause at 500 characters and the description at 4000", () => {
    render(<JtbdMapperClient />);
    type("When (situation)", "s".repeat(700));
    type("Description", "d".repeat(5000));
    addJob();
    expect(jobs()[0].situation).toHaveLength(500);
    expect(jobs()[0].description).toHaveLength(4000);
  });

  it("nests a new story under the chosen parent", () => {
    useWorkspaceStore.setState({ jobStories: [job("root", "onboarding")] });
    render(<JtbdMapperClient />);
    type("When (situation)", "first login");
    const trigger = screen.getByRole("combobox", { name: "Parent job (optional)" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: "When onboarding, I want to m-root, so I can o-root.",
      })
    );
    addJob();

    const child = jobs().find((j) => j.situation === "first login")!;
    expect(child.parentJobId).toBe("root");
    // Rendered inside the parent's block.
    const rootBlock = sentence("onboarding").parentElement!;
    expect(within(rootBlock).getByText("first login")).toBeInTheDocument();
    expect(kpi("Top-level")).toBe("1");
    expect(kpi("Max depth")).toBe("2");
    expect(kpi("Without children")).toBe("1");
    // The parent picker resets to top-level.
    expect(screen.getByRole("combobox", { name: "Parent job (optional)" })).toHaveTextContent(
      "No parent (top-level)"
    );
  });
});

describe("JTBD: hierarchy", () => {
  it("counts roots, depth and leaves across several trees", () => {
    useWorkspaceStore.setState({
      jobStories: [
        job("a", "A"),
        job("b", "B", "a"),
        job("c", "C", "b"),
        job("d", "D", "a"),
        job("e", "E"),
      ],
    });
    render(<JtbdMapperClient />);
    expect(kpi("Job stories")).toBe("5");
    expect(kpi("Top-level")).toBe("2");
    expect(kpi("Max depth")).toBe("3");
    expect(kpi("Without children")).toBe("3");
  });

  it("survives a parent cycle in stored data without hanging", () => {
    useWorkspaceStore.setState({
      jobStories: [job("root", "Root"), job("x", "X", "y"), job("y", "Y", "x")],
    });
    render(<JtbdMapperClient />);
    expect(kpi("Job stories")).toBe("3");
    expect(kpi("Max depth")).toBe("1");
    expect(screen.getByText("Root")).toBeInTheDocument();
  });

  // Bug: a story whose parent no longer exists (deleted through the agent's
  // generic CRUD, or added by tool.jtbd_mapper.add_job with a stale
  // parentJobId) was neither a root nor anyone's child, so it vanished from
  // the page while the "Job stories" KPI still counted it, and it could not
  // be edited or removed.
  it("shows a story whose parent is gone as top-level", () => {
    useWorkspaceStore.setState({
      jobStories: [job("a", "Still here"), job("orphan", "Lost parent", "deleted-id")],
    });
    render(<JtbdMapperClient />);
    expect(screen.getByText("Lost parent")).toBeInTheDocument();
    expect(kpi("Top-level")).toBe("2");
    expect(kpi("Max depth")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Remove job story: when Lost parent" }));
    expect(jobs().map((j) => j.id)).toEqual(["a"]);
  });
});

describe("JTBD: inline editing", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      jobStories: [{ ...job("a", "onboarding"), description: "Old note" }, job("b", "billing")],
    });
  });

  it("commits a clause on blur and closes on Done", () => {
    render(<JtbdMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when onboarding" }));
    const situation = screen.getAllByLabelText("When (situation)")[1];
    expect(situation).toHaveValue("onboarding");
    fireEvent.change(situation, { target: { value: "first-time setup" } });
    fireEvent.blur(situation);
    expect(jobs()[0].situation).toBe("first-time setup");
    // The other story is untouched.
    expect(jobs()[1].situation).toBe("billing");

    const outcome = screen.getAllByLabelText("So I can (outcome)")[1];
    fireEvent.change(outcome, { target: { value: "start in one click" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Done flushes the unblurred edit too.
    expect(jobs()[0].outcome).toBe("start in one click");
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(sentence("first-time setup")).toHaveTextContent(
      "When first-time setup, I want to m-a, so I can start in one click."
    );
  });

  it("clearing the description removes it", () => {
    render(<JtbdMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when onboarding" }));
    const description = screen.getAllByLabelText("Description")[1];
    expect(description).toHaveValue("Old note");
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.blur(description);
    expect(jobs()[0].description).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Old note")).toBeNull();
  });

  it("an unchanged blur writes nothing", () => {
    render(<JtbdMapperClient />);
    const before = jobs();
    fireEvent.click(screen.getByRole("button", { name: "Edit job story: when onboarding" }));
    fireEvent.blur(screen.getAllByLabelText("When (situation)")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(jobs()).toBe(before);
  });
});

describe("JTBD: CSV export", () => {
  it("writes each story's clauses, its parent's sentence and description", () => {
    useWorkspaceStore.setState({
      jobStories: [
        job("a", "onboarding"),
        { ...job("b", "first login", "a"), description: "Seen in support tickets" },
      ],
    });
    render(<JtbdMapperClient />);
    expect(exported.csv?.headers).toEqual([
      "Situation",
      "Motivation",
      "Outcome",
      "Parent",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["onboarding", "m-a", "o-a", "", ""],
      [
        "first login",
        "m-b",
        "o-b",
        "When onboarding, I want to m-a, so I can o-a.",
        "Seen in support tickets",
      ],
    ]);
  });
});

describe("JTBD: AI prompt", () => {
  it("has no prompt without stories", () => {
    expect(generateJtbdPrompts({ jobs: [] })).toEqual([]);
  });

  it("lists each story with its parent and counts top-level vs nested", () => {
    const [prompt] = generateJtbdPrompts({
      jobs: [job("a", "onboarding"), job("b", "first login", "a")],
    });
    expect(prompt.prompt).toContain("2 job stories captured (1 top-level, 1 nested).");
    expect(prompt.prompt).toContain("When first login, I want to m-b, so I can o-b.");
  });

  // The page shows a story whose parent is gone as top-level; the prompt
  // counted it as nested.
  it("counts a story whose parent is gone as top-level, like the page", () => {
    const [prompt] = generateJtbdPrompts({
      jobs: [job("a", "onboarding"), job("orphan", "lost", "deleted-id")],
    });
    expect(prompt.prompt).toContain("2 job stories captured (2 top-level, 0 nested).");
  });
});
