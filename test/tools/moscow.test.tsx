import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * MoSCoW Matrix: adding scope items, moving them between buckets, removing,
 * the unknown-bucket fallback and the CSV export. Backlog import/linking is
 * covered in rice-backlog-import.test.tsx.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
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

import { MoscowClient } from "@/app/(tools)/moscow/moscow-client";

const row = (
  id: string,
  title: string,
  bucket: string,
  framework: PrioritizationItem["framework"] = "moscow"
): PrioritizationItem => ({
  id,
  framework,
  title,
  fields: { bucket },
  status: "scored",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const all = () => useWorkspaceStore.getState().prioritizations ?? [];
const moscowRows = () => all().filter((x) => x.framework === "moscow");
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
const column = (label: string) =>
  screen.getByText(label, { selector: "span.font-bold" }).closest(".min-w-0") as HTMLElement;
const titlesIn = (label: string) =>
  within(column(label))
    .queryAllByRole("listitem")
    .map((li) => li.querySelector(".flex-1")?.textContent);

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  exported.csv = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ prioritizations: [], backlogItems: [] });
});

describe("MoSCoW: empty state", () => {
  it("shows four empty buckets", () => {
    render(<MoscowClient />);
    expect(screen.getByText("Buckets (0 items)")).toBeInTheDocument();
    for (const label of ["Must have", "Should have", "Could have", "Won't have (this time)"]) {
      expect(column(label)).toHaveTextContent(`${label}0`);
      expect(titlesIn(label)).toEqual([]);
    }
  });
});

describe("MoSCoW: adding scope items", () => {
  it("needs a title", () => {
    render(<MoscowClient />);
    add();
    type("Scope item", "   ");
    add();
    expect(moscowRows()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("adds a trimmed item to Must have by default and clears the title", () => {
    render(<MoscowClient />);
    type("Scope item", "  Password reset ");
    add();
    const [r] = moscowRows();
    expect(r).toMatchObject({
      framework: "moscow",
      title: "Password reset",
      fields: { bucket: "must" },
      status: "scored",
    });
    expect(history.log).toHaveBeenCalledWith("item_added", {
      title: "Password reset",
      bucket: "must",
    });
    expect(titlesIn("Must have")).toEqual(["Password reset"]);
    expect(screen.getByText("Buckets (1 items)")).toBeInTheDocument();
    expect(screen.getByLabelText("Scope item")).toHaveValue("");
  });

  it("adds to the chosen bucket and keeps it for the next item", () => {
    render(<MoscowClient />);
    choose("Bucket", "Could have");
    type("Scope item", "Dark mode");
    add();
    type("Scope item", "Emoji reactions");
    add();
    expect(titlesIn("Could have")).toEqual(["Dark mode", "Emoji reactions"]);
    expect(screen.getByRole("combobox", { name: "Bucket" })).toHaveTextContent("Could have");
  });

  it("caps a very long title at 200 characters", () => {
    render(<MoscowClient />);
    type("Scope item", "x".repeat(300));
    add();
    expect(moscowRows()[0].title).toHaveLength(200);
  });
});

describe("MoSCoW: the buckets", () => {
  it("groups MoSCoW items by bucket and ignores other frameworks", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("m1", "Login", "must"),
        row("m2", "SSO", "should"),
        row("m3", "Themes", "could"),
        row("m4", "Voice control", "wont"),
        row("m5", "Audit log", "must"),
        row("k1", "Kano row", "must", "kano"),
      ],
    });
    render(<MoscowClient />);
    expect(screen.getByText("Buckets (5 items)")).toBeInTheDocument();
    expect(titlesIn("Must have")).toEqual(["Login", "Audit log"]);
    expect(titlesIn("Should have")).toEqual(["SSO"]);
    expect(titlesIn("Could have")).toEqual(["Themes"]);
    expect(titlesIn("Won't have (this time)")).toEqual(["Voice control"]);
    expect(screen.queryByText("Kano row")).toBeNull();
  });

  it("moves an item to another bucket from its menu", () => {
    useWorkspaceStore.setState({ prioritizations: [row("m1", "Themes", "could")] });
    render(<MoscowClient />);
    choose("Bucket for Themes", "Won't have (this time)");
    const [r] = moscowRows();
    expect(r.fields?.bucket).toBe("wont");
    expect(r.updatedAt).not.toBe("2026-10-01T09:00:00.000Z");
    expect(history.log).toHaveBeenCalledWith("bucket_changed", { id: "m1", bucket: "wont" });
    expect(titlesIn("Could have")).toEqual([]);
    expect(titlesIn("Won't have (this time)")).toEqual(["Themes"]);
  });

  it("removes only the item whose bin was clicked", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("m1", "Login", "must"),
        row("m2", "SSO", "should"),
        row("k1", "Kano row", "must", "kano"),
      ],
    });
    render(<MoscowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Login" }));
    expect(all().map((x) => x.id)).toEqual(["m2", "k1"]);
    expect(history.log).toHaveBeenCalledWith("item_removed", { id: "m1" });
  });

  // Bug: an item with an unknown bucket was listed under Must have, but its
  // own bucket menu showed nothing selected.
  it("files an unknown bucket under Must have and says so in its menu", () => {
    useWorkspaceStore.setState({ prioritizations: [row("m1", "Legacy item", "essential")] });
    render(<MoscowClient />);
    expect(titlesIn("Must have")).toEqual(["Legacy item"]);
    expect(screen.getByRole("combobox", { name: "Bucket for Legacy item" })).toHaveTextContent(
      "Must have"
    );
  });

  it("exports one CSV row per MoSCoW item", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("m1", "Login", "must"),
        row("m2", "SSO", "should"),
        row("k1", "Kano row", "must", "kano"),
      ],
    });
    render(<MoscowClient />);
    expect(exported.csv).toEqual({
      headers: ["Bucket", "Title"],
      rows: [
        ["must", "Login"],
        ["should", "SSO"],
      ],
    });
  });
});
