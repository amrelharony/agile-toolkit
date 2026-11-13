/**
 * A story's structured acceptance criteria, Given/When/Then (`Story.gwt`):
 * the cleaning every write runs, the text the exports use, the form's
 * checks, the store keeping them beside the free text, and the editor in
 * the story's details panel (add, edit, delete with Undo, read only without
 * an editor).
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { TOOL_TEXT_MAX, type Story, type StoryGwt } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

import {
  STORY_GWT_MAX,
  cleanGwt,
  cleanStoryFields,
  gwtCell,
  gwtLines,
  gwtSentence,
  hasStoryGwt,
  validateGwtDraft,
  withStoryGwt,
} from "@/lib/stories/fields";
import { StoryDetailsPanel } from "@/components/stories/story-details";
import { planCsv } from "@/app/(tools)/sprint-planning/markdown";

const ROW: StoryGwt = { id: "g1", given: "a saved card", when: "I pay", then: "I'm charged once" };

const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});

const wrap = (ui: ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ stories: [] });
});

describe("cleaning the scenarios", () => {
  it("keeps clean rows as they are, the same array", () => {
    const rows = [ROW];
    expect(cleanGwt(rows)).toBe(rows);
    const s = story({ gwt: rows });
    expect(cleanStoryFields(s)).toBe(s);
  });

  it("trims and caps each part, drops empty rows, and gives missing or repeated ids new ones", () => {
    const out = cleanGwt([
      {
        id: "g1",
        given: "  a cart  ",
        when: "I pay\r\n",
        then: "x".repeat(TOOL_TEXT_MAX.text + 50),
      },
      { id: "g2", given: " ", when: "", then: "  " },
      { id: "g1", given: "a", when: "b", then: "c" },
      { id: "", given: "d", when: "e", then: "f" },
    ])!;
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "g1", given: "a cart", when: "I pay" });
    expect(out[0].then).toHaveLength(TOOL_TEXT_MAX.text);
    expect(out[1].id).not.toBe("g1");
    expect(out[2].id).toMatch(/^gwt_/);
    expect(new Set(out.map((r) => r.id)).size).toBe(3);
  });

  it("keeps at most the cap, and nothing for no rows", () => {
    const many = Array.from({ length: STORY_GWT_MAX + 3 }, (_, i) => ({ ...ROW, id: `g${i}` }));
    expect(cleanGwt(many)).toHaveLength(STORY_GWT_MAX);
    expect(cleanGwt([])).toBeUndefined();
    expect(cleanGwt("nope")).toBeUndefined();
    const s = cleanStoryFields(story({ gwt: [{ id: "x", given: "", when: "", then: "" }] }));
    expect("gwt" in s).toBe(false);
  });

  it("the store cleans them on every write and leaves the free text alone", () => {
    useWorkspaceStore.getState().upsertStory(
      story({
        acceptanceCriteria: "Works on any card.",
        gwt: [{ ...ROW, given: "  a saved card " }],
      })
    );
    const saved = useWorkspaceStore.getState().stories[0];
    expect(saved.gwt).toEqual([ROW]);
    expect(saved.acceptanceCriteria).toBe("Works on any card.");
  });

  it("withStoryGwt sets or clears the list", () => {
    const s = story({ acceptanceCriteria: "Free text" });
    expect(withStoryGwt(s, [ROW]).gwt).toEqual([ROW]);
    const cleared = withStoryGwt(story({ gwt: [ROW] }), []);
    expect("gwt" in cleared).toBe(false);
    expect(withStoryGwt(s, [ROW]).acceptanceCriteria).toBe("Free text");
    expect(hasStoryGwt(s)).toBe(false);
    expect(hasStoryGwt(story({ gwt: [ROW] }))).toBe(true);
  });
});

describe("the scenarios as text", () => {
  it("reads as a sentence, as lines, and as one cell", () => {
    expect(gwtSentence(ROW)).toBe("Given a saved card, when I pay, then I'm charged once.");
    expect(gwtLines([ROW, { ...ROW, id: "g2", then: "I get a receipt" }])).toEqual([
      "Given a saved card",
      "When I pay",
      "Then I'm charged once",
      "",
      "Given a saved card",
      "When I pay",
      "Then I get a receipt",
    ]);
    expect(gwtCell([ROW, { ...ROW, id: "g2", then: "I get a receipt." }])).toBe(
      "Given a saved card, when I pay, then I'm charged once. | Given a saved card, when I pay, then I get a receipt."
    );
    expect(gwtCell(undefined)).toBe("");
  });
});

describe("Sprint Planning's CSV", () => {
  it("holds both the free-text criteria and the scenarios", () => {
    const csv = planCsv([
      story({ status: "todo", points: 5, acceptanceCriteria: "Any card works.", gwt: [ROW] }),
      story({ id: "st2", title: "Refund", status: "in_progress" }),
    ]);
    expect(csv.headers).toEqual([
      "Story",
      "Points",
      "Status",
      "Owner",
      "Ticket",
      "Acceptance criteria",
      "Given / When / Then",
    ]);
    expect(csv.rows[0]).toEqual([
      "Pay with a saved card",
      5,
      "todo",
      "",
      "",
      "Any card works.",
      "Given a saved card, when I pay, then I'm charged once.",
    ]);
    expect(csv.rows[1]).toEqual(["Refund", "", "in progress", "", "", "", ""]);
  });
});

describe("the scenario form's checks", () => {
  it("asks for all three parts", () => {
    const v = validateGwtDraft({ given: " ", when: "I pay", then: "" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors).toEqual({
        given: "Write the “Given” part.",
        then: "Write the “Then” part.",
      });
    }
  });

  it("refuses a part over the cap and trims the rest", () => {
    const long = validateGwtDraft({
      given: "x".repeat(TOOL_TEXT_MAX.text + 1),
      when: "b",
      then: "c",
    });
    expect(long.ok || long.errors.given).toMatch(/1,000 characters or fewer/);
    expect(validateGwtDraft({ given: " a ", when: "b", then: "c " })).toEqual({
      ok: true,
      values: { given: "a", when: "b", then: "c" },
    });
  });
});

/** The panel with its own copy of the story, as a page holds it. */
function Harness({ initial, editable = true }: { initial: Story; editable?: boolean }) {
  const [s, setS] = useState(initial);
  return (
    <>
      <StoryDetailsPanel
        story={s}
        onSave={() => {}}
        onSaveGwt={editable ? (gwt) => setS((cur) => withStoryGwt(cur, gwt)) : undefined}
      />
      <pre data-testid="gwt">{JSON.stringify(s.gwt ?? [])}</pre>
    </>
  );
}

const rows = () => JSON.parse(screen.getByTestId("gwt").textContent ?? "[]") as StoryGwt[];

describe("the details panel's scenarios", () => {
  it("adds a scenario through the form, which says what is missing first", () => {
    wrap(<Harness initial={story({ acceptanceCriteria: "Any card works." })} />);
    expect(screen.getByText("Any card works.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add a scenario/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(screen.getByText("Write the “Given” part.")).toBeInTheDocument();
    expect(rows()).toEqual([]);
    fireEvent.change(screen.getByLabelText("Given"), { target: { value: "a saved card" } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "I pay" } });
    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "I'm charged once" } });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(rows()).toMatchObject([
      { given: "a saved card", when: "I pay", then: "I'm charged once" },
    ]);
    const list = screen.getByRole("list", { name: "Scenarios for Pay with a saved card" });
    expect(within(list).getByText("a saved card")).toBeInTheDocument();
    // The free text stays beside it, untouched.
    expect(screen.getByText("Any card works.")).toBeInTheDocument();
  });

  it("edits a scenario in place", () => {
    wrap(<Harness initial={story({ gwt: [ROW] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scenario 1" }));
    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "I get a receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    expect(rows()).toEqual([{ ...ROW, then: "I get a receipt" }]);
  });

  it("deletes a scenario with Undo back to its place", () => {
    const second = { ...ROW, id: "g2", then: "I get a receipt" };
    wrap(<Harness initial={story({ gwt: [ROW, second] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete scenario 1" }));
    expect(rows()).toEqual([second]);
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Deleted scenario 1 of “Pay with a saved card”");
    undoLast();
    expect(rows()).toEqual([ROW, second]);
  });

  it("tells the page which write is the delete and which its Undo, with one key", () => {
    const writes: { gwt: StoryGwt[]; write?: { kind: string; key: string } }[] = [];
    function Spy() {
      const [s, setS] = useState(story({ gwt: [ROW] }));
      return (
        <StoryDetailsPanel
          story={s}
          onSave={() => {}}
          onSaveGwt={(gwt, write) => {
            writes.push({ gwt, write });
            setS((cur) => withStoryGwt(cur, gwt));
          }}
        />
      );
    }
    wrap(<Spy />);
    fireEvent.click(screen.getByRole("button", { name: "Delete scenario 1" }));
    undoLast();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ gwt: [], write: { kind: "remove" } });
    expect(writes[1]).toMatchObject({ gwt: [ROW], write: { kind: "restore" } });
    expect(writes[1].write?.key).toBe(writes[0].write?.key);
    // An edit is a plain write.
    fireEvent.click(screen.getByRole("button", { name: "Edit scenario 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    expect(writes[2].write).toBeUndefined();
  });

  it("shows them read only beside the free text when the page has no editor", () => {
    wrap(
      <Harness initial={story({ acceptanceCriteria: "Any card.", gwt: [ROW] })} editable={false} />
    );
    expect(screen.getByText("Given / When / Then")).toBeInTheDocument();
    expect(screen.getByText("a saved card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a scenario/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete scenario/ })).toBeNull();
  });

  it("puts focus back on the scenario's Edit after Save or Cancel", async () => {
    wrap(<Harness initial={story({ gwt: [ROW, { ...ROW, id: "g2" }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit scenario 2" }));
    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "I get a receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scenario" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit scenario 2" })).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit scenario 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit scenario 1" })).toHaveFocus()
    );
    expect(rows().map((r) => r.then)).toEqual(["I'm charged once", "I get a receipt"]);
  });

  it("offers scenarios while the free-text form is open; one added keeps the panel on Cancel", () => {
    const onEmpty = vi.fn();
    function Open() {
      const [s, setS] = useState(story());
      return (
        <>
          <StoryDetailsPanel
            story={s}
            startEditing
            onSave={() => {}}
            onSaveGwt={(gwt) => setS((cur) => withStoryGwt(cur, gwt))}
            onEmpty={onEmpty}
          />
          <pre data-testid="gwt">{JSON.stringify(s.gwt ?? [])}</pre>
        </>
      );
    }
    const { unmount } = wrap(<Open />);
    // The free-text form is open, and the scenario editor sits under it.
    expect(screen.getByRole("button", { name: "Save details" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add a scenario/ }));
    fireEvent.change(screen.getByLabelText("Given"), { target: { value: "a saved card" } });
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "I pay" } });
    fireEvent.change(screen.getByLabelText("Then"), { target: { value: "I'm charged once" } });
    fireEvent.click(screen.getByRole("button", { name: "Add scenario" }));
    expect(rows()).toHaveLength(1);
    // Nothing in the four fields, but the panel stays: it has the scenarios to show.
    const cancel = screen.getAllByRole("button", { name: "Cancel" })[0];
    fireEvent.click(cancel);
    expect(onEmpty).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Add details/ })).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Scenarios for Pay with a saved card" })
    ).toBeInTheDocument();
    unmount();
    // With nothing written either way, Cancel still hands the empty panel back.
    wrap(<Open />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("stops adding at the cap", () => {
    const full = Array.from({ length: STORY_GWT_MAX }, (_, i) => ({ ...ROW, id: `g${i}` }));
    wrap(<Harness initial={story({ gwt: full })} />);
    expect(screen.queryByRole("button", { name: /Add a scenario/ })).toBeNull();
    expect(screen.getByText(/is the most a story keeps/)).toBeInTheDocument();
  });
});
