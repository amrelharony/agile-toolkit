import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * RFC Tracker: localStorage-backed draft → review → decided pipeline.
 * Covers creating / removing RFCs, status transitions (decidedAt stamping),
 * reviewers, comments, the decision text, the KPI strip, the "Push to
 * Decision Log" hand-off and the CSV export rows.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof exported.csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/utils/toast", () => ({ toast: toasts }));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { RfcTrackerClient } from "@/app/(tools)/rfc-tracker/rfc-tracker-client";

const KEY = "agile-toolkit:rfc-tracker";
const DECISIONS = "agile-toolkit:decision-log";

type Status = "draft" | "in_review" | "decided" | "withdrawn";
interface Rfc {
  id: string;
  title: string;
  author: string;
  status: Status;
  openedAt: string;
  decidedAt?: string;
  decision?: string;
  reviewers: string[];
  comments: { id: string; author: string; ts: string; text: string }[];
  description?: string;
}

const rfc = (id: string, over: Partial<Rfc> = {}): Rfc => ({
  id,
  title: `RFC ${id}`,
  author: "Ana",
  status: "draft",
  openedAt: "2026-10-10",
  reviewers: [],
  comments: [],
  ...over,
});

const seed = (rows: Rfc[]) => localStorage.setItem(KEY, JSON.stringify(rows));
const saved = (): Rfc[] => JSON.parse(localStorage.getItem(KEY) ?? "[]");

function kpi(label: string): string {
  // span.truncate: the StatCard label (a status Select can show the same words).
  const el = screen.getByText(label, { selector: "span.truncate" });
  return el.parentElement!.parentElement!.children[1].textContent ?? "";
}

function chooseStatus(title: string, label: string) {
  const trigger = screen.getByRole("combobox", { name: `Status for ${title}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

function card(title: string): HTMLElement {
  return screen.getByText(title).closest(".space-y-3") as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  history.log.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  exported.csv = undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RFC Tracker: empty state", () => {
  it("shows the empty message and zeroed KPIs", () => {
    render(<RfcTrackerClient />);
    expect(screen.getByText(/No RFCs yet/)).toBeInTheDocument();
    expect(kpi("Drafts")).toBe("0");
    expect(kpi("In review")).toBe("0");
    expect(kpi("Decided this month")).toBe("0");
    expect(kpi("Avg time-to-decide")).toBe("—");
  });
});

describe("RFC Tracker: creating and removing", () => {
  it("opens a trimmed draft RFC dated today, newest first, and resets the form", () => {
    seed([rfc("old", { title: "Older RFC" })]);
    render(<RfcTrackerClient />);
    fireEvent.change(screen.getByLabelText("RFC title"), {
      target: { value: "  Replace polling with SSE  " },
    });
    fireEvent.change(screen.getByLabelText("RFC author"), { target: { value: " Jane " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "  Too slow  " } });
    fireEvent.click(screen.getByRole("button", { name: /New RFC/ }));

    const rows = saved();
    expect(rows.map((r) => r.title)).toEqual(["Replace polling with SSE", "Older RFC"]);
    expect(rows[0]).toMatchObject({
      author: "Jane",
      status: "draft",
      openedAt: "2026-10-18",
      description: "Too slow",
      reviewers: [],
      comments: [],
    });
    expect(screen.getByText(/by Jane · opened 2026-10-18 · day 0/)).toBeInTheDocument();
    expect(kpi("Drafts")).toBe("2");
    expect(history.log).toHaveBeenCalledWith(
      "rfc_added",
      expect.objectContaining({ title: "Replace polling with SSE", author: "Jane" })
    );
    expect(screen.getByLabelText("RFC title")).toHaveValue("");
    expect(screen.getByLabelText("RFC author")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  it("needs both a title and an author", () => {
    render(<RfcTrackerClient />);
    fireEvent.change(screen.getByLabelText("RFC title"), { target: { value: "Title only" } });
    fireEvent.click(screen.getByRole("button", { name: /New RFC/ }));
    fireEvent.change(screen.getByLabelText("RFC title"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("RFC author"), { target: { value: "Jane" } });
    fireEvent.click(screen.getByRole("button", { name: /New RFC/ }));
    expect(saved()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("stores a blank description as undefined", () => {
    render(<RfcTrackerClient />);
    fireEvent.change(screen.getByLabelText("RFC title"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("RFC author"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /New RFC/ }));
    expect(saved()[0].description).toBeUndefined();
  });

  it("removes only the clicked RFC", () => {
    seed([rfc("a", { title: "Keep me" }), rfc("b", { title: "Drop me" })]);
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Drop me" }));
    expect(saved().map((r) => r.id)).toEqual(["a"]);
    expect(history.log).toHaveBeenCalledWith("rfc_removed", { rfcId: "b", title: "Drop me" });
  });

  it("shows the age in local days since it was opened", () => {
    seed([rfc("a", { openedAt: "2026-10-15" }), rfc("b", { title: "Bad", openedAt: "soon" })]);
    render(<RfcTrackerClient />);
    expect(screen.getByText(/opened 2026-10-15 · day 3/)).toBeInTheDocument();
    expect(screen.getByText(/opened soon · day 0/)).toBeInTheDocument();
  });
});

// Bug: the age divided the gap between two local midnights by 24 h and
// floored it; across a spring-forward DST change that gap is 1 h short, so an
// RFC opened three calendar days ago read "day 2".
describe("RFC Tracker: age across a DST change", () => {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });
  beforeEach(() => {
    // US clocks spring forward on 14 Mar 2027.
    vi.setSystemTime(new Date(2027, 2, 15, 10, 0));
  });

  it("counts whole calendar days since the RFC was opened", () => {
    seed([rfc("a", { openedAt: "2027-03-12" })]);
    render(<RfcTrackerClient />);
    expect(screen.getByText(/opened 2027-03-12 · day 3/)).toBeInTheDocument();
  });
});

describe("RFC Tracker: status", () => {
  it("stamps decidedAt the first time an RFC is decided and logs a decision", () => {
    seed([rfc("a", { title: "SSE" })]);
    render(<RfcTrackerClient />);
    chooseStatus("SSE", "Decided");
    expect(saved()[0]).toMatchObject({ status: "decided", decidedAt: "2026-10-18" });
    expect(history.log).toHaveBeenCalledWith("rfc_decided", { rfcId: "a" });
    expect(screen.getByText(/· decided 2026-10-18/)).toBeInTheDocument();
    expect(kpi("Decided this month")).toBe("1");
    expect(screen.getByLabelText("Decision text")).toBeInTheDocument();
  });

  it("keeps the original decidedAt when an RFC is re-opened and decided again", () => {
    seed([rfc("a", { title: "SSE", status: "decided", decidedAt: "2026-10-12" })]);
    render(<RfcTrackerClient />);
    chooseStatus("SSE", "In review");
    expect(saved()[0]).toMatchObject({ status: "in_review", decidedAt: "2026-10-12" });
    expect(screen.queryByLabelText("Decision text")).toBeNull();
    chooseStatus("SSE", "Decided");
    expect(saved()[0].decidedAt).toBe("2026-10-12");
    expect(history.log).not.toHaveBeenCalledWith("rfc_decided", expect.anything());
    expect(history.log).toHaveBeenLastCalledWith("rfc_updated", {
      rfcId: "a",
      fields: ["status"],
    });
  });

  it("counts drafts and in-review RFCs", () => {
    seed([
      rfc("a"),
      rfc("b", { status: "in_review" }),
      rfc("c", { status: "in_review" }),
      rfc("d", { status: "withdrawn" }),
    ]);
    render(<RfcTrackerClient />);
    expect(kpi("Drafts")).toBe("1");
    expect(kpi("In review")).toBe("2");
  });

  it("counts RFCs decided this calendar month only", () => {
    seed([
      rfc("a", { status: "decided", decidedAt: "2026-10-01" }),
      rfc("b", { status: "decided", decidedAt: "2026-09-30" }),
    ]);
    render(<RfcTrackerClient />);
    expect(kpi("Decided this month")).toBe("1");
  });

  // Bug: decidedAt is deliberately kept when a decided RFC is re-opened or
  // withdrawn, but the KPI keyed off the timestamp instead of the status, so
  // RFCs that are no longer decided were still counted as decided.
  it("does not count a re-opened or withdrawn RFC as decided this month", () => {
    seed([
      rfc("a", { status: "in_review", decidedAt: "2026-10-05" }),
      rfc("b", { status: "withdrawn", decidedAt: "2026-10-06" }),
      rfc("c", { status: "decided", decidedAt: "2026-10-07" }),
    ]);
    render(<RfcTrackerClient />);
    expect(kpi("Decided this month")).toBe("1");
  });

  it("averages time-to-decide in days and skips impossible negative spans", () => {
    seed([
      rfc("a", { status: "decided", openedAt: "2026-10-01", decidedAt: "2026-10-11" }),
      rfc("b", { status: "decided", openedAt: "2026-10-10", decidedAt: "2026-10-15" }),
      rfc("c", { status: "decided", openedAt: "2026-10-12", decidedAt: "2026-10-02" }),
    ]);
    render(<RfcTrackerClient />);
    expect(kpi("Avg time-to-decide")).toBe("7.5d");
  });
});

describe("RFC Tracker: reviewers and comments", () => {
  beforeEach(() => seed([rfc("a", { title: "SSE" })]));

  it("adds reviewers by button and Enter, ignoring blanks and case-insensitive duplicates", () => {
    render(<RfcTrackerClient />);
    expect(screen.getByText("None yet")).toBeInTheDocument();
    const input = screen.getByLabelText("Reviewer name");
    fireEvent.change(input, { target: { value: "  Bo  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    fireEvent.change(input, { target: { value: "Cy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "BO" } });
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add reviewer" }));
    expect(saved()[0].reviewers).toEqual(["Bo", "Cy"]);
    expect(input).toHaveValue("   "); // a rejected blank is left for the user to fix
    expect(screen.queryByText("None yet")).toBeNull();
  });

  it("removes a reviewer", () => {
    seed([rfc("a", { title: "SSE", reviewers: ["Bo", "Cy"] })]);
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
    expect(saved()[0].reviewers).toEqual(["Cy"]);
    expect(history.log).toHaveBeenCalledWith("rfc_updated", {
      rfcId: "a",
      fields: ["reviewers"],
    });
  });

  it("posts a trimmed comment only when author and text are both given", () => {
    render(<RfcTrackerClient />);
    const author = screen.getByLabelText("Comment author");
    const text = screen.getByLabelText("Comment text");
    fireEvent.change(text, { target: { value: "No author" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(saved()[0].comments).toEqual([]);

    fireEvent.change(author, { target: { value: " Dee " } });
    fireEvent.change(text, { target: { value: "  Looks good  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    const comments = saved()[0].comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ author: "Dee", text: "Looks good" });
    expect(screen.getByText("Comments (1)")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(author).toHaveValue("");
    expect(text).toHaveValue("");
  });

  it("keeps comment drafts separate per RFC", () => {
    seed([rfc("a", { title: "First" }), rfc("b", { title: "Second" })]);
    render(<RfcTrackerClient />);
    const [firstText, secondText] = screen.getAllByLabelText("Comment text");
    fireEvent.change(firstText, { target: { value: "Only on first" } });
    expect(secondText).toHaveValue("");
    expect(within(card("First")).getByLabelText("Comment text")).toHaveValue("Only on first");
  });
});

describe("RFC Tracker: decision and Decision Log hand-off", () => {
  it("commits the decision text on blur, trimmed, and clears it when blank", () => {
    seed([rfc("a", { title: "SSE", status: "decided", decidedAt: "2026-10-12" })]);
    render(<RfcTrackerClient />);
    const box = screen.getByLabelText("Decision text");
    fireEvent.change(box, { target: { value: "  We will use SSE  " } });
    expect(saved()[0].decision).toBeUndefined();
    fireEvent.blur(box);
    expect(saved()[0].decision).toBe("We will use SSE");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    expect(saved()[0].decision).toBeUndefined();
  });

  it("pushes a decided RFC into the Decision Log as an accepted decision", () => {
    seed([
      rfc("a", {
        title: "Adopt SSE",
        status: "decided",
        decidedAt: "2026-10-12",
        decision: "Use SSE",
        description: "Polling is slow",
      }),
    ]);
    localStorage.setItem(DECISIONS, JSON.stringify([{ id: "d0", title: "Older" }]));
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Push to Decision Log/ }));
    const log = JSON.parse(localStorage.getItem(DECISIONS)!);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      title: "Adopt SSE",
      context: "Polling is slow",
      decision: "Use SSE",
      consequences: "",
      alternatives: [],
      status: "accepted",
      date: "2026-10-12",
    });
    expect(log[1].id).toBe("d0");
    expect(toasts.success).toHaveBeenCalledWith("Pushed to Decision Log");
  });

  it("refuses a duplicate title (case-insensitive) without writing", () => {
    seed([rfc("a", { title: "Adopt SSE", status: "decided", decidedAt: "2026-10-12" })]);
    const existing = [{ id: "d0", title: "adopt sse" }];
    localStorage.setItem(DECISIONS, JSON.stringify(existing));
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Push to Decision Log/ }));
    expect(JSON.parse(localStorage.getItem(DECISIONS)!)).toEqual(existing);
    expect(toasts.error).toHaveBeenCalledWith(
      "A decision with this title already exists in the log."
    );
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("survives a corrupt or junk Decision Log payload", () => {
    seed([rfc("a", { title: "Adopt SSE", status: "decided", decidedAt: "2026-10-12" })]);
    localStorage.setItem(DECISIONS, JSON.stringify({ not: "an array" }));
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Push to Decision Log/ }));
    const log = JSON.parse(localStorage.getItem(DECISIONS)!);
    expect(log.map((d: { title: string }) => d.title)).toEqual(["Adopt SSE"]);
  });

  it("skips junk Decision Log rows without a title when checking duplicates", () => {
    seed([rfc("a", { title: "Adopt SSE", status: "decided", decidedAt: "2026-10-12" })]);
    localStorage.setItem(DECISIONS, JSON.stringify([null, { random: "junk" }]));
    render(<RfcTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: /Push to Decision Log/ }));
    expect(JSON.parse(localStorage.getItem(DECISIONS)!)).toHaveLength(3);
    expect(toasts.success).toHaveBeenCalled();
  });
});

describe("RFC Tracker: export", () => {
  it("exports one CSV row per RFC with newlines collapsed", () => {
    seed([
      rfc("a", {
        title: "SSE",
        status: "decided",
        openedAt: "2026-10-01",
        decidedAt: "2026-10-05",
        reviewers: ["Bo", "Cy"],
        comments: [{ id: "c1", author: "Dee", ts: "2026-10-02T10:00:00.000Z", text: "ok" }],
        decision: "Use SSE\nnow",
        description: "line1\nline2",
      }),
    ]);
    render(<RfcTrackerClient />);
    expect(exported.csv?.rows).toEqual([
      [
        "SSE",
        "Ana",
        "decided",
        "2026-10-01",
        "2026-10-05",
        "Bo; Cy",
        1,
        "Use SSE now",
        "line1 line2",
      ],
    ]);
  });
});
