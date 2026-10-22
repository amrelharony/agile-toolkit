import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Incident commander core: the duration / MTTR helpers, declaring an
 * incident, the active-incident card (roles, timeline, comms templates,
 * mitigate / resolve, live clock), the KPI tiles, the MTTR survival panel,
 * the weekly trend chip, the recent-incidents table and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
// undo wrapper: run the change immediately
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/lib/utils/toast", () => ({ toast: toasts }));

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

import { IncidentCommanderClient } from "@/app/(tools)/incident-commander/incident-commander-client";
import { formatDuration, mttrHours } from "@/app/(tools)/incident-commander/helpers";
import type { Incident } from "@/app/(tools)/incident-commander/types";

const IC_ID = "incidentCommander:current";
// Sunday 18 Oct 2026, 12:00 local.
const NOW = new Date(2026, 9, 18, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const inc = (id: string, title: string, extra: Partial<Incident> = {}): Incident => ({
  id,
  title,
  severity: "sev3",
  status: "active",
  openedAt: ago(HOUR),
  timeline: [],
  ...extra,
});

/** A resolved incident opened `openedAgo` ago that took `minutes` to fix. */
const resolved = (id: string, minutes: number, openedAgo = DAY, extra: Partial<Incident> = {}) =>
  inc(id, `Resolved ${id}`, {
    status: "resolved",
    openedAt: ago(openedAgo),
    resolvedAt: ago(openedAgo - minutes * MIN),
    ...extra,
  });

function seed(incidents: Incident[]) {
  useWorkspaceStore.setState({ incidentCommanders: [{ id: IC_ID, incidents }] });
}

const incidents = () =>
  (useWorkspaceStore.getState().incidentCommanders ?? []).find((d) => d.id === IC_ID)?.incidents ??
  [];

/** The value (and hint) of a compact KPI tile, found by its label. */
const kpi = (label: string) => {
  const tile = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  const value = tile.parentElement!.nextElementSibling as HTMLElement;
  return { value: value.textContent, hint: value.nextElementSibling?.textContent };
};

/** The card for one active incident (walks up from its Delete button). */
const card = (title: string) => {
  let el: HTMLElement | null = screen.getByRole("button", { name: `Delete ${title}` });
  while (el && !el.textContent?.includes("Slack template")) el = el.parentElement;
  return el as HTMLElement;
};

const recentTable = () => within(screen.getByRole("table"));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  toasts.success.mockClear();
  toasts.error.mockClear();
  useWorkspaceStore.setState({ incidentCommanders: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [59_999, "0m"],
    [59 * MIN, "59m"],
    [60 * MIN, "1h 0m"],
    [125 * MIN + 30_000, "2h 5m"],
    [50 * HOUR, "50h 0m"],
  ])("formats %i ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it("shows a dash for a negative duration", () => {
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("mttrHours", () => {
  it("is the open-to-resolve time in hours", () => {
    expect(
      mttrHours(
        inc("a", "A", {
          status: "resolved",
          openedAt: "2026-10-18T10:00:00.000Z",
          resolvedAt: "2026-10-18T11:30:00.000Z",
        })
      )
    ).toBe(1.5);
  });

  it("is null while unresolved, for a resolve before the open, or for a bad date", () => {
    expect(mttrHours(inc("a", "A"))).toBeNull();
    expect(
      mttrHours(
        inc("b", "B", {
          status: "resolved",
          openedAt: "2026-10-18T10:00:00.000Z",
          resolvedAt: "2026-10-18T09:00:00.000Z",
        })
      )
    ).toBeNull();
    expect(
      mttrHours(inc("c", "C", { status: "resolved", openedAt: "garbage", resolvedAt: ago(0) }))
    ).toBeNull();
  });

  // Bug: a re-opened incident keeps its old resolvedAt, and the timestamp
  // alone was the "is it resolved?" test — so it still reported an MTTR.
  it("is null for a re-opened incident that kept its old resolvedAt", () => {
    expect(
      mttrHours(
        inc("d", "D", {
          status: "active",
          openedAt: "2026-10-18T10:00:00.000Z",
          resolvedAt: "2026-10-18T11:00:00.000Z",
        })
      )
    ).toBeNull();
  });
});

describe("Incident commander — empty state", () => {
  it("shows no active incidents, neutral KPIs and the severity matrix", () => {
    render(<IncidentCommanderClient />);
    expect(screen.getByRole("status")).toHaveTextContent(/No active incidents\./);
    expect(kpi("Open").value).toBe("0");
    expect(kpi("Avg MTTR (7d)")).toEqual({ value: "—", hint: "No resolutions" });
    expect(kpi("SEV-1/2 (30d)")).toEqual({ value: "0", hint: "0 sev1 · 0 sev2" });
    expect(kpi("Total (30d)").value).toBe("0");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/Weekly incident/)).toBeNull();
    expect(screen.getByText("Full team paged · 24/7 response · exec comms")).toBeInTheDocument();
    expect(exported.csv?.rows).toEqual([]);
  });
});

describe("Incident commander — declaring", () => {
  it("declares a trimmed SEV-3 incident, opened now, newest first, and resets the form", () => {
    seed([inc("old", "Old one")]);
    render(<IncidentCommanderClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Checkout 500s  " } });
    fireEvent.change(screen.getByLabelText("Commander", { selector: "#ic-cmd" }), {
      target: { value: " Ana " },
    });
    fireEvent.change(screen.getByLabelText("Scribe", { selector: "#ic-scribe" }), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  EU only  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Declare incident/ }));

    expect(incidents().map((i) => i.title)).toEqual(["Checkout 500s", "Old one"]);
    expect(incidents()[0]).toMatchObject({
      severity: "sev3",
      status: "active",
      openedAt: NOW.toISOString(),
      commander: "Ana",
      description: "EU only",
      timeline: [],
    });
    expect(incidents()[0].scribe).toBeUndefined();
    expect(incidents()[0].resolvedAt).toBeUndefined();
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Commander", { selector: "#ic-cmd" })).toHaveValue("");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
  });

  it("declares with the severity picked in the dropdown", () => {
    render(<IncidentCommanderClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "DB down" } });
    const trigger = screen.getByRole("combobox", { name: "Severity" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "SEV-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Declare incident/ }));
    expect(incidents()[0].severity).toBe("sev1");
    expect(kpi("SEV-1/2 (30d)")).toEqual({ value: "1", hint: "1 sev1 · 0 sev2" });
  });

  it("declares on Enter in the title", () => {
    render(<IncidentCommanderClient />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Search slow" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(incidents().map((i) => i.title)).toEqual(["Search slow"]);
  });

  it("ignores a blank title", () => {
    render(<IncidentCommanderClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Declare incident/ }));
    expect(useWorkspaceStore.getState().incidentCommanders).toEqual([]);
  });

  it("caps an over-long title at 240 characters", () => {
    render(<IncidentCommanderClient />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "x".repeat(500) } });
    fireEvent.click(screen.getByRole("button", { name: /Declare incident/ }));
    expect(incidents()[0].title).toHaveLength(240);
  });
});

describe("Incident commander — active incident card", () => {
  it("mitigating keeps it open; resolving stamps the time and moves it to the table", () => {
    seed([inc("i1", "Checkout down", { openedAt: ago(90 * MIN) })]);
    render(<IncidentCommanderClient />);

    fireEvent.click(screen.getByRole("button", { name: "Mark mitigated" }));
    expect(incidents()[0].status).toBe("mitigated");
    expect(incidents()[0].resolvedAt).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Mark mitigated" })).toBeNull();
    expect(kpi("Open").value).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /Mark resolved/ }));
    expect(incidents()[0]).toMatchObject({ status: "resolved", resolvedAt: NOW.toISOString() });
    expect(screen.queryByRole("button", { name: "Delete Checkout down" })).toBeNull();
    expect(kpi("Open").value).toBe("0");
    expect(kpi("Avg MTTR (7d)")).toEqual({ value: "1.5h", hint: "resolved" });
    const row = recentTable().getByText("Checkout down").closest("tr") as HTMLElement;
    expect(row).toHaveTextContent("resolved");
    expect(row).toHaveTextContent("1.50h");
  });

  it("shows a live elapsed clock that ticks", () => {
    seed([inc("i1", "Checkout down", { openedAt: ago(125 * MIN) })]);
    render(<IncidentCommanderClient />);
    expect(screen.getByText("Elapsed time:").parentElement).toHaveTextContent("2h 5m");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Elapsed time:").parentElement).toHaveTextContent("2h 6m");
  });

  // Bug: a re-opened incident (set back to active by the agent) kept its old
  // resolvedAt, so its clock froze at the old resolution, it showed an MTTR
  // and it was averaged into "Avg MTTR (7d)".
  it("treats a re-opened incident as open: running clock, no MTTR", () => {
    seed([
      inc("i1", "Flapping", {
        openedAt: ago(3 * HOUR),
        resolvedAt: ago(2 * HOUR),
        status: "active",
      }),
    ]);
    render(<IncidentCommanderClient />);
    expect(screen.getByText("Elapsed time:").parentElement).toHaveTextContent("3h 0m");
    expect(kpi("Open").value).toBe("1");
    expect(kpi("Avg MTTR (7d)")).toEqual({ value: "—", hint: "No resolutions" });
    const row = recentTable().getByText("Flapping").closest("tr") as HTMLElement;
    expect(within(row).getAllByRole("cell")[4]).toHaveTextContent("—");
    expect(exported.csv?.rows[0][8]).toBe("");
  });

  it("assigns and clears the commander on blur, trimmed", () => {
    seed([inc("i1", "Checkout down")]);
    render(<IncidentCommanderClient />);
    const commander = screen.getByLabelText("Commander", { selector: "#ic-i1-commander" });
    fireEvent.change(commander, { target: { value: "  Ana  " } });
    expect(incidents()[0].commander).toBeUndefined(); // not until blur
    fireEvent.blur(commander);
    expect(incidents()[0].commander).toBe("Ana");
    expect(card("Checkout down")).toHaveTextContent("Commander: Ana · Scribe: (unassigned)");

    fireEvent.change(commander, { target: { value: "" } });
    fireEvent.blur(commander);
    expect(incidents()[0].commander).toBeUndefined();

    const scribe = screen.getByLabelText("Scribe", { selector: "#ic-i1-scribe" });
    fireEvent.change(scribe, { target: { value: "Bo" } });
    fireEvent.blur(scribe);
    expect(incidents()[0].scribe).toBe("Bo");
  });

  it("logs timeline entries with a default author and ignores blank ones", () => {
    seed([inc("i1", "Checkout down")]);
    render(<IncidentCommanderClient />);
    expect(screen.getByText(/No entries yet/)).toBeInTheDocument();

    const text = screen.getByRole("textbox", { name: "Timeline entry text" });
    fireEvent.change(text, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Entry/ }));
    expect(incidents()[0].timeline).toEqual([]);

    fireEvent.change(text, { target: { value: "  Rolled back v42  " } });
    fireEvent.click(screen.getByRole("button", { name: /Entry/ }));
    expect(incidents()[0].timeline).toEqual([
      expect.objectContaining({
        author: "anonymous",
        text: "Rolled back v42",
        ts: NOW.toISOString(),
      }),
    ]);
    expect(text).toHaveValue("");

    fireEvent.change(screen.getByRole("textbox", { name: "Timeline entry author" }), {
      target: { value: " ana " },
    });
    fireEvent.change(text, { target: { value: "Error rate normal" } });
    fireEvent.keyDown(text, { key: "Enter" });
    expect(incidents()[0].timeline.map((e) => [e.author, e.text])).toEqual([
      ["anonymous", "Rolled back v42"],
      ["ana", "Error rate normal"],
    ]);
    expect(screen.getByText("Timeline (2)")).toBeInTheDocument();
    expect(screen.getByText("ana:")).toBeInTheDocument();
  });

  it("fills the Slack and email templates from the incident", () => {
    seed([inc("i1", "Checkout down", { severity: "sev2", commander: "Ana" })]);
    render(<IncidentCommanderClient />);
    const c = card("Checkout down");
    expect(c).toHaveTextContent(":rotating_light: SEV-2 INCIDENT — Checkout down");
    expect(c).toHaveTextContent("Commander: Ana · Scribe: (unassigned)");
    expect(c).toHaveTextContent("Subject: [SEV-2] Checkout down");
    expect(c).toHaveTextContent("Incident commander: Ana.");
    expect(c).toHaveTextContent("Scribe: TBD.");
  });

  it("copies a template and says so, or reports a failed copy", async () => {
    seed([inc("i1", "Checkout down")]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<IncidentCommanderClient />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Slack template" }));
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("SEV-3 INCIDENT — Checkout down")
    );
    expect(toasts.success).toHaveBeenCalledWith("Slack template copied");

    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy email template" }));
    });
    expect(toasts.error).toHaveBeenCalledWith("Copy failed");
  });

  it("deletes only the incident whose card was deleted", () => {
    seed([inc("i1", "Checkout down"), inc("i2", "Search slow")]);
    render(<IncidentCommanderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Search slow" }));
    expect(incidents().map((i) => i.id)).toEqual(["i1"]);
  });
});

describe("Incident commander — KPIs", () => {
  it("counts severities opened in the last 30 days only", () => {
    seed([
      inc("a", "A", { severity: "sev1", openedAt: ago(2 * DAY) }),
      inc("b", "B", { severity: "sev2", openedAt: ago(29 * DAY), status: "mitigated" }),
      inc("c", "C", { severity: "sev4", openedAt: ago(10 * DAY) }),
      inc("old", "Old", { severity: "sev1", openedAt: ago(31 * DAY) }),
    ]);
    render(<IncidentCommanderClient />);
    expect(kpi("SEV-1/2 (30d)")).toEqual({ value: "2", hint: "1 sev1 · 1 sev2" });
    expect(kpi("Total (30d)").value).toBe("3");
    expect(kpi("Open")).toEqual({ value: "4", hint: "active or mitigated" });
  });

  it("averages MTTR over incidents resolved in the last 7 days", () => {
    seed([
      resolved("a", 60, 2 * DAY),
      resolved("b", 180, 3 * DAY),
      resolved("old", 6000, 20 * DAY), // resolved ~16 days ago
    ]);
    render(<IncidentCommanderClient />);
    expect(kpi("Avg MTTR (7d)")).toEqual({ value: "2.0h", hint: "resolved" });
  });

  it("switches to the median with a CI once four incidents are resolved", () => {
    seed([resolved("a", 10), resolved("b", 20), resolved("c", 30), resolved("d", 40)]);
    render(<IncidentCommanderClient />);
    const { value, hint } = kpi("Median MTTR");
    expect(value).toBe("20m");
    expect(hint).toMatch(/^95% CI \[\d+, \d+\]$/);
    expect(screen.queryByText("Avg MTTR (7d)")).toBeNull();

    expect(screen.getByText("MTTR survival curve")).toBeInTheDocument();
    expect(screen.getByText(/Median 20m · 95% CI \[/)).toBeInTheDocument();
    expect(
      screen.getByText(/Empirical resolution-time distribution over 4 resolved\s+incidents\./)
    ).toBeInTheDocument();
  });

  it("keeps the survival panel hidden below four resolved incidents", () => {
    seed([resolved("a", 10), resolved("b", 20), resolved("c", 30)]);
    render(<IncidentCommanderClient />);
    expect(screen.queryByText("MTTR survival curve")).toBeNull();
    expect(kpi("Avg MTTR (7d)").value).toBe("0.3h");
  });
});

describe("Incident commander — weekly trend chip", () => {
  // UTC Sunday that starts the current week, then whole weeks back from it.
  const thisWeek = Date.UTC(2026, 9, 18);
  const inWeek = (weeksBack: number, n: number) =>
    Array.from({ length: n }, (_, j) =>
      inc(`w${weeksBack}-${j}`, `W${weeksBack}.${j}`, {
        status: "resolved",
        openedAt: new Date(thisWeek - weeksBack * 7 * DAY + HOUR + j * MIN).toISOString(),
        resolvedAt: new Date(thisWeek - weeksBack * 7 * DAY + 2 * HOUR + j * MIN).toISOString(),
      })
    );

  it("stays hidden with under five weeks of history", () => {
    seed([...inWeek(3, 1), ...inWeek(0, 1)]);
    render(<IncidentCommanderClient />);
    expect(screen.queryByText(/Weekly incident/)).toBeNull();
  });

  it("reports no significant change for a short, flat history", () => {
    seed([0, 1, 2, 3, 4, 5].flatMap((w) => inWeek(w, 1)));
    render(<IncidentCommanderClient />);
    expect(screen.getByText("Weekly incident trend: no significant change")).toBeInTheDocument();
  });

  it("flags a steadily rising weekly count", () => {
    // 1 incident ten weeks ago … 10 this week.
    seed([9, 8, 7, 6, 5, 4, 3, 2, 1, 0].flatMap((w) => inWeek(w, 10 - w)));
    render(<IncidentCommanderClient />);
    expect(screen.getByText(/Weekly incidents trending up significantly/)).toBeInTheDocument();
  });
});

describe("Incident commander — recent incidents table", () => {
  it("lists the ten most recently opened, newest first", () => {
    seed(
      Array.from({ length: 12 }, (_, k) =>
        resolved(`r${k}`, 30, (k + 1) * HOUR + 31 * MIN, { title: `Incident ${k}` })
      )
    );
    render(<IncidentCommanderClient />);
    const titles = recentTable()
      .getAllByRole("row")
      .slice(1)
      .map((tr) => tr.querySelector("td")!.textContent);
    expect(titles).toEqual(Array.from({ length: 10 }, (_, k) => `Incident ${k}`));
  });

  it("removes a resolved incident from the table", () => {
    seed([resolved("a", 30, DAY, { title: "Old outage" }), inc("b", "Live")]);
    render(<IncidentCommanderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Old outage" }));
    expect(incidents().map((i) => i.id)).toEqual(["b"]);
  });

  it("shows a dash for a missing commander and MTTR", () => {
    seed([inc("a", "Live")]);
    render(<IncidentCommanderClient />);
    const cells = within(recentTable().getByText("Live").closest("tr") as HTMLElement).getAllByRole(
      "cell"
    );
    expect(cells[1]).toHaveTextContent("SEV-3");
    expect(cells[2]).toHaveTextContent("active");
    expect(cells[4]).toHaveTextContent("—");
    expect(cells[5]).toHaveTextContent("—");
  });
});

describe("Incident commander — export", () => {
  it("exports one CSV row per incident with its MTTR", () => {
    seed([
      inc("a", "Checkout down", {
        severity: "sev1",
        status: "resolved",
        openedAt: "2026-10-18T06:00:00.000Z",
        resolvedAt: "2026-10-18T07:30:00.000Z",
        commander: "Ana",
        scribe: "Bo",
        description: "EU",
        timeline: [{ id: "t", ts: "2026-10-18T06:05:00.000Z", author: "ana", text: "paged" }],
      }),
      inc("b", "Search slow", { openedAt: "2026-10-18T08:00:00.000Z" }),
    ]);
    render(<IncidentCommanderClient />);
    expect(exported.csv?.headers).toEqual([
      "Title",
      "Severity",
      "Status",
      "Opened",
      "Resolved",
      "Commander",
      "Scribe",
      "Timeline #",
      "MTTR (h)",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "Checkout down",
        "sev1",
        "resolved",
        "2026-10-18T06:00:00.000Z",
        "2026-10-18T07:30:00.000Z",
        "Ana",
        "Bo",
        1,
        "1.50",
        "EU",
      ],
      ["Search slow", "sev3", "active", "2026-10-18T08:00:00.000Z", "", "", "", 0, "", ""],
    ]);
  });
});
