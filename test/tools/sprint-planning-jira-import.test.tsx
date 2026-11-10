import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { ALL_FIELDS_EXPORT, CURRENT_FIELDS_EXPORT, SEMICOLON_EXPORT } from "../jira/fixtures";

/**
 * "Import from Jira (CSV)" in Sprint Planning: a Jira Cloud CSV export,
 * pasted or uploaded, previewed (the columns found and what each becomes,
 * the ones left out, the rows it can't import), imported as backlog stories
 * with one Undo; importing it again changes points only, matched by ticket
 * key; an import that would fill the browser's storage is refused, with
 * what to do. The exports are written from Atlassian's documented format
 * (test/jira/fixtures.ts), not from a live site.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    dismiss: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "test",
  }),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/sprint-planning",
}));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return { useCeremonyCadence: () => [DEFAULT_CADENCE, () => {}] };
});
// What the browser's storage holds, when a test sets it (null: measured as it is).
const storage = vi.hoisted(() => ({ used: null as number | null }));
vi.mock("@/lib/stores/storage-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/storage-room")>();
  return {
    ...actual,
    storageInUse: (state: object) => storage.used ?? actual.storageInUse(state),
  };
});

import { SprintPlanning } from "@/app/(tools)/sprint-planning/planning";
import {
  createExampleStore,
  exampleWriter,
  liveWriter,
} from "@/app/(tools)/sprint-planning/writer";
import { STORAGE_QUOTA_BYTES } from "@/lib/stores/storage-room";

const S2: Sprint = {
  id: "s2",
  name: "Sprint 2",
  startDate: "2026-10-05",
  endDate: "2026-10-19",
  pointsPlanned: 0,
  status: "planned",
};

const STORIES: Story[] = [
  { id: "in-1", title: "Receipts", status: "todo", sprintId: "s2", points: 2 },
  { id: "b1", title: "Apple Pay", status: "backlog", points: 13 },
];

const state = () => useWorkspaceStore.getState();
const story = (id: string) => state().stories.find((s) => s.id === id);
const byKey = (key: string) => state().stories.find((s) => s.ticketKey === key);
const ids = () => state().stories.map((s) => s.id);
const renderPlanning = () =>
  render(
    <TooltipProvider>
      <SprintPlanning />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const openButton = () => screen.getByRole("button", { name: "Import from Jira (CSV)" });
const panel = () => screen.getByRole("region", { name: "Import from Jira (CSV)" });
const open = () => fireEvent.click(openButton());
const paste = (text: string) =>
  fireEvent.change(within(panel()).getByLabelText("Or paste the CSV"), { target: { value: text } });
const typeSite = (site: string) => {
  const field = within(panel()).getByLabelText("Jira site address (optional)");
  fireEvent.change(field, { target: { value: site } });
  fireEvent.blur(field);
};
const summary = () => within(panel()).getByRole("status");

beforeEach(() => {
  toastSpy.mockClear();
  logs.length = 0;
  storage.used = null;
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [S2],
    sprintSeries: [],
    stories: STORIES.map((s) => ({ ...s })),
    backlogItems: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
    whiteboardObjects: [],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], stories: [], backlogItems: [], capacityPlans: [] });
});

describe("importing a Jira export", () => {
  it("previews the columns and rows, then adds backlog stories with one Undo", () => {
    renderPlanning();
    const before = ids();
    open();
    expect(openButton()).toHaveAttribute("aria-expanded", "true");
    expect(within(panel()).getByLabelText("CSV file")).toHaveFocus();
    expect(panel()).toHaveTextContent("Jira Cloud CSV export");
    expect(panel()).toHaveTextContent("Files from other trackers may work, untested.");
    paste(ALL_FIELDS_EXPORT);
    expect(summary()).toHaveTextContent("4 stories to add to the backlog.");
    const columns = within(panel()).getByRole("list", { name: "Columns found" });
    expect(
      within(columns)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      "Issue key: the ticket key. Add your site address below for a link to the issue.",
      "Summary: the title",
      "Custom field (Story point estimate), Custom field (Story Points): the points, from the first one filled in on each row",
      "Assignee: the owner",
      "Description: the notes, its first 500 characters",
      "Status: not used, since every story lands in the backlog",
      "Priority: not used, since the backlog keeps its own order",
      "Labels: not used",
      "Due date: not used",
    ]);
    expect(within(panel()).getByText("6 other columns, ignored")).toBeInTheDocument();
    expect(
      within(panel()).getByText(
        "Issue id, Issue Type, Project key, Reporter, Created, Sprint (2 columns)"
      )
    ).toBeInTheDocument();

    typeSite("your-team.atlassian.net");
    expect(within(columns).getAllByRole("listitem")[0]).toHaveTextContent(
      "Issue key: the ticket key, and the link to the issue"
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 4 stories" }));

    const added = state().stories.slice(before.length);
    expect(added.map((s) => [s.title, s.status, s.sprintId, s.ticketKey, s.points])).toEqual([
      ["Pay with a saved card", "backlog", undefined, "PAY-12", 5],
      ["Remove a saved card", "backlog", undefined, "PAY-13", 3],
      ['Fraud "velocity" checks', "backlog", undefined, "PAY-14", 2.5],
      ["Card nicknames", "backlog", undefined, "PAY-15", undefined],
    ]);
    expect(byKey("PAY-12")).toMatchObject({
      owner: "Sam Lee",
      link: "https://your-team.atlassian.net/browse/PAY-12",
      notes:
        "As a returning customer, I want to pay with a saved card.\n\nThe card shows its last four digits.",
      sourceRef: { tool: "jira", id: "PAY-12" },
    });
    expect(lastToast()[0]).toBe("Added 4 stories to the backlog from the Jira CSV");
    expect(logs.at(-1)).toEqual({
      action: "jira_imported",
      payload: { sprintId: "s2", added: 4, updated: 0 },
    });
    // The panel closes, focus goes back to its button, and the stories are in the backlog.
    expect(screen.queryByRole("region", { name: "Import from Jira (CSV)" })).toBeNull();
    expect(openButton()).toHaveFocus();
    const backlog = screen.getByRole("list", { name: "Backlog" });
    expect(within(backlog).getByText("Card nicknames")).toBeInTheDocument();
    expect(within(backlog).getByRole("link", { name: /PAY-12/ })).toHaveAttribute(
      "href",
      "https://your-team.atlassian.net/browse/PAY-12"
    );

    undoLast();
    expect(ids()).toEqual(before);
  });

  it("importing the same export again changes points only, and Undo puts them back", () => {
    renderPlanning();
    open();
    paste(ALL_FIELDS_EXPORT);
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 4 stories" }));
    const pay12 = byKey("PAY-12")!;
    // Planned and renamed here since; the story keeps all that.
    useWorkspaceStore.setState({
      stories: state().stories.map((s) =>
        s.id === pay12.id ? { ...s, title: "Saved cards", sprintId: "s2", status: "todo" } : s
      ),
    });
    const count = ids().length;

    open();
    paste(ALL_FIELDS_EXPORT.replace(',"Short, with a comma",,3,', ',"Short, with a comma",,8,'));
    expect(summary()).toHaveTextContent(
      "No new stories. Points change on 1 story already here. 3 stories already here stay as they are."
    );
    fireEvent.click(within(panel()).getByText("Already here, matched by ticket key"));
    expect(
      within(panel()).getByText("Line 5: PAY-13 “Remove a saved card”: 3 to 8 points.")
    ).toBeInTheDocument();
    expect(
      within(panel()).getByText("Line 2: PAY-12 “Saved cards”, same points.")
    ).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Update points on 1 story" }));

    expect(ids()).toHaveLength(count);
    expect(byKey("PAY-13")?.points).toBe(8);
    expect(story(pay12.id)).toMatchObject({ title: "Saved cards", sprintId: "s2", points: 5 });
    expect(lastToast()[0]).toBe("Updated points on 1 story from the Jira CSV");
    expect(logs.at(-1)?.payload).toEqual({ sprintId: "s2", added: 0, updated: 1 });

    undoLast();
    expect(byKey("PAY-13")?.points).toBe(3);
    expect(ids()).toHaveLength(count);
  });

  it("fills in the site an earlier import linked to", () => {
    useWorkspaceStore.setState({
      stories: [
        ...STORIES,
        {
          id: "j1",
          title: "Old",
          status: "backlog",
          ticketKey: "PAY-1",
          link: "https://your-team.atlassian.net/browse/PAY-1",
        },
      ],
    });
    renderPlanning();
    open();
    expect(within(panel()).getByLabelText("Jira site address (optional)")).toHaveValue(
      "your-team.atlassian.net"
    );
    paste(CURRENT_FIELDS_EXPORT);
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 2 stories" }));
    expect(byKey("PAY-16")?.link).toBe("https://your-team.atlassian.net/browse/PAY-16");
  });

  it("reads an uploaded file, semicolons and all", async () => {
    renderPlanning();
    open();
    const file = new File([SEMICOLON_EXPORT], "pay.csv", { type: "text/csv" });
    fireEvent.change(within(panel()).getByLabelText("CSV file"), { target: { files: [file] } });
    await vi.waitFor(() => expect(summary()).toHaveTextContent("2 stories to add to the backlog."));
    expect(
      within(panel()).getByText("Reading pay.csv. Paste below to use that instead.")
    ).toBeInTheDocument();
    // The file isn't shown in the box.
    expect(within(panel()).getByLabelText("Or paste the CSV")).toHaveValue("");
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 2 stories" }));
    expect(byKey("PAY-20")).toMatchObject({ title: "Gift cards", points: 2.5, owner: "Sam Lee" });
    expect(byKey("PAY-21")?.title).toBe("Refunds; partial");
  });

  it("refuses a file over 5 MB before reading it", () => {
    renderPlanning();
    open();
    const big = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(within(panel()).getByLabelText("CSV file"), { target: { files: [big] } });
    expect(
      within(panel()).getByText(
        "That file is over 5 MB. Export fewer issues at a time, such as one project or one sprint."
      )
    ).toBeInTheDocument();
  });
});

describe("what the import refuses", () => {
  it("lists the rows it can't import, and imports the rest", () => {
    renderPlanning();
    open();
    paste("Issue key,Summary,Story Points\n,No key,1\nA-2,Two,lots\nA-3,Three,3");
    expect(summary()).toHaveTextContent("1 story to add to the backlog. 2 rows can't be imported.");
    fireEvent.click(within(panel()).getByText("Rows that can't be imported"));
    expect(within(panel()).getByText("Line 2: no issue key.")).toBeInTheDocument();
    expect(
      within(panel()).getByText("Line 3: the story points “lots” aren't a number, 0 or more.")
    ).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 1 story" }));
    expect(byKey("A-3")?.points).toBe(3);
    expect(byKey("A-2")).toBeUndefined();
  });

  it("says why a file can't be read, and saves nothing", () => {
    renderPlanning();
    const before = ids();
    open();
    fireEvent.click(within(panel()).getByRole("button", { name: "Import" }));
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Choose a file or paste the CSV first."
    );
    paste("Summary,Status\nOne,To Do");
    expect(summary()).toHaveTextContent(/^No issue key column found\./);
    fireEvent.click(within(panel()).getByRole("button", { name: "Import" }));
    paste("Issue key,Summary\nA-1,");
    fireEvent.click(within(panel()).getByRole("button", { name: "Import" }));
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "No row adds a story or changes points."
    );
    expect(ids()).toEqual(before);
    fireEvent.click(within(panel()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Import from Jira (CSV)" })).toBeNull();
    expect(openButton()).toHaveFocus();
  });

  it("takes only an https site address", () => {
    renderPlanning();
    const before = ids();
    open();
    paste(CURRENT_FIELDS_EXPORT);
    typeSite("http://your-team.atlassian.net");
    expect(
      within(panel()).getByText("Use the site's https address, such as your-team.atlassian.net.")
    ).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 2 stories" }));
    expect(ids()).toEqual(before);
  });

  it("reads the first 1,000 rows and says how many were left out", () => {
    renderPlanning();
    open();
    const rows = Array.from({ length: 1003 }, (_, i) => `A-${i + 1},Story ${i + 1}`);
    paste(["Issue key,Summary", ...rows].join("\n"));
    expect(summary()).toHaveTextContent("1000 stories to add to the backlog.");
    expect(
      within(panel()).getByText(
        "Only the first 1,000 rows are read; 3 rows more were left out. Import the rest as another file."
      )
    ).toBeInTheDocument();
  });

  it("refuses an import that would fill this browser's storage, and says what to do", () => {
    // Just under the 90% line: the four stories take it over.
    storage.used = Math.round(STORAGE_QUOTA_BYTES * 0.9) - 100;
    renderPlanning();
    const before = ids();
    open();
    paste(ALL_FIELDS_EXPORT);
    expect(
      within(panel()).getByText(/^These stories would fill 90% of this browser's storage/)
    ).toHaveTextContent(
      "Import fewer rows at a time, such as one sprint's issues. Or download a backup from Your data, then delete work you no longer need."
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Import 4 stories" }));
    expect(ids()).toEqual(before);
  });

  it("still updates points when storage is nearly full, since that adds no stories", () => {
    useWorkspaceStore.setState({
      stories: [...STORIES, { id: "p13", title: "Remove", status: "backlog", ticketKey: "PAY-13" }],
    });
    storage.used = Math.round(STORAGE_QUOTA_BYTES * 0.95);
    renderPlanning();
    open();
    paste(
      ALL_FIELDS_EXPORT.split("\r\n")
        .filter((line, i) => i === 0 || line.includes("PAY-13"))
        .join("\r\n")
    );
    expect(summary()).toHaveTextContent("No new stories. Points change on 1 story already here.");
    expect(within(panel()).queryByText(/of this browser's storage/)).toBeNull();
    fireEvent.click(within(panel()).getByRole("button", { name: "Update points on 1 story" }));
    expect(story("p13")?.points).toBe(3);
  });
});

describe("the writers' storage reading", () => {
  it("the live writer measures this browser; the example keeps nothing in it", () => {
    expect(typeof liveWriter.storageUsed()).toBe("number");
    const example = exampleWriter(createExampleStore({ sprints: [S2], stories: [] }));
    expect(example.storageUsed()).toBeNull();
  });
});
