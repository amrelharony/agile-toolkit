import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * MoSCoW on the method-tool shell (Phase 7): no default bucket (required to
 * save; legacy rows under "Not sorted yet"), the Must budget bar (Won't
 * left out, from three sized items, a linked item's job size first), Move
 * and rename written through to the backlog item, Undo, the example, the
 * Markdown and the page and the agent reading the same budget.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" as string | undefined }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { markdown?: string }) => {
    exported.markdown = p.markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { MoscowClient } from "@/app/(tools)/moscow/moscow-client";
import { buildExample } from "@/app/(tools)/moscow/example";
import { toMarkdown } from "@/app/(tools)/moscow/markdown";
import { moscowVerdict } from "@/app/(tools)/moscow/verdict";
import { budgetOf } from "@/app/(tools)/moscow/budget";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { mustBudget } from "@/lib/prioritization/methods/moscow";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/moscow";

const TITLE = /Scope item/;
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === "moscow");
const stored = (id: string) => rows().find((r) => r.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const group = (label: string) => screen.getByRole("region", { name: label });

const row = (
  id: string,
  title: string,
  fields: Record<string, number | string>,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "moscow",
  title,
  fields,
  status: "scored",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});

async function moveTo(title: string, bucket: RegExp, verb = "Move") {
  fireEvent.pointerDown(screen.getByRole("button", { name: `${verb} ${title}` }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: bucket }));
}

beforeEach(() => {
  toastSpy.mockReset();
  exported.markdown = "";
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("MoSCoW bucket", () => {
  it("starts with no bucket picked and won't save without one", () => {
    render(<MoscowClient />);
    const buckets = within(screen.getByRole("radiogroup", { name: "Bucket" })).getAllByRole(
      "radio"
    );
    expect(buckets.map((b) => b.textContent)).toEqual([
      "Must have",
      "Should have",
      "Could have",
      "Won't have (this time)",
    ]);
    expect(buckets.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter a title.",
      "Pick a bucket.",
    ]);
    fireEvent.change(screen.getByLabelText(TITLE), { target: { value: "Guest checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(rows()).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: "Should have" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    // The registry's priority is stored, as the agent's rows have it.
    expect(rows()[0]).toMatchObject({
      title: "Guest checkout",
      fields: { bucket: "should" },
      score: 3,
      status: "scored",
    });
    expect(within(group("Should have")).getByText("Guest checkout")).toBeInTheDocument();
  });

  it("lists a legacy row with no or an unknown bucket under Not sorted yet, never Must", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        row("x", "Mystery", { bucket: "critical" }, { score: undefined }),
        row("y", "Blank", {}, { score: undefined }),
      ],
    });
    render(<MoscowClient />);
    expect(within(group("Must have")).queryByText("Mystery")).toBeNull();
    expect(within(group("Not sorted yet")).getByText("Mystery")).toBeInTheDocument();
    expect(within(group("Not sorted yet")).getByText("Blank")).toBeInTheDocument();
    expect(screen.getByText("2 items: 2 not sorted yet.")).toBeInTheDocument();

    await moveTo("Mystery", /^Could have/, "Sort");
    expect(stored("x")).toMatchObject({ fields: { bucket: "could" }, score: 2 });
    expect(within(group("Could have")).getByText("Mystery")).toBeInTheDocument();
    // The moved row's menu button keeps the focus in its new place.
    expect(screen.getByRole("button", { name: "Move Mystery" })).toHaveFocus();
  });
});

describe("MoSCoW Must budget", () => {
  const sized = (id: string, bucket: string, effort?: number) =>
    row(id, `Item ${id}`, effort === undefined ? { bucket } : { bucket, effort });

  it("leaves Won't out, counts unsized items and waits for three sized ones", () => {
    const b = (list: PrioritizationItem[]) => budgetOf(rankMethodRows("moscow", list), []);
    expect(b([sized("a", "must", 3), sized("b", "should", 2)])).toMatchObject({
      share: null,
      sized: 2,
    });
    expect(
      b([
        sized("a", "must", 6),
        sized("b", "should", 2),
        sized("c", "could", 2),
        sized("d", "wont", 50),
        sized("e", "should"),
      ])
    ).toMatchObject({ share: 0.6, over: false, sized: 3, unsized: 1, plannedEffort: 10 });
    expect(
      b([sized("a", "must", 7), sized("b", "should", 2), sized("c", "could", 1)])
    ).toMatchObject({ share: 0.7, over: true, excess: 1 });
    // Zero effort everywhere: no share to show, not 0%.
    expect(
      mustBudget([
        { bucket: "must", effort: 0 },
        { bucket: "should", effort: 0 },
        { bucket: "could", effort: 0 },
      ]).share
    ).toBeNull();
  });

  it("shows Not enough data below three sized items, then the bar and its limit", () => {
    useWorkspaceStore.setState({
      prioritizations: [sized("a", "must", 3), sized("b", "should", 2)],
    });
    render(<MoscowClient />);
    expect(
      screen.getByText(
        "Size 1 more planned item with an effort to see how much of the plan the Musts take."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();

    act(() => state().upsertPrioritization(sized("c", "could", 5)));
    const meter = screen.getByRole("meter", { name: "Musts' share of the planned effort" });
    expect(meter).toHaveAttribute("aria-valuenow", "30");
    expect(
      screen.getByText(
        "3 items: 1 Must, 1 Should and 1 Could. The Must takes 30% of the planned effort, inside the limit of about 60%."
      )
    ).toBeInTheDocument();
  });

  it("takes a linked item's job size over the row's effort", () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Card payments",
      moscow: "must",
      jobSize: 13,
      updatedAt: "2026-10-20T09:00:00.000Z",
    };
    const list = [
      row("l", "Card payments", { bucket: "should", effort: 1 }, { backlogItemId: "b1" }),
      sized("b", "should", 4),
      sized("c", "could", 3),
    ];
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: list });
    render(<MoscowClient />);
    // The bucket and the effort both come from the item: 13 of 20 = 65%.
    expect(within(group("Must have")).getByText("Card payments")).toBeInTheDocument();
    expect(within(group("Must have")).getByText("· backlog job size")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "65");
    expect(
      screen.getByText("Move about 1 point of Musts down to Should or Could.")
    ).toBeInTheDocument();
  });
});

describe("MoSCoW live binding", () => {
  const item: BacklogItem = {
    id: "b1",
    name: "Saved addresses",
    moscow: "should",
    updatedAt: "2026-10-20T09:00:00.000Z",
  };
  const linked = row("l", "Saved addresses", { bucket: "must" }, { backlogItemId: "b1" });

  it("moves a linked row through its item, with Undo, and a hub change moves it back", async () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<MoscowClient />);
    // The item owns the bucket: the row's stale "must" isn't shown.
    expect(within(group("Should have")).getByText("Saved addresses")).toBeInTheDocument();

    await moveTo("Saved addresses", /^Could have/);
    expect(storedItem("b1")?.moscow).toBe("could");
    expect(within(group("Could have")).getByText("Saved addresses")).toBeInTheDocument();
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Updated “Saved addresses” in the backlog");
    act(() => opts.action.onClick());
    expect(storedItem("b1")?.moscow).toBe("should");

    act(() => state().upsertBacklogItem({ ...storedItem("b1")!, moscow: "wont" }));
    expect(
      within(group("Won't have (this time)")).getByText("Saved addresses")
    ).toBeInTheDocument();
  });

  it("renames the item with the row", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<MoscowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Saved addresses" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.change(within(editor).getByLabelText(TITLE), {
      target: { value: "Saved delivery addresses" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored("l")?.title).toBe("Saved delivery addresses");
    expect(storedItem("b1")?.name).toBe("Saved delivery addresses");
  });

  it("deletes with Undo", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Gift wrap", { bucket: "could" })] });
    render(<MoscowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Gift wrap" }));
    expect(rows()).toEqual([]);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Deleted “Gift wrap”");
    act(() => opts.action.onClick());
    expect(rows().map((r) => r.id)).toEqual(["a"]);
  });
});

describe("MoSCoW example and export", () => {
  it("loads an over-budget release from the empty state and clears it", () => {
    render(<MoscowClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(rows()).toHaveLength(10);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "10 items: 4 Must, 3 Should, 2 Could and 1 Won't. The 4 Musts take 69% of the planned effort, over the limit of about 60%. Move about 2 points of Musts down to Should or Could."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/1 planned item has no effort/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(rows()).toEqual([]);
  });

  it("exports the buckets, the budget and the verdict", () => {
    const md = toMarkdown(rankMethodRows("moscow", buildExample()), [], new Date(2026, 9, 18));
    expect(md).toContain("# MoSCoW — 18 Oct 2026");
    expect(md).toContain("## Must have (4)");
    expect(md).toContain("- Card payments through the new provider (8 points)");
    expect(md).toContain("- Apple Pay\n");
    expect(md).toContain("## Won't have (this time) (1)");
    expect(md).toContain("Musts: 69% of the planned effort (18 of 26 points; limit about 60%).");
    expect(md).toContain("**10 items: 4 Must, 3 Should, 2 Could and 1 Won't.");
    expect(moscowVerdict([], [])).toBe("Nothing sorted yet.");
  });
});

describe("MoSCoW page and agent agree", () => {
  it("list_items has the page's buckets and Must budget", async () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Linked",
      moscow: "must",
      jobSize: 8,
      updatedAt: "2026-10-20T09:00:00.000Z",
    };
    const list = [
      row("l", "Linked", { bucket: "could" }, { backlogItemId: "b1" }),
      row("s", "Should", { bucket: "should", effort: 3 }),
      row("c", "Could", { bucket: "could", effort: 2 }),
      row("w", "Wont", { bucket: "wont", effort: 40 }),
      row("u", "Unsorted", { bucket: "nope", effort: 5 }),
    ];
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: list });
    const listed = (await registry
      .get("tool.moscow.list_items")!
      .handler({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
      must: { id: string }[];
      unsorted: { id: string }[];
      budget: Record<string, unknown>;
    };
    const page = budgetOf(rankMethodRows("moscow", list, [item]), [item]);
    expect(listed.must.map((r) => r.id)).toEqual(["l"]);
    expect(listed.unsorted.map((r) => r.id)).toEqual(["u"]);
    expect(listed.budget).toMatchObject({ ...page, limit: 0.6 });
    expect(page).toMatchObject({ mustEffort: 8, plannedEffort: 13, sized: 3 });
  });
});
