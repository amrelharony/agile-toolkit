import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * WSJF on the method-tool shell (Phase 7): column-by-column scoring with
 * title-only features, the relative hint ("at least one 1 per column"),
 * every part on 1-20 with a job-size floor of 1, the live backlog binding,
 * the verdict, the chart, the example and the page and the agent reading
 * the same numbers.
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
// Recharts' ResponsiveContainer needs it; jsdom doesn't ship one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { WsjfClient } from "@/app/(tools)/wsjf/wsjf-client";
import { SETTLE_MS } from "@/app/(tools)/wsjf/column-mode";
import { buildExample } from "@/app/(tools)/wsjf/example";
import { toMarkdown } from "@/app/(tools)/wsjf/markdown";
import { columnsMissingOne, wsjfVerdict } from "@/app/(tools)/wsjf/verdict";
import { rankMethodRows } from "@/lib/prioritization/rank";
import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/wsjf";

const FEATURE = /Feature title/;
const state = () => useWorkspaceStore.getState();
const rows = () => (state().prioritizations ?? []).filter((r) => r.framework === "wsjf");
const stored = (id: string) => rows().find((r) => r.id === id);
const storedItem = (id: string) => (state().backlogItems ?? []).find((b) => b.id === id);
const list = () => screen.getByRole("list", { name: "Features, highest WSJF first" });
const listItems = () => within(list()).getAllByRole("listitem");

type Parts = [number, number, number, number];
const row = (
  id: string,
  title: string,
  parts: Parts | null,
  extra: Partial<PrioritizationItem> = {}
): PrioritizationItem => ({
  id,
  framework: "wsjf",
  title,
  fields: parts
    ? { businessValue: parts[0], timeCriticality: parts[1], rrOe: parts[2], jobSize: parts[3] }
    : {},
  status: parts ? "scored" : "open",
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...extra,
});

const radio = (group: string, option: string, root: HTMLElement = document.body) =>
  within(within(root).getByRole("radiogroup", { name: group })).getByRole("radio", {
    name: option,
  });
const pick = (group: string, option: string, root?: HTMLElement) =>
  fireEvent.click(radio(group, option, root));

beforeEach(() => {
  toastSpy.mockReset();
  exported.markdown = "";
  useWorkspaceStore.setState({ backlogItems: [], prioritizations: [] });
});

describe("WSJF column-by-column scoring", () => {
  it("adds title-only features as Not scored and scores them one column at a time", () => {
    render(<WsjfClient />);
    for (const title of ["Single sign-on", "Dark mode"]) {
      fireEvent.change(screen.getByLabelText(FEATURE), { target: { value: title } });
      fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    }
    expect(rows().map((r) => [r.title, r.status, r.score])).toEqual([
      ["Single sign-on", "open", undefined],
      ["Dark mode", "open", undefined],
    ]);
    expect(listItems()[0]).toHaveTextContent("Not scored");
    expect(
      screen.getByText("None of the 2 features is scored yet: score them by column.")
    ).toBeInTheDocument();

    // Column scoring opens on the first column with blanks.
    expect(screen.getByRole("heading", { name: "Column 1 of 4: Business value" })).toBeVisible();
    pick("Single sign-on", "8");
    pick("Dark mode", "1");
    expect(stored(rows()[0].id)!.fields).toEqual({ businessValue: 8 });

    fireEvent.click(screen.getByRole("button", { name: "Next column" }));
    const heading = screen.getByRole("heading", { name: "Column 2 of 4: Time criticality" });
    expect(heading).toHaveFocus();
    pick("Single sign-on", "5");
    pick("Dark mode", "1");
    fireEvent.click(screen.getByRole("button", { name: "Next column" }));
    pick("Single sign-on", "3");
    pick("Dark mode", "1");
    fireEvent.click(screen.getByRole("button", { name: "Next column" }));
    expect(screen.getByRole("heading", { name: "Column 4 of 4: Job size" })).toBeVisible();
    pick("Single sign-on", "2");
    pick("Dark mode", "1");

    const [sso, dark] = rows();
    expect(sso).toMatchObject({
      status: "scored",
      score: 8,
      fields: { businessValue: 8, timeCriticality: 5, rrOe: 3, jobSize: 2 },
    });
    expect(dark.score).toBe(3);
    // The column list kept the order the features were added in.
    const groups = screen.getAllByRole("radiogroup").map((g) => g.getAttribute("aria-label") ?? "");
    expect(groups.indexOf("Single sign-on")).toBeLessThan(groups.indexOf("Dark mode"));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("heading", { name: /Column 4 of 4/ })).toBeNull();
  });

  it("arrows through the columns without pulling focus out of the group", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", null)] });
    render(<WsjfClient />);
    const bv = radio("Column to score", "BV");
    bv.focus();
    fireEvent.keyDown(bv, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "Column 2 of 4: Time criticality" })).toBeVisible();
    // Focus moved to the next column's radio, not to the heading.
    expect(radio("Column to score", "TC")).toHaveFocus();
    expect(radio("Column to score", "TC")).toHaveAttribute("aria-checked", "true");
    // Previous / Next still take focus to the heading.
    fireEvent.click(screen.getByRole("button", { name: "Next column" }));
    expect(
      screen.getByRole("heading", {
        name: "Column 3 of 4: Risk reduction / opportunity enablement",
      })
    ).toHaveFocus();
  });

  describe("arrow-key picks", () => {
    const saves = () => {
      let n = 0;
      const stop = useWorkspaceStore.subscribe((s, p) => {
        if (s.prioritizations !== p.prioritizations) n += 1;
      });
      return { count: () => n, stop };
    };
    const arrowTo = (title: string, from: string, presses: number) => {
      let at = radio(title, from);
      at.focus();
      for (let i = 0; i < presses; i++) {
        fireEvent.keyDown(at, { key: "ArrowRight" });
        at = document.activeElement as HTMLElement;
      }
      return at;
    };

    it("stage while arrowing and save once on Space or Enter (the radio's click)", () => {
      useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", null)] });
      render(<WsjfClient />);
      const s = saves();
      const at = arrowTo("Alpha", "1", 3);
      // 1 → 2 → 3 → 5: shown as picked, nothing saved yet.
      expect(at).toHaveAccessibleName("5");
      expect(at).toHaveAttribute("aria-checked", "true");
      expect(s.count()).toBe(0);
      expect(stored("a")!.fields).toEqual({});
      fireEvent.click(at);
      expect(s.count()).toBe(1);
      expect(stored("a")!.fields).toEqual({ businessValue: 5 });
      s.stop();
    });

    it("save once when focus leaves the feature's picker", () => {
      useWorkspaceStore.setState({
        prioritizations: [row("a", "Alpha", null), row("b", "Beta", null)],
      });
      render(<WsjfClient />);
      const s = saves();
      arrowTo("Alpha", "1", 4);
      expect(s.count()).toBe(0);
      radio("Beta", "1").focus();
      expect(s.count()).toBe(1);
      expect(stored("a")!.fields).toEqual({ businessValue: 8 });
      expect(stored("b")!.fields).toEqual({});
      s.stop();
    });

    it("save once after a pause, and not at all when arrowed back to the saved value", () => {
      vi.useFakeTimers();
      try {
        useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", [3, 1, 1, 1])] });
        render(<WsjfClient />);
        fireEvent.click(screen.getAllByRole("button", { name: "Score by column" })[0]);
        const s = saves();
        arrowTo("Alpha", "3", 2);
        act(() => vi.advanceTimersByTime(SETTLE_MS - 1));
        expect(s.count()).toBe(0);
        act(() => vi.advanceTimersByTime(1));
        expect(s.count()).toBe(1);
        expect(stored("a")!.fields).toMatchObject({ businessValue: 8 });

        // 8 → 13 → back to 8: nothing to save.
        let at = radio("Alpha", "8");
        at.focus();
        fireEvent.keyDown(at, { key: "ArrowRight" });
        at = document.activeElement as HTMLElement;
        fireEvent.keyDown(at, { key: "ArrowLeft" });
        act(() => vi.advanceTimersByTime(SETTLE_MS));
        expect(s.count()).toBe(1);
        s.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("hands focus to Score by column after Done, and reopens for a feature added later", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", [8, 5, 3, 2])] });
    render(<WsjfClient />);
    // Nothing is blank, so the stepper starts closed.
    expect(screen.queryByRole("heading", { name: /^Column \d of 4/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Score by column" })[0]);
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: "Next column" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByRole("button", { name: "Score by column" })[0]).toHaveFocus();

    fireEvent.change(screen.getByLabelText(FEATURE), { target: { value: "Beta" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    const heading = screen.getByRole("heading", { name: "Column 1 of 4: Business value" });
    expect(heading).toBeVisible();
    // It opens without taking focus from where the user is.
    expect(heading).not.toHaveFocus();
    expect(radio("Beta", "1")).toBeInTheDocument();
  });

  it("clears one cell back to Not scored", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", [8, 5, 3, 2])] });
    render(<WsjfClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Score by column" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Clear Alpha" }));
    expect(stored("a")).toMatchObject({ status: "open", fields: { timeCriticality: 5 } });
    expect(stored("a")!.score).toBeUndefined();
    expect(stored("a")!.fields!.businessValue).toBeUndefined();
  });

  it("sits above the list, with the chart under it", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Alpha", [8, 5, 3, 2]), row("b", "Beta", [1, 1, 1, 1])],
    });
    render(<WsjfClient />);
    const byColumn = screen.getByRole("heading", { level: 2, name: "Score by column" });
    const features = screen.getByRole("heading", { level: 2, name: "Features (2)" });
    const chart = screen.getByRole("heading", { level: 2, name: "Top 10 by WSJF" });
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(byColumn, features)).toBe(true);
    expect(follows(features, chart)).toBe(true);
  });

  it("says a title-only feature waits in Score by column, above the list", async () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", [8, 5, 3, 2])] });
    render(
      <LiveAnnouncerProvider>
        <WsjfClient />
      </LiveAnnouncerProvider>
    );
    fireEvent.change(screen.getByLabelText(FEATURE), { target: { value: "Beta" } });
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "“Beta” waits in Score by column, above the list."
      )
    );
    // And it is above the list, as it says.
    const byColumn = screen.getByRole("heading", { level: 2, name: "Score by column" });
    const features = screen.getByRole("heading", { level: 2, name: "Features (2)" });
    expect(
      byColumn.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("WSJF partial features in the editor", () => {
  const editorOf = () =>
    screen.getByRole("button", { name: "Save" }).closest("form") as HTMLElement;

  it("renames and re-scores a feature column scoring left partial, keeping its other parts", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Alpha", null, { fields: { businessValue: 8, jobSize: 2 } })],
    });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = editorOf();
    fireEvent.change(within(editor).getByLabelText(FEATURE), { target: { value: "Alpha v2" } });
    pick("Time criticality", "3", editor);
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(stored("a")).toMatchObject({
      title: "Alpha v2",
      status: "open",
      fields: { businessValue: 8, timeCriticality: 3, jobSize: 2 },
    });
    expect(stored("a")!.fields).not.toHaveProperty("rrOe");
    expect(screen.getByRole("button", { name: "Edit Alpha v2" })).toHaveFocus();
  });

  it("still asks a partial feature for a title (its blank parts aren't errors)", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Alpha", null, { fields: { businessValue: 8 } })],
    });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = editorOf();
    fireEvent.change(within(editor).getByLabelText(FEATURE), { target: { value: " " } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(
      within(editor)
        .getAllByRole("alert")
        .map((a) => a.textContent)
    ).toEqual(["Enter a title."]);
    expect(stored("a")!.title).toBe("Alpha");
  });

  it("asks a complete feature's editor for every part, as before", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Alpha", [8, 5, 3, 2])] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
    const editor = editorOf();
    fireEvent.click(within(editor).getByRole("button", { name: "Clear Job size" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent("Pick a job size.");
    expect(stored("a")!.fields).toEqual({
      businessValue: 8,
      timeCriticality: 5,
      rrOe: 3,
      jobSize: 2,
    });
  });
});

describe("WSJF relative hint", () => {
  it("fires when a scored column has no 1, opens that column and clears once a 1 is given", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Alpha", [8, 1, 1, 1]), row("b", "Beta", [13, 1, 1, 2])],
    });
    render(<WsjfClient />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(
      "No feature has a 1 for Business value: give the smallest a 1 and size the others against it."
    );
    expect(
      screen.getByText(/^Do first: “Alpha”.*No feature has a 1 for Business value/)
    ).toBeInTheDocument();

    fireEvent.click(within(note).getByRole("button", { name: "Score Business value by column" }));
    expect(screen.getByRole("heading", { name: "Column 1 of 4: Business value" })).toHaveFocus();
    pick("Alpha", "1");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("wraps the long RR/OE hint button instead of widening a phone's page", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Alpha", [1, 1, 8, 1]), row("b", "Beta", [1, 1, 3, 2])],
    });
    render(<WsjfClient />);
    const button = within(screen.getByRole("note")).getByRole("button", {
      name: "Score Risk reduction / opportunity enablement by column",
    });
    expect(button.className).toContain("whitespace-normal");
    expect(button.className).not.toContain("whitespace-nowrap");
    expect(button.className).toContain("max-w-full");
  });

  it("waits for two scored values in a column", () => {
    expect(columnsMissingOne(rankMethodRows("wsjf", [row("a", "A", [8, 5, 3, 2])]))).toEqual([]);
    expect(
      columnsMissingOne(rankMethodRows("wsjf", [row("a", "A", [8, 5, 3, 2]), row("b", "B", null)]))
    ).toEqual([]);
    expect(
      columnsMissingOne(
        rankMethodRows("wsjf", [row("a", "A", [8, 5, 1, 2]), row("b", "B", [3, 1, 2, 1])])
      )
    ).toEqual(["businessValue"]);
  });

  it("never fires on the example: every column has a 1", () => {
    const ranked = rankMethodRows("wsjf", buildExample());
    expect(columnsMissingOne(ranked)).toEqual([]);
    expect(wsjfVerdict(ranked)).toBe(
      "Do first: “Fix card-declined message before the ho…” (WSJF 12.00: cost of delay 24 ÷ job size 2)."
    );
  });
});

describe("WSJF scale and floor", () => {
  it("accepts 13 and 20 in every part (no clamp to 10)", () => {
    render(<WsjfClient />);
    fireEvent.change(screen.getByLabelText(FEATURE), { target: { value: "Rebuild" } });
    pick("Business value", "20");
    pick("Time criticality", "13");
    pick("Risk reduction / opportunity enablement", "20");
    pick("Job size", "20");
    fireEvent.click(screen.getByRole("button", { name: /Add & score/ }));
    expect(rows()[0]).toMatchObject({
      fields: { businessValue: 20, timeCriticality: 13, rrOe: 20, jobSize: 20 },
      score: 53 / 20,
    });
  });

  it("scores a legacy job size below 1 as 1 and a size of 0 as Not scored", () => {
    useWorkspaceStore.setState({
      prioritizations: [row("a", "Half", [3, 2, 1, 0.5]), row("z", "Zero", [3, 2, 1, 0])],
    });
    render(<WsjfClient />);
    expect(
      screen.getByText("Job size 0.5 is below 1, the smallest on the scale: it counts as 1.")
    ).toBeInTheDocument();
    expect(listItems()[0]).toHaveTextContent("6.00");
    expect(listItems()[1]).toHaveTextContent("Not scored");
    // The verdict divides by the size the score used (1), not the stored 0.5.
    expect(
      screen.getByText(/^Do first: “Half” \(WSJF 6\.00: cost of delay 6 ÷ job size 1\)\./)
    ).toBeInTheDocument();
    expect(wsjfVerdict(rankMethodRows("wsjf", [row("a", "Half", [3, 2, 1, 0.5])]))).toBe(
      "Do first: “Half” (WSJF 6.00: cost of delay 6 ÷ job size 1)."
    );
  });

  it("refuses a job size below 1 typed into the editor's Custom only by keeping what is held", () => {
    useWorkspaceStore.setState({ prioritizations: [row("a", "Half", [3, 2, 1, 0.5])] });
    render(<WsjfClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Half" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(within(editor).getByRole("alert")).toHaveTextContent(
      "Job size is at least 1, the smallest on the scale."
    );
    pick("Job size", "1", editor);
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored("a")).toMatchObject({ score: 6, fields: { jobSize: 1 } });
  });
});

describe("WSJF live binding", () => {
  const item: BacklogItem = {
    id: "b1",
    name: "Single sign-on",
    businessValue: 13,
    timeCriticality: 8,
    riskReduction: 3,
    jobSize: 5,
    updatedAt: "2026-10-20T09:00:00.000Z",
  };
  const linked = row("w1", "Single sign-on", [1, 1, 1, 1], { backlogItemId: "b1", score: 3 });

  it("reads through to the item, and a hub edit shows at once", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<WsjfClient />);
    expect(listItems()[0]).toHaveTextContent("4.80");
    act(() => state().upsertBacklogItem({ ...item, jobSize: 2 }));
    expect(listItems()[0]).toHaveTextContent("12.00");
  });

  it("writes a column pick through to the item (risk reduction as riskReduction), with Undo", () => {
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: [linked] });
    render(<WsjfClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Score by column" })[0]);
    fireEvent.click(screen.getByRole("radio", { name: "RR/OE" }));
    pick("Single sign-on", "8");
    expect(storedItem("b1")).toMatchObject({ riskReduction: 8, businessValue: 13 });
    expect(stored("w1")!.fields).toMatchObject({ rrOe: 8, businessValue: 13 });
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Updated “Single sign-on” in the backlog");
    act(() => opts.action.onClick());
    expect(storedItem("b1")?.riskReduction).toBe(3);
  });
});

describe("WSJF page and agent agree", () => {
  it("list_scored has the page's order, scores, ranks and relative hint", async () => {
    const item: BacklogItem = {
      id: "b1",
      name: "Linked",
      businessValue: 20,
      timeCriticality: 13,
      riskReduction: 8,
      jobSize: 3,
      updatedAt: "2026-10-20T09:00:00.000Z",
    };
    const items = [
      row("t", "Title only", null),
      row("a", "Alpha", [8, 5, 3, 2]),
      row("l", "Linked", [1, 1, 1, 20], { backlogItemId: "b1" }),
      row("h", "Half", [3, 2, 1, 0.5]),
    ];
    useWorkspaceStore.setState({ backlogItems: [item], prioritizations: items });
    render(<WsjfClient />);
    const listed = (await registry
      .get("tool.wsjf.list_scored")!
      .handler({}, { userId: "u", source: "agent", squadProfileIds: [] })) as {
      items: { id: string; score: number | null; rank: number | null }[];
      columnsWithoutOne: string[];
    };
    const page = rankMethodRows("wsjf", items, [item]);
    expect(listed.items.map((i) => [i.id, i.score, i.rank])).toEqual(
      page.map((r) => [r.row.id, r.result.score, r.rank])
    );
    expect(listed.items.map((i) => i.id)).toEqual(["l", "a", "h", "t"]);
    expect(listed.columnsWithoutOne).toEqual(columnsMissingOne(page));
    const names = listItems().map((li) =>
      ["Linked", "Alpha", "Half", "Title only"].find((n) => li.textContent?.includes(n))
    );
    expect(names).toEqual(["Linked", "Alpha", "Half", "Title only"]);
  });

  it("exports Not scored rows last with the verdict", () => {
    const md = toMarkdown(
      rankMethodRows("wsjf", [row("t", "Title only", null), row("a", "Alpha", [8, 1, 3, 2])]),
      new Date(2026, 9, 18)
    );
    expect(md).toContain("| 1 | Alpha | 8 | 1 | 3 | 2 | 6.00 |");
    expect(md).toContain("| — | Title only | — | — | — | — | Not scored |");
    expect(md).toContain(
      "**Do first: “Alpha” (WSJF 6.00: cost of delay 12 ÷ job size 2). 1 feature not scored yet: score them by column.**"
    );
  });
});
