import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Post-mortem core: the local-date helpers, creating / deleting post-mortems,
 * status changes and publishedAt, the KPI tiles, summary, contributing
 * factors, timeline, action items (done toggle, text / owner / due / status
 * edits, overdue), the time-to-publish survival panel and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { PostMortemClient } from "@/app/(tools)/post-mortem/post-mortem-client";
import {
  insertByEventTime,
  isOverdue,
  isThisQuarter,
  sortByEventTime,
  todayIso,
} from "@/app/(tools)/post-mortem/helpers";
import type { ActionItem, PostMortem } from "@/app/(tools)/post-mortem/types";

const PM_ID = "postMortem:current";
// Monday 19 Oct 2026, 12:00 local (Q4).
const NOW = new Date(2026, 9, 19, 12, 0);

const pm = (id: string, title: string, extra: Partial<PostMortem> = {}): PostMortem => ({
  id,
  title,
  incidentDate: "2026-10-18",
  status: "draft",
  contributingFactors: [],
  timeline: [],
  actions: [],
  ...extra,
});

const action = (id: string, text: string, extra: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  status: "open",
  ...extra,
});

function seed(postmortems: PostMortem[]) {
  useWorkspaceStore.setState({ postMortemLogs: [{ id: PM_ID, postmortems }] });
}

const pms = () =>
  (useWorkspaceStore.getState().postMortemLogs ?? []).find((d) => d.id === PM_ID)?.postmortems ??
  [];

/** The value of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  return (tile.parentElement!.nextElementSibling as HTMLElement).textContent;
};

/** The editor card for one post-mortem (walks up from its Delete button). */
const editor = (title: string) => {
  let el: HTMLElement | null = screen.getByRole("button", { name: `Delete ${title}` });
  while (el && !el.textContent?.includes("Contributing factors")) el = el.parentElement;
  return within(el as HTMLElement);
};

function choose(combobox: HTMLElement, option: string) {
  fireEvent.pointerDown(combobox, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  useWorkspaceStore.setState({ postMortemLogs: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("post-mortem date helpers", () => {
  it("todayIso is the local calendar day, even just after local midnight", () => {
    vi.setSystemTime(new Date(2026, 9, 19, 0, 15));
    expect(todayIso()).toBe("2026-10-19");
    vi.setSystemTime(new Date(2026, 9, 18, 23, 45));
    expect(todayIso()).toBe("2026-10-18");
  });

  it("isThisQuarter compares local calendar quarters of the current year", () => {
    expect(isThisQuarter("2026-10-01")).toBe(true);
    expect(isThisQuarter("2026-12-31")).toBe(true);
    expect(isThisQuarter("2026-10-01T23:00:00Z")).toBe(true);
    expect(isThisQuarter("2026-09-30")).toBe(false);
    expect(isThisQuarter("2025-11-15")).toBe(false);
    expect(isThisQuarter("")).toBe(false);
    expect(isThisQuarter("next week")).toBe(false);
  });

  it("isOverdue is a not-done action due before today", () => {
    expect(isOverdue(action("a", "x", { dueDate: "2026-10-18" }))).toBe(true);
    expect(isOverdue(action("a", "x", { dueDate: "2026-10-19" }))).toBe(false);
    expect(isOverdue(action("a", "x", { dueDate: "2026-10-18", status: "done" }))).toBe(false);
    expect(isOverdue(action("a", "x", { dueDate: "2026-10-18", status: "in_progress" }))).toBe(
      true
    );
    expect(isOverdue(action("a", "x"))).toBe(false);
  });

  it("orders unparseable timeline stamps first without mutating the input", () => {
    const tl = [
      { id: "b", ts: "2026-10-18T10:00:00Z" },
      { id: "bad", ts: "whenever" },
    ];
    expect(sortByEventTime(tl).map((e) => e.id)).toEqual(["bad", "b"]);
    expect(insertByEventTime(tl, { id: "c", ts: "2026-10-18T09:00:00Z" }).map((e) => e.id)).toEqual(
      ["c", "b", "bad"]
    );
    expect(insertByEventTime([], { id: "only", ts: "x" }).map((e) => e.id)).toEqual(["only"]);
    expect(tl.map((e) => e.id)).toEqual(["b", "bad"]);
  });
});

describe("Post-mortem — empty state", () => {
  it("shows the empty message and zeroed KPIs", () => {
    render(<PostMortemClient />);
    expect(screen.getByRole("status")).toHaveTextContent(/No post-mortems yet\./);
    expect(kpi("Drafts")).toBe("0");
    expect(kpi("In review")).toBe("0");
    expect(kpi("Published (qtr)")).toBe("0");
    expect(kpi("Overdue actions")).toBe("0");
    expect(screen.getByLabelText("Incident date")).toHaveValue("2026-10-19");
    expect(screen.queryByText("Time-to-publish survival curve")).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Post-mortem — creating and deleting", () => {
  it("creates a trimmed draft, newest first, stamped now, and resets the form", () => {
    seed([pm("old", "Old one")]);
    render(<PostMortemClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Cache stampede  " } });
    fireEvent.change(screen.getByLabelText("Incident date"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  SEV-2, EU  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create post-mortem/ }));

    expect(pms().map((p) => p.title)).toEqual(["Cache stampede", "Old one"]);
    expect(pms()[0]).toMatchObject({
      incidentDate: "2026-10-10",
      status: "draft",
      description: "SEV-2, EU",
      contributingFactors: [],
      timeline: [],
      actions: [],
      createdAt: NOW.toISOString(),
    });
    expect(pms()[0].publishedAt).toBeUndefined();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Incident date")).toHaveValue("2026-10-19");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
    expect(kpi("Drafts")).toBe("2");
  });

  it("falls back to today when the incident date is cleared", () => {
    render(<PostMortemClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "DB failover" } });
    fireEvent.change(screen.getByLabelText("Incident date"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    expect(pms()[0]).toMatchObject({ title: "DB failover", incidentDate: "2026-10-19" });
    expect(pms()[0].description).toBeUndefined();
  });

  it("ignores a blank title", () => {
    render(<PostMortemClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Create post-mortem/ }));
    expect(useWorkspaceStore.getState().postMortemLogs).toEqual([]);
  });

  it("deletes only the post-mortem whose button was clicked", () => {
    seed([pm("a", "Alpha"), pm("b", "Bravo")]);
    render(<PostMortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Bravo" }));
    expect(pms().map((p) => p.id)).toEqual(["a"]);
  });

  it("shows the incident date, description and action tally on the card", () => {
    seed([
      pm("a", "Alpha", {
        description: "Checkout down 20m",
        actions: [action("x", "One"), action("y", "Two", { status: "done" })],
      }),
    ]);
    render(<PostMortemClient />);
    const card = editor("Alpha");
    expect(card.getByText("2026-10-18")).toBeInTheDocument();
    expect(card.getByText("Checkout down 20m")).toBeInTheDocument();
    expect(card.getByText("2 actions · 1 open")).toBeInTheDocument();
  });
});

describe("Post-mortem — status", () => {
  it("stamps publishedAt on the first publish only", () => {
    seed([pm("a", "Alpha")]);
    render(<PostMortemClient />);
    const status = () => screen.getByRole("combobox", { name: "Status for Alpha" });

    choose(status(), "In review");
    expect(pms()[0].status).toBe("review");
    expect(pms()[0].publishedAt).toBeUndefined();
    expect(kpi("In review")).toBe("1");

    choose(status(), "Published");
    expect(pms()[0]).toMatchObject({ status: "published", publishedAt: NOW.toISOString() });
    expect(kpi("Published (qtr)")).toBe("1");

    vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
    choose(status(), "In review");
    choose(status(), "Published");
    expect(pms()[0].publishedAt).toBe(NOW.toISOString());
  });
});

describe("Post-mortem — KPIs", () => {
  it("counts drafts, reviews, this quarter's published incidents and overdue actions", () => {
    seed([
      pm("d1", "Draft one", {
        actions: [
          action("o1", "Overdue", { dueDate: "2026-10-18" }),
          action("o2", "Due today", { dueDate: "2026-10-19" }),
          action("o3", "Done late", { dueDate: "2026-01-01", status: "done" }),
        ],
      }),
      pm("d2", "Draft two"),
      pm("r1", "Review", { status: "review" }),
      pm("p1", "Published Q4", { status: "published", incidentDate: "2026-10-02" }),
      pm("p2", "Published Q3", {
        status: "published",
        incidentDate: "2026-09-30",
        actions: [action("o4", "Old", { dueDate: "2026-09-01", status: "in_progress" })],
      }),
    ]);
    render(<PostMortemClient />);
    expect(kpi("Drafts")).toBe("2");
    expect(kpi("In review")).toBe("1");
    expect(kpi("Published (qtr)")).toBe("1");
    expect(kpi("Overdue actions")).toBe("2");
  });
});

describe("Post-mortem — summary and contributing factors", () => {
  beforeEach(() => seed([pm("a", "Alpha")]));

  it("saves a trimmed summary on blur and clears it to undefined", () => {
    render(<PostMortemClient />);
    const summary = screen.getByLabelText("Summary");
    fireEvent.change(summary, { target: { value: "  A cache key collided.  " } });
    expect(pms()[0].summary).toBeUndefined();
    fireEvent.blur(summary);
    expect(pms()[0].summary).toBe("A cache key collided.");
    fireEvent.change(summary, { target: { value: "  " } });
    fireEvent.blur(summary);
    expect(pms()[0].summary).toBeUndefined();
  });

  it("adds trimmed factors by button and Enter, ignores blanks and clears the input", () => {
    render(<PostMortemClient />);
    expect(screen.getByText(/Add at least 2-3 factors/)).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "New contributing factor" });

    fireEvent.change(input, { target: { value: "  No backpressure  " } });
    fireEvent.click(screen.getByRole("button", { name: /Factor/ }));
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "Alert threshold too high" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pms()[0].contributingFactors).toEqual(["No backpressure", "Alert threshold too high"]);
    expect(screen.queryByText(/Add at least 2-3 factors/)).toBeNull();
  });

  it("removes the factor whose button was clicked", () => {
    seed([pm("a", "Alpha", { contributingFactors: ["one", "two", "three"] })]);
    render(<PostMortemClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove factor 2" }));
    expect(pms()[0].contributingFactors).toEqual(["one", "three"]);
    expect(screen.getByRole("button", { name: "Remove factor 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove factor 3" })).toBeNull();
  });
});

describe("Post-mortem — timeline", () => {
  it("adds an entry with a default author, ignores blanks and removes by id", () => {
    seed([pm("a", "Alpha")]);
    render(<PostMortemClient />);
    expect(screen.getByText(/Reconstruct the incident timeline/)).toBeInTheDocument();

    const text = screen.getByLabelText("Timeline entry text");
    fireEvent.change(text, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Entry/ }));
    expect(pms()[0].timeline).toEqual([]);

    fireEvent.change(text, { target: { value: "  Paged on-call  " } });
    fireEvent.keyDown(text, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Timeline entry author"), {
      target: { value: " ana " },
    });
    fireEvent.change(text, { target: { value: "Rolled back" } });
    fireEvent.click(screen.getByRole("button", { name: /Entry/ }));

    expect(pms()[0].timeline.map((e) => [e.author, e.text])).toEqual([
      ["anonymous", "Paged on-call"],
      ["ana", "Rolled back"],
    ]);
    expect(screen.getByText("Timeline (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove timeline entry: Paged on-call" }));
    expect(pms()[0].timeline.map((e) => e.text)).toEqual(["Rolled back"]);
  });

  it("falls back to now for an unparseable event time", () => {
    seed([pm("a", "Alpha")]);
    render(<PostMortemClient />);
    fireEvent.change(screen.getByLabelText("Event time"), {
      target: { value: "2026-13-45T99:99" },
    });
    fireEvent.change(screen.getByLabelText("Timeline entry text"), { target: { value: "Odd" } });
    fireEvent.click(screen.getByRole("button", { name: /Entry/ }));
    expect(pms()[0].timeline[0].ts).toBe(NOW.toISOString());
  });
});

describe("Post-mortem — action items", () => {
  it("adds open actions by button and Enter and ignores blanks", () => {
    seed([pm("a", "Alpha")]);
    render(<PostMortemClient />);
    const input = screen.getByRole("textbox", { name: "New action item" });
    fireEvent.change(input, { target: { value: "  Add rate limit  " } });
    fireEvent.click(screen.getByRole("button", { name: /Action$/ }));
    fireEvent.change(input, { target: { value: "Backfill alerts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pms()[0].actions.map((a) => [a.text, a.status])).toEqual([
      ["Add rate limit", "open"],
      ["Backfill alerts", "open"],
    ]);
    expect(input).toHaveValue("");
    expect(screen.getByText("Action items (2)")).toBeInTheDocument();
  });

  it("checks an action done and unchecks it back to in progress", () => {
    seed([pm("a", "Alpha", { actions: [action("x", "Add rate limit")] })]);
    render(<PostMortemClient />);
    const box = screen.getByRole("checkbox", { name: "Toggle done for Add rate limit" });
    fireEvent.click(box);
    expect(pms()[0].actions[0].status).toBe("done");
    expect(screen.getByText("0 open", { exact: false })).toBeInTheDocument();
    fireEvent.click(box);
    expect(pms()[0].actions[0].status).toBe("in_progress");
    expect(screen.getByText("wip")).toBeInTheDocument();
  });

  it("edits text on blur and restores it when blanked", () => {
    seed([pm("a", "Alpha", { actions: [action("x", "Add rate limit")] })]);
    render(<PostMortemClient />);
    const text = screen.getByRole("textbox", { name: "Action text" });
    fireEvent.change(text, { target: { value: "  Add a token bucket  " } });
    fireEvent.blur(text);
    expect(pms()[0].actions[0].text).toBe("Add a token bucket");

    fireEvent.change(text, { target: { value: "   " } });
    fireEvent.blur(text);
    expect(pms()[0].actions[0].text).toBe("Add a token bucket");
    expect(text).toHaveValue("Add a token bucket");
  });

  it("sets and clears owner and due date on blur, and marks an overdue row", () => {
    seed([pm("a", "Alpha", { actions: [action("x", "Add rate limit")] })]);
    render(<PostMortemClient />);
    const owner = screen.getByRole("textbox", { name: "Owner" });
    fireEvent.change(owner, { target: { value: "  @ana " } });
    fireEvent.blur(owner);
    expect(pms()[0].actions[0].owner).toBe("@ana");

    const due = screen.getByLabelText("Due date");
    fireEvent.change(due, { target: { value: "2026-10-18" } });
    fireEvent.blur(due);
    expect(pms()[0].actions[0].dueDate).toBe("2026-10-18");
    expect(kpi("Overdue actions")).toBe("1");
    expect(owner.closest("li")).toHaveClass("border-danger/40");

    fireEvent.change(owner, { target: { value: "" } });
    fireEvent.blur(owner);
    fireEvent.change(due, { target: { value: "" } });
    fireEvent.blur(due);
    expect(pms()[0].actions[0].owner).toBeUndefined();
    expect(pms()[0].actions[0].dueDate).toBeUndefined();
    expect(kpi("Overdue actions")).toBe("0");
  });

  it("changes status from the dropdown and removes the right action", () => {
    seed([pm("a", "Alpha", { actions: [action("x", "First"), action("y", "Second")] })]);
    render(<PostMortemClient />);
    choose(screen.getAllByRole("combobox", { name: "Action status" })[1], "In progress");
    expect(pms()[0].actions.map((a) => a.status)).toEqual(["open", "in_progress"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove action" })[0]);
    expect(pms()[0].actions.map((a) => a.id)).toEqual(["y"]);
  });
});

describe("Post-mortem — time-to-publish survival", () => {
  const published = (id: string, days: number) =>
    pm(id, `P${id}`, {
      status: "published",
      createdAt: new Date(2026, 9, 1, 9).toISOString(),
      publishedAt: new Date(2026, 9, 1 + days, 9).toISOString(),
    });

  it("needs four published post-mortems with a publish time", () => {
    seed([
      published("1", 1),
      published("2", 2),
      published("3", 3),
      pm("legacy", "Legacy", { status: "published" }),
    ]);
    render(<PostMortemClient />);
    expect(screen.queryByText("Time-to-publish survival curve")).toBeNull();
  });

  it("shows the median days to publish over the published set", () => {
    seed([published("1", 1), published("2", 2), published("3", 3), published("4", 4)]);
    render(<PostMortemClient />);
    expect(screen.getByText("Time-to-publish survival curve")).toBeInTheDocument();
    expect(screen.getByText("Median 2d")).toBeInTheDocument();
    expect(
      screen.getByText(/Kaplan-Meier estimate over 4 published post-mortem\s*s/)
    ).toBeInTheDocument();
  });
});

describe("Post-mortem — export", () => {
  it("exports one row per action, or one bare row for a post-mortem without actions", () => {
    seed([
      pm("a", "Alpha", {
        summary: "Cache keys collided",
        description: "SEV-2",
        actions: [
          action("x", "Add rate limit", { owner: "@ana", dueDate: "2026-11-01" }),
          action("y", "Backfill alerts", { status: "done" }),
        ],
      }),
      pm("b", "Bravo", { status: "review", incidentDate: "2026-10-01" }),
    ]);
    render(<PostMortemClient />);
    expect(exported.csv?.headers).toEqual([
      "Post-mortem",
      "Status",
      "Incident date",
      "Summary",
      "Action",
      "Owner",
      "Due",
      "Action status",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "Alpha",
        "draft",
        "2026-10-18",
        "Cache keys collided",
        "Add rate limit",
        "@ana",
        "2026-11-01",
        "open",
        "SEV-2",
      ],
      [
        "Alpha",
        "draft",
        "2026-10-18",
        "Cache keys collided",
        "Backfill alerts",
        "",
        "",
        "done",
        "SEV-2",
      ],
      ["Bravo", "review", "2026-10-01", "", "", "", "", "", ""],
    ]);
  });
});
