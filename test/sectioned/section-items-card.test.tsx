/**
 * The sectioned kit's section card (components/sectioned/section-items-card):
 * Enter adds a line, capped, with "This section is full"; lines are edited in
 * place and deleted with Undo; the three slots (extras, actions, a label
 * before the text); the keyboard path; the phone order (text, then extras,
 * then actions); single and long answers as one field; read only; and a
 * change the tool refuses. Also the credit line.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SectionDef } from "@/lib/sectioned/model";
import type { SectionItem } from "@/lib/stores/workspace-types";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

import {
  SectionItemsCard,
  type SectionItemsCardProps,
} from "@/components/sectioned/section-items-card";
import { SectionCreditLine } from "@/components/sectioned/section-credit";

interface RatedItem extends SectionItem {
  likelihood?: number;
}

const LIST: SectionDef = {
  id: "risks",
  label: "What could trip us up",
  prompt: "Name the things that could stop us.",
  hint: "One worry per line.",
  kind: "list",
  max: 3,
  required: true,
  starter: "[something] could stop us",
};

const SINGLE: SectionDef = {
  id: "aim",
  label: "Our aim",
  prompt: "Say what we want, and by when.",
  kind: "single",
  max: 1,
  required: false,
};

const LONG: SectionDef = { ...SINGLE, id: "story", label: "The story", kind: "long" };

const item = (id: string, text: string, over: Partial<RatedItem> = {}): RatedItem => ({
  id,
  text,
  ...over,
});

type HarnessProps = Omit<SectionItemsCardProps<RatedItem>, "items" | "onChange"> & {
  initial: RatedItem[];
  /** Sees every change first; a string refuses it. */
  spy?: (next: RatedItem[]) => string | void;
};

/** The card over a page's state, as a tool holds it. */
function Harness({ initial, spy, ...props }: HarnessProps) {
  const [items, setItems] = useState(initial);
  return (
    <SectionItemsCard<RatedItem>
      {...props}
      items={items}
      onChange={(next) => {
        const refused = spy?.(next);
        if (typeof refused === "string") return refused;
        setItems(next);
      }}
    />
  );
}

const IDEAS: SectionDef = {
  id: "ideas",
  label: "Ideas to try",
  prompt: "What could we try first?",
  kind: "list",
  max: 5,
  required: false,
};

type Doc = Record<string, RatedItem[]>;

/**
 * Two cards over one document, whose onChange saves the whole document and
 * closes over it as the page renders: the way Kickoff and Product Canvas
 * save a whole row.
 */
function DocHarness({ initial, spy }: { initial: Doc; spy?: (doc: Doc) => string | void }) {
  const [doc, setDoc] = useState(initial);
  const save = (next: Doc) => {
    const refused = spy?.(next);
    if (typeof refused === "string") return refused;
    setDoc(next);
  };
  return (
    <>
      {[LIST, IDEAS].map((def) => (
        <SectionItemsCard<RatedItem>
          key={def.id}
          def={def}
          items={doc[def.id]}
          itemMax={50}
          onChange={(next) => save({ ...doc, [def.id]: next })}
        />
      ))}
    </>
  );
}

const wrap = (ui: ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** The lines a list section shows, by its label. */
const textsOf = (label: string) => {
  const list = screen.queryByRole("list", { name: label });
  if (!list) return [];
  return within(list)
    .queryAllByRole("listitem")
    .map((r) =>
      r
        .querySelector("[data-slot=text] button, [data-slot=text] p")
        ?.textContent?.replace(" (edit)", "")
    );
};

const addField = () => screen.getByRole("textbox", { name: "Add to What could trip us up" });

const typeAndEnter = (el: HTMLElement, text: string) => {
  fireEvent.change(el, { target: { value: text } });
  fireEvent.keyDown(el, { key: "Enter" });
};

const rows = () =>
  within(screen.getByRole("list", { name: LIST.label })).queryAllByRole("listitem");

const rowTexts = () =>
  screen.queryByRole("list", { name: LIST.label })
    ? rows().map((r) =>
        r
          .querySelector("[data-slot=text] button, [data-slot=text] p")
          ?.textContent?.replace(" (edit)", "")
      )
    : [];

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.dismiss.mockClear();
});

describe("a list section", () => {
  it("shows its label, prompt, hint, whether it's required and how full it is", () => {
    wrap(<Harness def={LIST} initial={[item("r1", "Late")]} itemMax={50} />);
    expect(screen.getByRole("heading", { name: /What could trip us up/ })).toBeInTheDocument();
    expect(screen.getByText("Name the things that could stop us.")).toBeInTheDocument();
    expect(screen.getByText("One worry per line.")).toBeInTheDocument();
    expect(screen.getByText("Required · 1 of 3")).toBeInTheDocument();
    expect(addField()).toHaveAttribute("placeholder", "[something] could stop us");
  });

  it("adds a trimmed line on Enter, clears the field and keeps focus there", () => {
    const spy = vi.fn();
    wrap(<Harness def={LIST} initial={[]} itemMax={50} spy={spy} />);
    const field = addField();
    field.focus();
    typeAndEnter(field, "   Budget   cut  ");
    expect(spy).toHaveBeenCalledTimes(1);
    const [next] = spy.mock.calls[0];
    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("Budget cut");
    expect(next[0].id).toMatch(/^[\w-]{8}$/);
    expect(rowTexts()).toEqual(["Budget cut"]);
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });

  it("adds with the Add button too, and adds nothing for a blank line", () => {
    const spy = vi.fn();
    wrap(<Harness def={LIST} initial={[]} itemMax={50} spy={spy} />);
    typeAndEnter(addField(), "   ");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(addField(), { target: { value: "Key person leaves" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rowTexts()).toEqual(["Key person leaves"]);
  });

  it("caps a line at the item cap", () => {
    const spy = vi.fn();
    wrap(<Harness def={LIST} initial={[]} itemMax={10} spy={spy} />);
    expect(addField()).toHaveAttribute("maxLength", "10");
    typeAndEnter(addField(), "x".repeat(25));
    expect(spy.mock.calls[0][0][0].text).toBe("x".repeat(10));
  });

  it("builds new items with the tool's makeItem", () => {
    const spy = vi.fn();
    wrap(
      <Harness
        def={LIST}
        initial={[]}
        itemMax={50}
        spy={spy}
        makeItem={(text) => ({ id: `risk_${text.length}`, text, likelihood: 3 })}
      />
    );
    typeAndEnter(addField(), "Late");
    expect(spy.mock.calls[0][0]).toEqual([{ id: "risk_4", text: "Late", likelihood: 3 }]);
  });

  it("says when the section is full and adds no more until a line goes", () => {
    const spy = vi.fn();
    wrap(
      <Harness def={LIST} initial={[item("r1", "One"), item("r2", "Two")]} itemMax={50} spy={spy} />
    );
    expect(screen.queryByText(/This section is full/)).not.toBeInTheDocument();
    typeAndEnter(addField(), "Three");
    expect(rowTexts()).toEqual(["One", "Two", "Three"]);
    expect(screen.getByRole("status")).toHaveTextContent("This section is full: it holds 3.");
    expect(screen.getByText("Required · 3 of 3")).toBeInTheDocument();
    expect(addField()).toHaveAttribute("readOnly");
    expect(addField()).toHaveAccessibleDescription(/This section is full/);
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveAttribute("aria-disabled", "true");
    spy.mockClear();
    typeAndEnter(addField(), "Four");
    fireEvent.click(add);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete “Two”" }));
    expect(screen.queryByText(/This section is full/)).not.toBeInTheDocument();
    expect(addField()).not.toHaveAttribute("readOnly");
  });

  it("edits a line in place: Enter saves and focus goes back to the line", () => {
    const spy = vi.fn();
    wrap(
      <Harness
        def={LIST}
        initial={[item("r1", "Late", { likelihood: 4 }), item("r2", "Costly")]}
        itemMax={50}
        spy={spy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Late (edit)" }));
    const editor = screen.getByRole("textbox", { name: "Line" });
    expect(editor).toHaveAttribute("maxLength", "50");
    fireEvent.change(editor, { target: { value: "Late by a month" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    // The edited item keeps its other fields; the rest are untouched.
    expect(spy.mock.calls[0][0]).toEqual([
      { id: "r1", text: "Late by a month", likelihood: 4 },
      { id: "r2", text: "Costly" },
    ]);
    expect(rowTexts()).toEqual(["Late by a month", "Costly"]);
    expect(screen.getByRole("button", { name: "Late by a month (edit)" })).toHaveFocus();
  });

  it("leaves the line as it was on Escape or an emptied text", () => {
    const spy = vi.fn();
    wrap(<Harness def={LIST} initial={[item("r1", "Late")]} itemMax={50} spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Late (edit)" }));
    const editor = screen.getByRole("textbox", { name: "Line" });
    fireEvent.change(editor, { target: { value: "Changed" } });
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Late (edit)" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Line" }), { target: { value: "  " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Line" }), { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
    expect(rowTexts()).toEqual(["Late"]);
  });

  it("deletes a line with Undo, which puts it back in its place", () => {
    wrap(
      <Harness
        def={LIST}
        initial={[item("r1", "One"), item("r2", "Two", { likelihood: 2 }), item("r3", "Three")]}
        itemMax={50}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete “Two”" }));
    expect(rowTexts()).toEqual(["One", "Three"]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Deleted “Two”");
    // Focus carries on from the add field.
    expect(addField()).toHaveFocus();
    undoLast();
    expect(rowTexts()).toEqual(["One", "Two", "Three"]);
  });

  it("keeps a line typed after a delete when the delete is undone", () => {
    wrap(<Harness def={LIST} initial={[item("r1", "One"), item("r2", "Two")]} itemMax={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    typeAndEnter(addField(), "New");
    undoLast();
    expect(rowTexts()).toEqual(["One", "Two", "New"]);
  });

  it("undoes through the newest onChange, so a line added to another section since stays", () => {
    wrap(
      <DocHarness
        initial={{ risks: [item("r1", "One"), item("r2", "Two")], ideas: [item("i1", "Pilot")] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    typeAndEnter(screen.getByRole("textbox", { name: "Add to Ideas to try" }), "Survey");
    expect(textsOf(IDEAS.label)).toEqual(["Pilot", "Survey"]);
    undoLast();
    expect(textsOf(LIST.label)).toEqual(["One", "Two"]);
    expect(textsOf(IDEAS.label)).toEqual(["Pilot", "Survey"]);
  });

  it("says when the tool refuses an Undo, and builds the next change on what the tool holds", () => {
    // The Undo's list no longer fits: the row grew in the meantime.
    const spy = vi.fn((doc: Doc) =>
      doc.risks.length === 2 && doc.risks.some((i) => i.text === "One")
        ? "This kickoff is too big to save. Shorten or remove some lines."
        : undefined
    );
    wrap(<DocHarness initial={{ risks: [item("r1", "One"), item("r2", "Two")] }} spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    expect(textsOf(LIST.label)).toEqual(["Two"]);
    undoLast();
    expect(screen.getByRole("alert")).toHaveTextContent("This kickoff is too big to save.");
    expect(textsOf(LIST.label)).toEqual(["Two"]);
    // The refused line never comes back with a later change.
    typeAndEnter(addField(), "Three");
    expect(spy.mock.calls.at(-1)?.[0].risks.map((i) => i.text)).toEqual(["Two", "Three"]);
    expect(textsOf(LIST.label)).toEqual(["Two", "Three"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes its Undo toasts when it goes, since its onChange no longer follows the page", () => {
    toastSpy.mockReturnValueOnce("undo-1");
    const { unmount } = wrap(<Harness def={LIST} initial={[item("r1", "One")]} itemMax={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    expect(toastSpy.dismiss).not.toHaveBeenCalled();
    unmount();
    expect(toastSpy.dismiss).toHaveBeenCalledTimes(1);
    expect(toastSpy.dismiss).toHaveBeenCalledWith("undo-1");
  });

  it("with update, undoes into the document the delete came from, after another one opened", () => {
    const docs: Record<string, Doc> = {
      a: { risks: [item("r1", "One"), item("r2", "Two")] },
      b: { risks: [item("r9", "Other")] },
    };
    function DocsHarness() {
      const [all, setAll] = useState(docs);
      const [open, setOpen] = useState("a");
      // Copies, as a page that cleans what it reads: the card finds lines by id.
      const items = all[open].risks.map((x) => ({ ...x }));
      return (
        <>
          <button type="button" onClick={() => setOpen("b")}>
            Open b
          </button>
          <SectionItemsCard<RatedItem>
            def={LIST}
            items={items}
            itemMax={50}
            onChange={(next) => setAll((d) => ({ ...d, [open]: { ...d[open], risks: next } }))}
            update={(fn) =>
              setAll((d) => ({ ...d, [open]: { ...d[open], risks: fn(d[open].risks) } }))
            }
          />
          <p data-testid="doc-a">{all.a.risks.map((i) => i.text).join(", ")}</p>
        </>
      );
    }
    wrap(<DocsHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Delete “One”" }));
    expect(textsOf(LIST.label)).toEqual(["Two"]);
    fireEvent.click(screen.getByRole("button", { name: "Open b" }));
    expect(textsOf(LIST.label)).toEqual(["Other"]);
    undoLast();
    expect(textsOf(LIST.label)).toEqual(["Other"]);
    expect(screen.getByTestId("doc-a")).toHaveTextContent("One, Two");
  });

  it("deletes only the row pressed when two items share an id", () => {
    wrap(
      <Harness def={LIST} initial={[item("same", "First"), item("same", "Second")]} itemMax={50} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete “Second”" }));
    expect(rowTexts()).toEqual(["First"]);
  });

  it("renders the three slots for each item, with that item", () => {
    wrap(
      <Harness
        def={LIST}
        initial={[item("r1", "Late", { likelihood: 4 }), item("r2", "Costly", { likelihood: 1 })]}
        itemMax={50}
        itemLabel={(i) => (i.likelihood && i.likelihood > 3 ? "~" : null)}
        renderExtras={(i) => <span>Likelihood {i.likelihood}</span>}
        renderActions={(i) => <button type="button">Send “{i.text}”</button>}
      />
    );
    const [late, costly] = rows();
    expect(within(late).getByText("~")).toBeInTheDocument();
    expect(within(costly).queryByText("~")).not.toBeInTheDocument();
    expect(within(late).getByText("Likelihood 4")).toBeInTheDocument();
    expect(within(costly).getByText("Likelihood 1")).toBeInTheDocument();
    expect(within(late).getByRole("button", { name: "Send “Late”" })).toBeInTheDocument();
    expect(within(costly).getByRole("button", { name: "Send “Costly”" })).toBeInTheDocument();
  });

  it("puts the text first, the extras under it and the actions last, stacked on a phone", () => {
    wrap(
      <Harness
        def={LIST}
        initial={[item("r1", "Late")]}
        itemMax={50}
        itemLabel={() => "~"}
        renderExtras={() => <span>Extras</span>}
        renderActions={() => <button type="button">Send</button>}
      />
    );
    const [row] = rows();
    const order = Array.from(row.querySelectorAll("[data-slot]")).map((el) =>
      el.getAttribute("data-slot")
    );
    expect(order).toEqual(["text", "label", "extras", "actions"]);
    // One column below `sm` (actions under the text), a row from `sm` up.
    expect(row.className).toMatch(/(^|\s)flex-col(\s|$)/);
    expect(row.className).toMatch(/(^|\s)sm:flex-row(\s|$)/);
    const actions = row.querySelector("[data-slot=actions]")!;
    expect(
      within(actions as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.textContent || b.getAttribute("aria-label"))
    ).toEqual(["Send", "Delete “Late”"]);
    // The add field and its button stack too.
    expect(addField().parentElement?.className).toMatch(/(^|\s)flex-col(\s|$)/);
  });

  it("works from the keyboard: add, edit, delete", () => {
    wrap(<Harness def={LIST} initial={[]} itemMax={50} />);
    const field = addField();
    field.focus();
    typeAndEnter(field, "Late");
    typeAndEnter(field, "Costly");
    expect(rowTexts()).toEqual(["Late", "Costly"]);
    // Enter on a line's button opens it (a native button's click).
    const line = screen.getByRole("button", { name: "Late (edit)" });
    line.focus();
    fireEvent.click(line);
    const editor = screen.getByRole("textbox", { name: "Line" });
    expect(editor).toHaveFocus();
    fireEvent.change(editor, { target: { value: "Very late" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Very late (edit)" })).toHaveFocus();
    const del = screen.getByRole("button", { name: "Delete “Costly”" });
    del.focus();
    fireEvent.click(del);
    expect(rowTexts()).toEqual(["Very late"]);
    expect(addField()).toHaveFocus();
  });

  it("shows a change the tool refuses, and keeps what was typed", () => {
    const spy = vi.fn((next: RatedItem[]) =>
      next.length > 1 ? "This kickoff is too big to save. Shorten or remove some lines." : undefined
    );
    wrap(<Harness def={LIST} initial={[item("r1", "Late")]} itemMax={50} spy={spy} />);
    typeAndEnter(addField(), "One more");
    expect(screen.getByRole("alert")).toHaveTextContent("This kickoff is too big to save.");
    expect(addField()).toHaveValue("One more");
    expect(addField()).toHaveAccessibleDescription(/too big to save/);
    expect(rowTexts()).toEqual(["Late"]);
    // The next change that goes through clears it.
    fireEvent.click(screen.getByRole("button", { name: "Delete “Late”" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the lines read only when disabled, with the tool's slots still there", () => {
    wrap(
      <Harness
        def={LIST}
        initial={[item("r1", "Late")]}
        itemMax={50}
        disabled
        renderActions={() => <span>Sent</span>}
      />
    );
    expect(screen.getByText("Late")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|Delete|Add/ })).not.toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("says when a read-only section has nothing in it", () => {
    wrap(<Harness def={LIST} initial={[]} itemMax={50} disabled />);
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("shows an owner-only line by its owner", () => {
    wrap(<Harness def={LIST} initial={[item("p1", "", { owner: "Sam" })]} itemMax={50} />);
    expect(screen.getByRole("button", { name: "Sam (edit)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete “this line”" })).toBeInTheDocument();
  });

  it("takes an action beside the title and more content under the items", () => {
    wrap(
      <Harness
        def={LIST}
        initial={[]}
        itemMax={50}
        actions={<a href="/premortem">Open Premortem</a>}
      >
        <p>Cover each worry</p>
      </Harness>
    );
    expect(screen.getByRole("link", { name: "Open Premortem" })).toBeInTheDocument();
    expect(screen.getByText("Cover each worry")).toBeInTheDocument();
  });
});

describe("a single or long answer", () => {
  it("is one field, saved when it is left", () => {
    const spy = vi.fn();
    wrap(
      <Harness
        def={{ ...SINGLE, starter: "We want [what] by [when]" }}
        initial={[]}
        itemMax={40}
        spy={spy}
        makeItem={(text) => ({ id: "aim_1", text })}
      />
    );
    const field = screen.getByRole("textbox", { name: "Our aim" });
    expect(field.tagName).toBe("INPUT");
    expect(field).toHaveAttribute("maxLength", "40");
    expect(field).toHaveAttribute("placeholder", "We want [what] by [when]");
    expect(screen.queryByText(/of 1/)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "  Ship tap to pay by May  " } });
    fireEvent.blur(field);
    expect(spy.mock.calls[0][0]).toEqual([{ id: "aim_1", text: "Ship tap to pay by May" }]);
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
  });

  it("changes the one answer and keeps its other fields", () => {
    const spy = vi.fn();
    wrap(
      <Harness
        def={SINGLE}
        initial={[item("a", "Ship", { likelihood: 2 })]}
        itemMax={40}
        spy={spy}
      />
    );
    const field = screen.getByRole("textbox", { name: "Our aim" });
    expect(field).toHaveValue("Ship");
    fireEvent.change(field, { target: { value: "Ship by May" } });
    fireEvent.blur(field);
    expect(spy.mock.calls[0][0]).toEqual([{ id: "a", text: "Ship by May", likelihood: 2 }]);
    spy.mockClear();
    fireEvent.change(field, { target: { value: "Ship by May " } });
    fireEvent.blur(field);
    expect(spy).not.toHaveBeenCalled();
  });

  it("clears the answer with Undo", () => {
    wrap(<Harness def={SINGLE} initial={[item("a", "Ship")]} itemMax={40} />);
    const field = screen.getByRole("textbox", { name: "Our aim" });
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    expect(field).toHaveValue("");
    expect(toastSpy.mock.calls[0][0]).toBe("Cleared “Our aim”");
    undoLast();
    expect(screen.getByRole("textbox", { name: "Our aim" })).toHaveValue("Ship");
  });

  it("uses a growing box for a long answer and keeps its paragraphs", () => {
    const spy = vi.fn();
    wrap(<Harness def={LONG} initial={[]} itemMax={500} spy={spy} />);
    const field = screen.getByRole("textbox", { name: "The story" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("maxLength", "500");
    fireEvent.change(field, { target: { value: "First.\r\n\r\nSecond.  " } });
    fireEvent.blur(field);
    expect(spy.mock.calls[0][0][0].text).toBe("First.\n\nSecond.");
  });

  it("renders the slots for the answer once there is one", () => {
    const { unmount } = wrap(
      <Harness
        def={SINGLE}
        initial={[]}
        itemMax={40}
        renderActions={(i) => <button type="button">Send “{i.text}”</button>}
      />
    );
    expect(screen.queryByRole("button", { name: /Send/ })).not.toBeInTheDocument();
    unmount();
    wrap(
      <Harness
        def={SINGLE}
        initial={[item("a", "Ship")]}
        itemMax={40}
        itemLabel={() => "~"}
        renderExtras={() => <span>Fact</span>}
        renderActions={(i) => <button type="button">Send “{i.text}”</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Send “Ship”" })).toBeInTheDocument();
    expect(screen.getByText("Fact")).toBeInTheDocument();
    expect(screen.getByText("~")).toBeInTheDocument();
  });

  it("shows the answer as text when disabled", () => {
    wrap(<Harness def={LONG} initial={[item("s", "Once upon a sprint")]} itemMax={500} disabled />);
    expect(screen.getByText("Once upon a sprint")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("the credit line", () => {
  it("links the credit's words when it has an https address, and adds the licence", () => {
    render(
      <SectionCreditLine
        credit={{
          text: "After a made-up canvas",
          url: "https://example.com/canvas",
          licence: "CC BY 4.0",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /After a made-up canvas/ });
    expect(link).toHaveAttribute("href", "https://example.com/canvas");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("p")).toHaveTextContent(
      "After a made-up canvas (opens in a new tab) (CC BY 4.0)"
    );
  });

  it("is plain text without a valid link, shows no licence when there is none, and nothing without a credit", () => {
    const { container, rerender } = render(
      <SectionCreditLine credit={{ text: "After a canvas", url: "http://example.com" }} />
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.textContent).toBe("After a canvas");
    rerender(<SectionCreditLine credit={undefined} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SectionCreditLine credit={{ text: "  " }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
