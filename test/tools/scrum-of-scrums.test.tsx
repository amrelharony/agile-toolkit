import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SosEntry } from "@/lib/stores/workspace-types";

/**
 * Scrum of Scrums: cross-team log in the synced workspace store. Covers
 * logging entries (validation, kinds, reset), newest-first ordering, the
 * open-per-kind KPIs, resolving / removing, the ≥3-day stale-blocker
 * callout (local-day ages) and the CSV export rows.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
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

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { ScrumOfScrumsClient } from "@/app/(tools)/scrum-of-scrums/scrum-of-scrums-client";

const entry = (id: string, over: Partial<SosEntry> = {}): SosEntry => ({
  id,
  meetingDate: "2026-10-18",
  team: `Team ${id}`,
  kind: "update",
  text: `Text ${id}`,
  status: "open",
  loggedAt: `2026-10-18T09:00:0${id.length}.000Z`,
  ...over,
});

const entries = () => useWorkspaceStore.getState().sosEntries ?? [];

function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.parentElement!.children[1].textContent ?? "";
}

function chooseKind(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Entry type" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

function fillDraft(team: string, text: string) {
  fireEvent.change(screen.getByLabelText("Team name"), { target: { value: team } });
  fireEvent.change(screen.getByLabelText("Entry details"), { target: { value: text } });
}

beforeEach(() => {
  history.log.mockClear();
  exported.csv = undefined;
  useWorkspaceStore.setState({ sosEntries: [] });
  vi.useFakeTimers({ toFake: ["Date"] });
  // Just after local midnight, where UTC and local days differ east of UTC.
  vi.setSystemTime(new Date(2026, 9, 18, 0, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Scrum of Scrums: logging", () => {
  it("starts empty with zeroed open counts and no stale callout", () => {
    render(<ScrumOfScrumsClient />);
    for (const k of ["blockers open", "dependencies open", "decisions open", "updates open"]) {
      expect(kpi(k)).toBe("0");
    }
    expect(screen.queryByText(/aged ≥3 days/)).toBeNull();
    expect(screen.getByLabelText("Meeting date")).toHaveValue("2026-10-18");
  });

  it("logs a blocker dated today (local) and raises an impediment event", () => {
    render(<ScrumOfScrumsClient />);
    fillDraft("Payments", "Waiting on API keys");
    chooseKind("Blocker");
    fireEvent.change(screen.getByLabelText("Blocked by (team)"), {
      target: { value: "Platform" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));

    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({
      meetingDate: "2026-10-18",
      team: "Payments",
      kind: "blocker",
      text: "Waiting on API keys",
      blockedBy: "Platform",
      status: "open",
    });
    expect(history.log).toHaveBeenCalledWith("impediment_raised", {
      team: "Payments",
      text: "Waiting on API keys",
    });
    expect(kpi("blockers open")).toBe("1");
    expect(screen.getByText("⇢ blocked by: Platform")).toBeInTheDocument();
    // Draft reset
    expect(screen.getByLabelText("Team name")).toHaveValue("");
    expect(screen.getByLabelText("Entry details")).toHaveValue("");
    expect(screen.getByLabelText("Blocked by (team)")).toHaveValue("");
  });

  it("logs non-blockers as team updates", () => {
    render(<ScrumOfScrumsClient />);
    fillDraft("Search", "Shipping facets");
    chooseKind("Decision");
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));
    expect(entries()[0].kind).toBe("decision");
    expect(history.log).toHaveBeenCalledWith("team_update_added", {
      team: "Search",
      kind: "decision",
    });
    expect(kpi("decisions open")).toBe("1");
  });

  it("needs both a team and some text", () => {
    render(<ScrumOfScrumsClient />);
    fillDraft("", "Text without team");
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));
    fillDraft("Team", "   ");
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));
    expect(entries()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  // Bug: entries were stored untrimmed, so a whitespace-only "Blocked by"
  // rendered a dangling "⇢ blocked by:" line (and padded team names leaked
  // into labels and the export).
  it("trims the team, text and blocked-by fields and drops a blank blocked-by", () => {
    render(<ScrumOfScrumsClient />);
    fillDraft("  Payments  ", "  Waiting on keys  ");
    fireEvent.change(screen.getByLabelText("Blocked by (team)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Log/ }));
    expect(entries()[0]).toMatchObject({ team: "Payments", text: "Waiting on keys" });
    expect(entries()[0].blockedBy).toBeUndefined();
    expect(screen.queryByText(/blocked by:/)).toBeNull();
  });

  it("lists entries newest first", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry("a", { team: "Old", loggedAt: "2026-10-10T09:00:00.000Z" }),
        entry("b", { team: "New", loggedAt: "2026-10-17T09:00:00.000Z" }),
        entry("c", { team: "Mid", loggedAt: "2026-10-12T09:00:00.000Z" }),
      ],
    });
    render(<ScrumOfScrumsClient />);
    const teams = screen
      .getAllByRole("button", { name: /^Remove update from/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(teams).toEqual([
      "Remove update from New",
      "Remove update from Mid",
      "Remove update from Old",
    ]);
  });
});

describe("Scrum of Scrums: resolve and remove", () => {
  it("resolves an entry with today's local date and drops it from the open count", () => {
    useWorkspaceStore.setState({
      sosEntries: [entry("a", { kind: "blocker", team: "Payments" })],
    });
    render(<ScrumOfScrumsClient />);
    expect(kpi("blockers open")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Resolve blocker from Payments" }));
    expect(entries()[0]).toMatchObject({ status: "resolved", resolvedAt: "2026-10-18" });
    expect(kpi("blockers open")).toBe("0");
    expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
    expect(screen.getByText("(resolved)")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith("team_update_added", {
      team: "Payments",
      kind: "blocker",
      statusChange: { from: "open", to: "resolved" },
    });
  });

  it("removes exactly the clicked entry", () => {
    useWorkspaceStore.setState({
      sosEntries: [entry("a", { team: "Keep" }), entry("b", { team: "Drop", kind: "dependency" })],
    });
    render(<ScrumOfScrumsClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove dependency from Drop" }));
    expect(entries().map((e) => e.id)).toEqual(["a"]);
    expect(history.log).toHaveBeenCalledWith("team_update_removed", {
      team: "Drop",
      kind: "dependency",
    });
  });

  // Bug: the KPI label was built as `${kind}s open`, which rendered
  // "dependencys open".
  it("counts only open entries per kind under correctly pluralised labels", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry("a", { kind: "dependency" }),
        entry("b", { kind: "dependency" }),
        entry("c", { kind: "dependency", status: "resolved" }),
        entry("d", { kind: "update" }),
      ],
    });
    render(<ScrumOfScrumsClient />);
    expect(kpi("dependencies open")).toBe("2");
    expect(kpi("updates open")).toBe("1");
    expect(kpi("blockers open")).toBe("0");
  });
});

describe("Scrum of Scrums: ages and stale blockers", () => {
  it("ages entries in whole local days, and shows a dash for a malformed date", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry("a", { meetingDate: "2026-10-15", loggedAt: "2026-10-15T09:00:00.000Z" }),
        entry("b", { meetingDate: "not a date", loggedAt: "2026-10-14T09:00:00.000Z" }),
        entry("c", { meetingDate: "2026-10-20", loggedAt: "2026-10-13T09:00:00.000Z" }),
      ],
    });
    render(<ScrumOfScrumsClient />);
    expect(screen.getByText("age 3d")).toBeInTheDocument();
    expect(screen.getByText("age —d")).toBeInTheDocument();
    // A future meeting date clamps to 0, not a negative age.
    expect(screen.getByText("age 0d")).toBeInTheDocument();
  });

  it("calls out open blockers aged three days or more", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry("old", {
          kind: "blocker",
          team: "Payments",
          text: "Keys",
          meetingDate: "2026-10-15",
        }),
        entry("new", { kind: "blocker", team: "Search", meetingDate: "2026-10-16" }),
        entry("done", {
          kind: "blocker",
          status: "resolved",
          team: "Infra",
          meetingDate: "2026-10-01",
        }),
        entry("dep", { kind: "dependency", team: "Data", meetingDate: "2026-10-01" }),
      ],
    });
    render(<ScrumOfScrumsClient />);
    expect(screen.getByText(/^1 blocker aged ≥3 days:$/)).toBeInTheDocument();
    expect(screen.getByText(/Payments: Keys/)).toBeInTheDocument();
    expect(screen.queryByText(/Search: /)).toBeNull();
  });

  it("pluralises, truncates each blocker to 40 characters and lists at most three", () => {
    const long = "x".repeat(60);
    useWorkspaceStore.setState({
      sosEntries: ["a", "bb", "ccc", "dddd"].map((id) =>
        entry(id, { kind: "blocker", team: `T${id}`, text: long, meetingDate: "2026-10-01" })
      ),
    });
    render(<ScrumOfScrumsClient />);
    expect(screen.getByText(/^4 blockers aged ≥3 days:$/)).toBeInTheDocument();
    const callout = screen.getByText(/^4 blockers/).parentElement!;
    const listed = callout.textContent!.split(":").slice(1).join(":");
    expect(listed.split(" · ")).toHaveLength(3);
    expect(callout.textContent).toContain(`${"x".repeat(40)} ·`);
    expect(callout.textContent).not.toContain("x".repeat(41));
  });
});

// Bug: ages divided the gap between two local midnights by 24 h and floored
// it. Across a spring-forward DST change that gap is 1 h short, so a blocker
// logged three days earlier read "age 2d" and escaped the stale callout.
describe("Scrum of Scrums: ages across a DST change", () => {
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

  it("counts whole calendar days, so a 3-day-old blocker is stale", () => {
    useWorkspaceStore.setState({
      sosEntries: [entry("a", { kind: "blocker", team: "Payments", meetingDate: "2027-03-12" })],
    });
    render(<ScrumOfScrumsClient />);
    expect(screen.getByText("age 3d")).toBeInTheDocument();
    expect(screen.getByText(/^1 blocker aged ≥3 days:$/)).toBeInTheDocument();
  });
});

describe("Scrum of Scrums: export", () => {
  it("exports one CSV row per entry in display order", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry("a", {
          kind: "blocker",
          team: "Payments",
          text: "Keys",
          blockedBy: "Platform",
          status: "resolved",
          resolvedAt: "2026-10-17",
          loggedAt: "2026-10-16T09:00:00.000Z",
        }),
        entry("b", { team: "Search", text: "Facets", loggedAt: "2026-10-17T09:00:00.000Z" }),
      ],
    });
    render(<ScrumOfScrumsClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Team",
      "Kind",
      "Text",
      "Blocked By",
      "Status",
      "Resolved",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["2026-10-18", "Search", "update", "Facets", "", "open", ""],
      ["2026-10-18", "Payments", "blocker", "Keys", "Platform", "resolved", "2026-10-17"],
    ]);
  });
});
