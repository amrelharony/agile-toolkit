import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AsyncUpdate } from "@/lib/stores/workspace-types";
import { ASYNC_STANDUP_ACTIONS } from "@/lib/history/event-actions";

/**
 * Async Standup Digest: posting, the per-day KPIs, the blocker rollup, the
 * 14-day calendar, the midnight rollover, the clipboard digest and removal.
 */

type CsvData = { headers: string[]; rows: (string | number)[][] };
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const clip = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<boolean>>(async () => true),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const signals = vi.hoisted(() => ({
  impediments: [] as unknown[],
  query: vi.fn(),
}));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  copyToClipboard: clip.copy,
}));
vi.mock("@/lib/utils/toast", () => ({ toast: toasts }));
vi.mock("@/lib/history/selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history/selectors")>()),
  selectEvents: (q: { toolId?: string; action?: string }) => {
    signals.query(q);
    return q.toolId === "impediments" && q.action === "impediment_raised"
      ? signals.impediments
      : [];
  },
}));

import { AsyncStandupClient } from "@/app/(tools)/async-standup/async-standup-client";

const upd = (
  id: string,
  member: string,
  date: string,
  extra: Partial<AsyncUpdate> = {}
): AsyncUpdate => ({ id, member, date, yesterday: "", today: "", ...extra });

/** Value of a compact StatCard by its label. */
function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.nextElementSibling!.textContent ?? "";
}

function stored(): AsyncUpdate[] {
  return useWorkspaceStore.getState().asyncUpdates ?? [];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 9, 18, 9, 0, 0));
  useWorkspaceStore.setState({ asyncUpdates: [] });
  exported.csv = undefined;
  history.log.mockClear();
  clip.copy.mockReset();
  clip.copy.mockImplementation(async () => true);
  toasts.success.mockClear();
  toasts.error.mockClear();
  signals.impediments = [];
  signals.query.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Async Standup — empty state", () => {
  it("shows zero KPIs, the empty-state message and today's local date", () => {
    render(<AsyncStandupClient />);
    expect(kpi("Today's updates")).toBe("0");
    expect(kpi("Members today")).toBe("0");
    expect(kpi("Blockers")).toBe("0");
    expect(kpi("Avg / day")).toBe("0.0");
    expect(screen.getByText("Post update for 2026-10-18")).toBeInTheDocument();
    expect(screen.getByText(/No updates posted for 2026-10-18 yet/)).toBeInTheDocument();
    expect(screen.queryByText("Blockers today:")).not.toBeInTheDocument();
  });

  it("keeps Post disabled until a non-blank member name is typed", () => {
    render(<AsyncStandupClient />);
    const post = screen.getByRole("button", { name: /Post update/ });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Member name"), { target: { value: "   " } });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Member name"), { target: { value: "Ana" } });
    expect(post).toBeEnabled();
  });
});

describe("Async Standup — posting", () => {
  it("posts a trimmed update for today and clears every field except the member", () => {
    render(<AsyncStandupClient />);
    fireEvent.change(screen.getByLabelText("Member name"), { target: { value: "  Alice " } });
    fireEvent.change(screen.getByLabelText("Yesterday"), { target: { value: "  shipped X  " } });
    fireEvent.change(screen.getByLabelText("Today"), { target: { value: "work on Y" } });
    // Whitespace-only optional fields are stored as undefined, not "   ".
    fireEvent.change(screen.getByLabelText("Blockers"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: " \n " } });
    fireEvent.click(screen.getByRole("button", { name: /Post update/ }));

    expect(stored()).toHaveLength(1);
    const [u] = stored();
    expect(u).toMatchObject({
      member: "Alice",
      date: "2026-10-18",
      yesterday: "shipped X",
      today: "work on Y",
    });
    expect(u.blockers).toBeUndefined();
    expect(u.description).toBeUndefined();
    expect(history.log).toHaveBeenCalledWith(
      ASYNC_STANDUP_ACTIONS.UPDATE_POSTED,
      expect.objectContaining({ member: "Alice", date: "2026-10-18", hasBlockers: false })
    );

    expect(screen.getByLabelText("Member name")).toHaveValue("  Alice ");
    expect(screen.getByLabelText("Yesterday")).toHaveValue("");
    expect(screen.getByLabelText("Today")).toHaveValue("");
    expect(screen.getByLabelText("Blockers")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(kpi("Today's updates")).toBe("1");
    expect(kpi("Members today")).toBe("1");
  });

  it("keeps a real blocker and flags the Blockers KPI", () => {
    render(<AsyncStandupClient />);
    fireEvent.change(screen.getByLabelText("Member name"), { target: { value: "Bob" } });
    fireEvent.change(screen.getByLabelText("Blockers"), {
      target: { value: " waiting on infra " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Post update/ }));
    expect(stored()[0].blockers).toBe("waiting on infra");
    expect(kpi("Blockers")).toBe("1");
    expect(screen.getByText("Blockers today:").parentElement).toHaveTextContent(
      "Bob — waiting on infra"
    );
  });

  it("does nothing when the member name is blank", () => {
    render(<AsyncStandupClient />);
    fireEvent.change(screen.getByLabelText("Yesterday"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Post update/ }));
    expect(stored()).toHaveLength(0);
    expect(history.log).not.toHaveBeenCalled();
  });
});

describe("Async Standup — derived values", () => {
  it("counts only today's updates, distinct members and blocked updates", () => {
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a1", "Alice", "2026-10-18", { yesterday: "a-yday", blockers: "waiting on infra" }),
        upd("a2", "Alice", "2026-10-18", { today: "a-today-2" }),
        upd("b1", "Bob", "2026-10-18", { today: "b-today", blockers: "   " }),
        upd("c1", "Carol", "2026-10-17", { today: "old", blockers: "old blocker" }),
      ],
    });
    render(<AsyncStandupClient />);
    expect(kpi("Today's updates")).toBe("3");
    expect(kpi("Members today")).toBe("2");
    // A whitespace-only blocker is not a blocker.
    expect(kpi("Blockers")).toBe("1");
    const callout = screen.getByText("Blockers today:").parentElement!;
    expect(callout).toHaveTextContent("Alice — waiting on infra");
    expect(callout).not.toHaveTextContent("Carol");
    expect(callout).not.toHaveTextContent("Bob");
    // Yesterday's update is not in today's digest preview.
    expect(screen.queryByText("old")).not.toBeInTheDocument();
  });

  it("groups today's preview by member", () => {
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a1", "Alice", "2026-10-18", { yesterday: "a-yday" }),
        upd("b1", "Bob", "2026-10-18", { today: "b-today" }),
        upd("a2", "Alice", "2026-10-18", { today: "a-today-2", description: "ctx" }),
      ],
    });
    render(<AsyncStandupClient />);
    const aliceCard = screen.getByText("Alice", { selector: "div" }).parentElement!;
    expect(within(aliceCard).getAllByRole("button", { name: "Remove update" })).toHaveLength(2);
    expect(aliceCard).toHaveTextContent("a-yday");
    expect(aliceCard).toHaveTextContent("a-today-2");
    expect(aliceCard).toHaveTextContent("ctx");
    expect(aliceCard).not.toHaveTextContent("b-today");
  });

  it("truncates a long blocker in the callout to 80 characters", () => {
    const long = "x".repeat(200);
    useWorkspaceStore.setState({
      asyncUpdates: [upd("a1", "Al", "2026-10-18", { blockers: long })],
    });
    render(<AsyncStandupClient />);
    const callout = screen.getByText("Blockers today:").parentElement!;
    const text = callout.textContent!.replace("Blockers today: ", "");
    expect(text).toHaveLength(80);
    expect(text.startsWith("Al — xxx")).toBe(true);
  });
});

describe("Async Standup — 14-day calendar", () => {
  it("covers the 14 local days ending today across a month boundary", () => {
    vi.setSystemTime(new Date(2026, 2, 3, 10, 0, 0));
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a", "A", "2026-02-18"),
        upd("b", "B", "2026-02-18"),
        upd("c", "C", "2026-03-03"),
        // Day 15 back: outside the window.
        ...[1, 2, 3, 4, 5].map((i) => upd(`old${i}`, "Old", "2026-02-17")),
      ],
    });
    render(<AsyncStandupClient />);
    const cells = screen.getAllByTitle(/^\d{4}-\d{2}-\d{2}: \d+ updates?$/);
    expect(cells).toHaveLength(14);
    expect(cells[0]).toHaveAttribute("title", "2026-02-18: 2 updates");
    expect(cells[13]).toHaveAttribute("title", "2026-03-03: 1 update");
    expect(cells[10]).toHaveAttribute("title", "2026-02-28: 0 updates");
    expect(cells[11]).toHaveAttribute("title", "2026-03-01: 0 updates");
    expect(screen.queryByTitle(/^2026-02-17/)).not.toBeInTheDocument();
    // 3 updates inside the window / 14 days = 0.21.
    expect(kpi("Avg / day")).toBe("0.2");
  });

  it("spans a year boundary", () => {
    vi.setSystemTime(new Date(2027, 0, 5, 10, 0, 0));
    render(<AsyncStandupClient />);
    const cells = screen.getAllByTitle(/^\d{4}-\d{2}-\d{2}: \d+ updates?$/);
    expect(cells[0]).toHaveAttribute("title", "2026-12-23: 0 updates");
    expect(cells[13]).toHaveAttribute("title", "2027-01-05: 0 updates");
  });

  it("rolls 'today' over at midnight without a reload", () => {
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59, 30));
    useWorkspaceStore.setState({ asyncUpdates: [upd("a1", "Alice", "2026-10-18")] });
    render(<AsyncStandupClient />);
    expect(kpi("Today's updates")).toBe("1");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Post update for 2026-10-19")).toBeInTheDocument();
    expect(kpi("Today's updates")).toBe("0");

    fireEvent.change(screen.getByLabelText("Member name"), { target: { value: "Bob" } });
    fireEvent.click(screen.getByRole("button", { name: /Post update/ }));
    expect(stored().find((u) => u.member === "Bob")?.date).toBe("2026-10-19");
  });
});

describe("Async Standup — remove", () => {
  it("removes exactly the clicked update", () => {
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a1", "Alice", "2026-10-18", { today: "first" }),
        upd("a2", "Alice", "2026-10-18", { today: "second" }),
        upd("a3", "Alice", "2026-10-18", { today: "third" }),
      ],
    });
    render(<AsyncStandupClient />);
    const second = screen.getByText("second").closest("div.rounded-md")!;
    fireEvent.click(within(second as HTMLElement).getByRole("button", { name: "Remove update" }));
    expect(stored().map((u) => u.id)).toEqual(["a1", "a3"]);
    expect(history.log).toHaveBeenCalledWith(ASYNC_STANDUP_ACTIONS.UPDATE_REMOVED, {
      updateId: "a2",
      member: "Alice",
      date: "2026-10-18",
    });
  });
});

describe("Async Standup — digest", () => {
  it("copies a blockers-first, member-grouped digest of today only, newlines flattened", async () => {
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a1", "Alice", "2026-10-18", {
          yesterday: "line1\nline2",
          today: "  ",
          blockers: "blocked\r\non review",
        }),
        upd("b1", "Bob", "2026-10-18", { today: "ship", description: "see\nPR" }),
        upd("c1", "Carol", "2026-10-17", { today: "stale" }),
      ],
    });
    render(<AsyncStandupClient />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Digest/ }));
    });
    expect(clip.copy).toHaveBeenCalledTimes(1);
    const md = clip.copy.mock.calls[0][0];
    expect(md).toBe(
      [
        "# Async Standup — 2026-10-18",
        "",
        "## Blockers",
        "- **Alice**: blocked on review",
        "",
        "## Alice",
        "- **Yesterday**: line1 line2",
        "- **Blockers**: blocked on review",
        "",
        "## Bob",
        "- **Today**: ship",
        "- see PR",
        "",
      ].join("\n")
    );
    expect(toasts.success).toHaveBeenCalledWith("Digest copied to clipboard");
    expect(history.log).toHaveBeenCalledWith(ASYNC_STANDUP_ACTIONS.DIGEST_GENERATED, {
      date: "2026-10-18",
      updateCount: 2,
      blockerCount: 1,
    });
  });

  it("copies a 'no updates' stub on an empty day", async () => {
    useWorkspaceStore.setState({ asyncUpdates: [upd("c1", "Carol", "2026-10-17")] });
    render(<AsyncStandupClient />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Digest/ }));
    });
    expect(clip.copy.mock.calls[0][0]).toBe(
      "# Async Standup — 2026-10-18\n\nNo updates posted today."
    );
  });

  it("reports a clipboard failure", async () => {
    clip.copy.mockImplementation(async () => false);
    render(<AsyncStandupClient />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Generate Digest/ }));
    });
    expect(toasts.error).toHaveBeenCalledWith("Failed to copy digest");
    expect(toasts.success).not.toHaveBeenCalled();
  });
});

describe("Async Standup — signals and export", () => {
  it("shows the impediments raised in the last 7 days next to today's digest", () => {
    signals.impediments = [{}, {}];
    useWorkspaceStore.setState({ asyncUpdates: [upd("a1", "Alice", "2026-10-18")] });
    render(<AsyncStandupClient />);
    expect(screen.getByText("2 blockers raised (7d)")).toBeInTheDocument();
    expect(signals.query).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "impediments", sinceDays: 7 })
    );
  });

  it("uses the singular for one impediment and hides the chip with no updates today", () => {
    signals.impediments = [{}];
    const { unmount } = render(<AsyncStandupClient />);
    expect(screen.queryByText(/raised \(7d\)/)).not.toBeInTheDocument();
    unmount();
    useWorkspaceStore.setState({ asyncUpdates: [upd("a1", "Alice", "2026-10-18")] });
    render(<AsyncStandupClient />);
    expect(screen.getByText("1 blocker raised (7d)")).toBeInTheDocument();
  });

  it("exports every update (all days) as CSV with blanks for missing optional fields", () => {
    useWorkspaceStore.setState({
      asyncUpdates: [
        upd("a1", "Alice", "2026-10-18", { yesterday: "y", today: "t", blockers: "b" }),
        upd("c1", "Carol", "2026-10-01", { today: "old", description: "d" }),
      ],
    });
    render(<AsyncStandupClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Member",
      "Yesterday",
      "Today",
      "Blockers",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2026-10-18", "Alice", "y", "t", "b", ""],
      ["2026-10-01", "Carol", "", "old", "", "d"],
    ]);
  });
});
