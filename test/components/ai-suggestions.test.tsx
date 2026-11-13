/**
 * <AiSuggestions>: the review list for what Amr suggested. Text is plain text
 * (an answer can't inject HTML), and nothing reaches the tool until the person
 * adds one item, adds them all, or dismisses the list.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AiSuggestions } from "@/components/ai";

afterEach(() => cleanup());

const ITEMS = ["Monday", "Tuesday", "Thursday"];

describe("AiSuggestions", () => {
  it("shows text as text: markup in an answer stays inert", () => {
    const evil = '<img src=x onerror="alert(1)"> **bold** [link](https://evil.test)';
    const { container } = render(
      <AiSuggestions items={[evil]} onAccept={() => {}} onDismiss={() => {}} source="ai" />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText(evil)).toBeInTheDocument();
  });

  it("says where the items came from", () => {
    const { rerender } = render(
      <AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={() => {}} source="ai" />
    );
    expect(screen.getByText("Suggested by Amr's AI. Check before you add.")).toBeInTheDocument();
    rerender(
      <AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={() => {}} source="fallback" />
    );
    expect(screen.getByText("Suggested without AI. Check before you add.")).toBeInTheDocument();
  });

  it("adds one item, which then leaves the list", () => {
    const onAccept = vi.fn();
    render(<AiSuggestions items={ITEMS} onAccept={onAccept} onDismiss={() => {}} source="ai" />);
    fireEvent.click(screen.getByRole("button", { name: "Add: Tuesday" }));
    expect(onAccept).toHaveBeenCalledWith("Tuesday", 1);
    expect(screen.queryByText("Tuesday")).toBeNull();
    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add all 2" })).toBeInTheDocument();
  });

  it("keeps an added item out when the parent passes the same items again", () => {
    const onAccept = vi.fn();
    const { rerender } = render(
      <AiSuggestions items={[...ITEMS]} onAccept={onAccept} onDismiss={() => {}} source="ai" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add: Monday" }));
    rerender(
      <AiSuggestions items={[...ITEMS]} onAccept={onAccept} onDismiss={() => {}} source="ai" />
    );
    expect(screen.queryByText("Monday")).toBeNull();
    // A list with new contents starts afresh.
    rerender(
      <AiSuggestions
        items={["Monday", "Friday"]}
        onAccept={onAccept}
        onDismiss={() => {}}
        source="ai"
      />
    );
    expect(screen.getByText("Monday")).toBeInTheDocument();
  });

  it("adds all that are left, through onAcceptAll when given", () => {
    const onAccept = vi.fn();
    const onAcceptAll = vi.fn();
    render(
      <AiSuggestions
        items={ITEMS}
        onAccept={onAccept}
        onAcceptAll={onAcceptAll}
        onDismiss={() => {}}
        source="ai"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add: Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Add all 2" }));
    expect(onAcceptAll).toHaveBeenCalledWith(["Tuesday", "Thursday"]);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("All added.");
  });

  it("adds all one by one when there is no onAcceptAll", () => {
    const onAccept = vi.fn();
    render(<AiSuggestions items={ITEMS} onAccept={onAccept} onDismiss={() => {}} source="ai" />);
    fireEvent.click(screen.getByRole("button", { name: "Add all 3" }));
    expect(onAccept.mock.calls).toEqual([
      ["Monday", 0],
      ["Tuesday", 1],
      ["Thursday", 2],
    ]);
  });

  it("dismisses without adding anything", () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<AiSuggestions items={ITEMS} onAccept={onAccept} onDismiss={onDismiss} source="ai" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestions" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("hands focus back to returnFocus on Dismiss, before the list goes", () => {
    const asker = document.createElement("button");
    asker.textContent = "Ask";
    document.body.appendChild(asker);
    try {
      let focusedAtDismiss: Element | null = null;
      render(
        <AiSuggestions
          items={ITEMS}
          onAccept={() => {}}
          onDismiss={() => {
            focusedAtDismiss = document.activeElement;
          }}
          returnFocus={() => asker}
          source="ai"
        />
      );
      const dismiss = screen.getByRole("button", { name: "Dismiss suggestions" });
      dismiss.focus();
      fireEvent.click(dismiss);
      expect(focusedAtDismiss).toBe(asker);
      expect(document.activeElement).toBe(asker);
    } finally {
      asker.remove();
    }
  });

  it("leaves focus to the caller on Dismiss without returnFocus", () => {
    const onDismiss = vi.fn();
    render(<AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={onDismiss} source="ai" />);
    const dismiss = screen.getByRole("button", { name: "Dismiss suggestions" });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dismiss);
  });

  it("renders objects through render, with a detail line", () => {
    const items = [{ text: "Split by workflow step", why: "The story has three steps." }];
    render(
      <AiSuggestions
        items={items}
        render={(i) => ({ title: i.text, detail: i.why })}
        onAccept={() => {}}
        onDismiss={() => {}}
        source="ai"
        acceptLabel="Use"
      />
    );
    expect(screen.getByText("Split by workflow step")).toBeInTheDocument();
    expect(screen.getByText("The story has three steps.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use: Split by workflow step" })).toBeInTheDocument();
  });

  it("keeps keyboard focus in the list: next Add button, then the one before, then the heading", () => {
    render(<AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={() => {}} source="ai" />);
    const tuesday = screen.getByRole("button", { name: "Add: Tuesday" });
    tuesday.focus();
    fireEvent.click(tuesday);
    // The next one along.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add: Thursday" }));
    fireEvent.click(screen.getByRole("button", { name: "Add: Thursday" }));
    // Nothing after it: the one before.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add: Monday" }));
    fireEvent.click(screen.getByRole("button", { name: "Add: Monday" }));
    // None left: the heading, with "All added." announced.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Amr's suggestions" }));
    expect(screen.getByRole("status")).toHaveTextContent("All added.");
    expect(document.activeElement).not.toBe(document.body);
  });

  it("moves focus to the heading after Add all", () => {
    render(<AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={() => {}} source="ai" />);
    const all = screen.getByRole("button", { name: "Add all 3" });
    all.focus();
    fireEvent.click(all);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Amr's suggestions" }));
  });

  it("offers no Add all when the items are alternatives (pickOne)", () => {
    const onAccept = vi.fn();
    render(
      <AiSuggestions items={ITEMS} pickOne onAccept={onAccept} onDismiss={() => {}} source="ai" />
    );
    expect(screen.queryByRole("button", { name: /all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add: Tuesday" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /all/ })).toBeNull();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(
      <AiSuggestions items={[]} onAccept={() => {}} onDismiss={() => {}} source="ai" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * A caller that drops each accepted item from `items` (it rebuilds the list
 * from live data), and can unmount the list once it is empty.
 */
function Dropping({
  initial,
  drop = (list, item) => list.filter((x) => x !== item),
  unmountWhenEmpty = false,
}: {
  initial: string[];
  drop?: (list: string[], item: string) => string[];
  unmountWhenEmpty?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const askRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={askRef} type="button">
        Ask
      </button>
      {unmountWhenEmpty && items.length === 0 ? (
        <p>Every one is in.</p>
      ) : (
        <AiSuggestions
          items={items}
          onAccept={(item) => setItems((list) => drop(list, item))}
          onAcceptAll={() => setItems([])}
          onDismiss={() => {}}
          returnFocus={() => askRef.current}
          source="ai"
        />
      )}
    </div>
  );
}

describe("AiSuggestions: a caller that changes the list", () => {
  const focused = () => document.activeElement;
  const add = (name: string) => screen.getByRole("button", { name: `Add: ${name}` });

  it("focuses the row that followed when the caller drops the added item, never skipping one", () => {
    render(<Dropping initial={["Monday", "Tuesday", "Thursday"]} />);
    add("Monday").focus();
    fireEvent.click(add("Monday"));
    expect(screen.queryByText("Monday")).toBeNull();
    expect(focused()).toBe(add("Tuesday"));
    expect(screen.getByText("Thursday")).toBeInTheDocument();
    fireEvent.click(add("Tuesday"));
    expect(focused()).toBe(add("Thursday"));
    fireEvent.click(add("Thursday"));
    // None left: the list stays with "All added.", and its heading has focus.
    expect(screen.getByRole("status")).toHaveTextContent("All added.");
    expect(focused()).toBe(screen.getByRole("heading", { name: "Amr's suggestions" }));
  });

  it("keeps the heading focused when the caller empties the list on Add all", () => {
    render(<Dropping initial={["Monday", "Tuesday", "Thursday"]} />);
    const all = screen.getByRole("button", { name: "Add all 3" });
    all.focus();
    fireEvent.click(all);
    expect(screen.getByRole("status")).toHaveTextContent("All added.");
    expect(focused()).toBe(screen.getByRole("heading", { name: "Amr's suggestions" }));
  });

  it("focuses the next row left when the focused one goes as well", () => {
    // The caller drops the added item and the one after it (a merge took both).
    render(
      <Dropping
        initial={["Monday", "Tuesday", "Thursday"]}
        drop={(list, item) => (item === "Monday" ? list.filter((x) => x === "Thursday") : list)}
      />
    );
    add("Monday").focus();
    fireEvent.click(add("Monday"));
    expect(screen.queryByText("Tuesday")).toBeNull();
    expect(focused()).toBe(add("Thursday"));
  });

  it("hands focus to returnFocus when the caller unmounts the list while focus is in it", () => {
    render(<Dropping initial={["Monday"]} unmountWhenEmpty />);
    add("Monday").focus();
    fireEvent.click(add("Monday"));
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
    expect(focused()).toBe(screen.getByRole("button", { name: "Ask" }));
  });

  it("leaves focus where the caller put it in onAccept, after the list closes", () => {
    function Form() {
      const [open, setOpen] = useState(true);
      const field = useRef<HTMLTextAreaElement>(null);
      return (
        <div>
          <label>
            Goal
            <textarea ref={field} />
          </label>
          {open && (
            <AiSuggestions
              items={["Goal one", "Goal two"]}
              pickOne
              acceptLabel="Use"
              onAccept={() => {
                setOpen(false);
                field.current?.focus();
              }}
              onDismiss={() => setOpen(false)}
              source="fallback"
            />
          )}
        </div>
      );
    }
    render(<Form />);
    const use = screen.getByRole("button", { name: "Use: Goal one" });
    use.focus();
    fireEvent.click(use);
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
    expect(focused()).toBe(screen.getByLabelText("Goal"));
  });

  it("follows itemKey: a row whose text changes stays the same row, still added", () => {
    const onAccept = vi.fn();
    const props = {
      onAccept,
      onDismiss: () => {},
      source: "ai" as const,
      itemKey: (i: { id: string; text: string }) => i.id,
      render: (i: { id: string; text: string }) => i.text,
    };
    const { rerender } = render(
      <AiSuggestions
        {...props}
        items={[
          { id: "a", text: "Split logs" },
          { id: "b", text: "No alert" },
        ]}
      />
    );
    fireEvent.click(add("Split logs"));
    const no = add("No alert");
    rerender(
      <AiSuggestions
        {...props}
        items={[
          { id: "a", text: "Split the logs" },
          { id: "b", text: "No alert on errors" },
        ]}
      />
    );
    expect(screen.queryByText("Split the logs")).toBeNull();
    // The same row (and button) as before, with its new text.
    expect(add("No alert on errors")).toBe(no);
  });

  it("starts afresh when the list loses an item that wasn't added", () => {
    const { rerender } = render(
      <AiSuggestions items={ITEMS} onAccept={() => {}} onDismiss={() => {}} source="ai" />
    );
    fireEvent.click(add("Monday"));
    // A new answer: Thursday went without being added.
    rerender(
      <AiSuggestions
        items={["Monday", "Tuesday"]}
        onAccept={() => {}}
        onDismiss={() => {}}
        source="ai"
      />
    );
    expect(screen.getByText("Monday")).toBeInTheDocument();
  });

  it("shows two equal items as two rows, and adding one keeps the other", () => {
    const onAccept = vi.fn();
    render(
      <AiSuggestions
        items={["Retro", "Retro"]}
        onAccept={onAccept}
        onDismiss={() => {}}
        source="ai"
      />
    );
    const [first] = screen.getAllByRole("button", { name: "Add: Retro" });
    fireEvent.click(first);
    expect(onAccept).toHaveBeenCalledWith("Retro", 0);
    expect(screen.getAllByRole("button", { name: "Add: Retro" })).toHaveLength(1);
  });
});
