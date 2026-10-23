import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, DependencyMap, SosEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useImpedimentStore } from "@/app/(tools)/impediments/use-impediment-store";

/**
 * Scrum of Scrums as a per-meeting agenda: open blockers and dependencies
 * carry forward by reference, only they can be resolved, a blocker can be
 * raised as an impediment and a dependency put on the Dependency Map (and
 * resolved from either side), entries are edited in place and deleted
 * with Undo, and team names come from the teams already in use.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { ScrumOfScrumsClient } from "@/app/(tools)/scrum-of-scrums/scrum-of-scrums-client";
import {
  ageDays,
  carriedForward,
  entriesOn,
  meetingDates,
  staleBlockers,
  statusOf,
} from "@/app/(tools)/scrum-of-scrums/agenda";
import { meetingVerdict } from "@/app/(tools)/scrum-of-scrums/verdict";
import { toMinutes } from "@/app/(tools)/scrum-of-scrums/markdown";
import { buildExample, withoutExampleEdges } from "@/app/(tools)/scrum-of-scrums/example";
import { emptyEntry, validateEntry } from "@/app/(tools)/scrum-of-scrums/entry-form";
import { edgeForEntry, syncEntryEdge } from "@/app/(tools)/scrum-of-scrums/links";
import { DEPENDENCY_MAP_ID, linkDependency } from "@/app/(tools)/dependency-map/link";
import { dayFrom } from "@/app/(tools)/dependency-map/format";
import { PI_STORAGE_KEY } from "@/app/(tools)/pi-planning/store";

const D1 = "2026-10-16";
const D2 = "2026-10-23";

let n = 0;
const entry = (extra: Partial<SosEntry> = {}): SosEntry => ({
  id: `s${++n}`,
  meetingDate: D1,
  team: "Mobile",
  kind: "update",
  text: `entry ${n}`,
  status: "open",
  loggedAt: `2026-10-16T09:00:${String(n % 60).padStart(2, "0")}.000Z`,
  ...extra,
});
const own = (e: SosEntry) => statusOf(e);

const ws = () => useWorkspaceStore.getState();
const map = (): DependencyMap =>
  (ws().dependencyMaps ?? []).find((d) => d.id === DEPENDENCY_MAP_ID) ?? {
    id: DEPENDENCY_MAP_ID,
    nodes: [],
    edges: [],
  };
const saved = (id: string) => (ws().sosEntries ?? []).find((e) => e.id === id);

const renderSos = () =>
  render(
    <TooltipProvider>
      <ScrumOfScrumsClient />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => act(() => lastToast()[1].action.onClick());
const agenda = () => screen.getByText(/^Agenda — /).closest(".rounded-xl") as HTMLElement;

beforeEach(() => {
  n = 0;
  toastSpy.mockReset();
  localStorage.clear();
  useImpedimentStore.setState({ impediments: [] });
  useWorkspaceStore.setState({
    sosEntries: [],
    dependencyMaps: [],
    impediments: [],
    teamMembers: [],
  });
});

/* ── Agenda logic ─────────────────────────────────────────────────────── */

describe("tracked and untracked entries", () => {
  it("gives only blockers and dependencies a status; old open updates aren't open items", () => {
    expect(statusOf(entry({ kind: "update", status: "open" }))).toBeNull();
    expect(statusOf(entry({ kind: "decision", status: "resolved" }))).toBeNull();
    expect(statusOf(entry({ kind: "blocker" }))).toBe("open");
    expect(statusOf(entry({ kind: "blocker", status: "resolved" }))).toBe("resolved");
  });

  it("lets a dependency on the map follow its edge", () => {
    const dep = entry({ kind: "dependency", status: "open" });
    const edge = {
      id: "e",
      from: "a",
      to: "b",
      kind: "needs",
      status: "resolved",
    } as DependencyEdge;
    expect(statusOf(dep, edge)).toBe("resolved");
    expect(statusOf({ ...dep, status: "resolved" }, { ...edge, status: "at-risk" })).toBe("open");
  });
});

describe("meetings and carry-forward", () => {
  const blocker = entry({ kind: "blocker", meetingDate: D1 });
  const fixed = entry({ kind: "blocker", meetingDate: D1, status: "resolved" });
  const update = entry({ kind: "update", meetingDate: D1 });
  const dep = entry({ kind: "dependency", meetingDate: D1, blockedBy: "Payments" });
  const today = entry({ kind: "decision", meetingDate: D2 });
  const all = [today, update, blocker, fixed, dep];

  it("lists meetings newest first, with started ones and without malformed dates", () => {
    expect(meetingDates([...all, entry({ meetingDate: "garbage" })], ["2026-10-30", D2])).toEqual([
      "2026-10-30",
      D2,
      D1,
    ]);
  });

  it("groups a meeting in agenda order, oldest logged first", () => {
    expect(entriesOn(all, D1).map((g) => [g.kind, g.entries.map((e) => e.id)])).toEqual([
      ["blocker", [blocker.id, fixed.id]],
      ["dependency", [dep.id]],
      ["update", [update.id]],
    ]);
    expect(entriesOn(all, "2026-01-01")).toEqual([]);
  });

  it("carries open blockers and dependencies forward as the same entries", () => {
    const carried = carriedForward(all, D2, own);
    expect(carried).toEqual([blocker, dep]);
    expect(carried[0]).toBe(blocker); // a reference, not a copy
    expect(carriedForward(all, D1, own)).toEqual([]);
  });

  it("ages from the day raised and calls 3 days stale", () => {
    expect(ageDays(blocker, D2)).toBe(7);
    expect(ageDays(entry({ meetingDate: "2026-10-30" }), D2)).toBe(0);
    expect(ageDays(entry({ meetingDate: "nope" }), D2)).toBeNull();
    expect(staleBlockers(all, D2, own)).toEqual([blocker]);
    expect(staleBlockers(all, "2026-10-18", own)).toEqual([]);
  });
});

describe("verdict and minutes", () => {
  it("sums up what's open on the agenda and what the meeting recorded", () => {
    expect(meetingVerdict([], D2, D2, own)).toBe("Nothing logged for this meeting yet.");
    const ex = buildExample(new Date(2026, 9, 23));
    expect(meetingVerdict(ex, D2, D2, own)).toBe(
      "2 open blockers (1 raised 3 or more days ago) and 2 open dependencies on the agenda; 1 decision and 1 update recorded."
    );
    expect(meetingVerdict([entry({ kind: "decision", meetingDate: D2 })], D2, D2, own)).toBe(
      "No open blockers or dependencies; 1 decision recorded."
    );
  });

  it("writes minutes with carried-forward items first", () => {
    const md = toMinutes(buildExample(new Date(2026, 9, 23)), D2, D2, own);
    expect(md).toContain("# Scrum of Scrums — 23 Oct 2026");
    expect(md).toContain(
      "- Blocker · **Mobile**: Waiting on the push-notification certificates (blocked by Platform) — Open, raised 16 Oct 2026 (7 days)"
    );
    expect(md).not.toContain("Warehouse credentials expired");
    expect(md).toContain("## Decisions\n\n- **Mobile**: Ship the iOS release without saved cards");
    expect(md.indexOf("## Carried forward")).toBeLessThan(md.indexOf("## Blockers"));
  });
});

describe("validation", () => {
  it("needs a date, team, kind and text, and a dependency names who it waits on", () => {
    expect(validateEntry(emptyEntry(""))).toEqual({
      ok: false,
      errors: {
        meetingDate: "Pick the meeting date.",
        team: "Name the team.",
        kind: "Pick what kind of entry it is.",
        text: "Say what it is.",
      },
    });
    const base = { ...emptyEntry(D2), team: "Mobile", text: "x" };
    expect(validateEntry({ ...base, kind: "dependency" })).toMatchObject({
      errors: { blockedBy: "Name the team it waits on." },
    });
    expect(validateEntry({ ...base, kind: "blocker", blockedBy: " mobile " })).toMatchObject({
      errors: { blockedBy: "Pick another team: a team can't wait on itself." },
    });
    // A blocker's "blocked by" is optional; an update never keeps one.
    expect(validateEntry({ ...base, kind: "blocker" })).toMatchObject({ ok: true });
    expect(validateEntry({ ...base, kind: "update", blockedBy: "Payments" })).toEqual({
      ok: true,
      values: { meetingDate: D2, team: "Mobile", kind: "update", text: "x" },
    });
  });
});

describe("links to the Dependency Map", () => {
  it("finds the entry's own edge, or one another tool drew between the same teams", () => {
    const dep = entry({ kind: "dependency", team: "Checkout", blockedBy: "Payments" });
    expect(edgeForEntry(map(), dep)).toBeUndefined();
    const { edgeId } = linkDependency({
      from: "Checkout",
      to: "Payments",
      sourceRef: { tool: "pi-planning", id: "p1" },
    });
    expect(edgeForEntry(map(), dep)?.id).toBe(edgeId);
    expect(edgeForEntry(map(), { ...dep, kind: "blocker" })).toBeUndefined();
  });

  it("moves its own edge when the teams change, and drops it when it stops being a dependency", () => {
    const dep = entry({ kind: "dependency", team: "Checkout", blockedBy: "Payments" });
    linkDependency({
      from: "Checkout",
      to: "Payments",
      note: "x",
      sourceRef: { tool: "scrum-of-scrums", id: dep.id },
    });
    const moved = { ...dep, blockedBy: "Platform" };
    syncEntryEdge(dep, moved);
    expect(map().edges).toHaveLength(1);
    expect(edgeForEntry(map(), moved)?.note).toBe("x");
    const label = (id: string) => map().nodes.find((x) => x.id === id)?.label;
    expect(label(map().edges[0].to)).toBe("Platform");
    syncEntryEdge(moved, { ...moved, kind: "update" });
    expect(map().edges).toEqual([]);
  });

  it("clears only edges drawn from example entries", () => {
    const graph = {
      nodes: [],
      edges: [
        {
          id: "1",
          from: "a",
          to: "b",
          kind: "needs",
          sourceRef: { tool: "scrum-of-scrums", id: "example-sos-2" },
        },
        {
          id: "2",
          from: "a",
          to: "b",
          kind: "needs",
          sourceRef: { tool: "scrum-of-scrums", id: "mine" },
        },
        { id: "3", from: "a", to: "b", kind: "needs" },
      ] as DependencyEdge[],
    };
    expect(withoutExampleEdges(graph).edges.map((e) => e.id)).toEqual(["2", "3"]);
  });
});

/* ── The page ─────────────────────────────────────────────────────────── */

describe("Scrum of Scrums page", () => {
  const today = () => todayLocalISO();

  it("loads the example, carries last week's open items into today's agenda, and clears it", () => {
    renderSos();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(ws().sosEntries).toHaveLength(9);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    const carried = within(agenda()).getByRole("list", { name: "Carried forward" });
    expect(within(carried).getAllByRole("listitem")).toHaveLength(2);
    expect(carried).toHaveTextContent("Waiting on the push-notification certificates");
    expect(carried).not.toHaveTextContent("Warehouse credentials expired");
    expect(
      within(agenda()).getByText(
        "2 open blockers (1 raised 3 or more days ago) and 2 open dependencies on the agenda; 1 decision and 1 update recorded."
      )
    ).toBeInTheDocument();

    ws().upsertSosEntry(entry({ id: "mine", meetingDate: today() }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect((ws().sosEntries ?? []).map((e) => e.id)).toEqual(["mine"]);
  });

  it("logs an entry only once it's complete, with teams from SoS and PI Planning suggested", () => {
    localStorage.setItem(
      PI_STORAGE_KEY,
      JSON.stringify({
        teams: [{ id: "t", name: "Platform", velocity: 10 }],
        items: [],
        iterations: 3,
      })
    );
    useWorkspaceStore.setState({ sosEntries: [entry({ team: "Checkout", meetingDate: today() })] });
    renderSos();
    const form = screen.getByRole("button", { name: "Log entry" }).closest("form")!;
    const team = within(form).getByLabelText(/^Team/);
    const options = Array.from(document.getElementById(team.getAttribute("list")!)!.children).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(options).toEqual(["Checkout", "Platform"]);

    fireEvent.change(team, { target: { value: "Mobile" } });
    fireEvent.change(within(form).getByLabelText(/^Details/), { target: { value: "Push certs" } });
    fireEvent.submit(form);
    expect(within(form).getByText("Pick what kind of entry it is.")).toBeInTheDocument();
    expect(ws().sosEntries).toHaveLength(1);
    fireEvent.click(within(form).getByRole("radio", { name: "Dependency" }));
    fireEvent.submit(form);
    expect(within(form).getByText("Name the team it waits on.")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Waits on/), { target: { value: "Platform" } });
    fireEvent.submit(form);
    expect(ws().sosEntries).toHaveLength(2);
    expect(ws().sosEntries![1]).toMatchObject({
      meetingDate: today(),
      team: "Mobile",
      kind: "dependency",
      text: "Push certs",
      blockedBy: "Platform",
      status: "open",
    });
  });

  it("offers Resolve only on blockers and dependencies", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry({ kind: "decision", text: "Freeze on Thursdays", meetingDate: today() }),
        entry({ kind: "update", text: "Webhooks in staging", meetingDate: today() }),
        entry({ kind: "blocker", text: "Sandbox down", meetingDate: today() }),
      ],
    });
    renderSos();
    const resolves = within(agenda()).getAllByRole("button", { name: /^Resolve / });
    expect(resolves).toHaveLength(1);
    fireEvent.click(resolves[0]);
    expect(saved("s3")).toMatchObject({ status: "resolved", resolvedAt: today() });
    fireEvent.click(within(agenda()).getByRole("button", { name: /^Reopen blocker/ }));
    expect(saved("s3")?.status).toBe("open");
    expect(saved("s3")?.resolvedAt).toBeUndefined();
  });

  it("resolves a carried-forward blocker once, from the later meeting", () => {
    const old = dayFrom(new Date(), -7);
    useWorkspaceStore.setState({
      sosEntries: [
        entry({ kind: "blocker", text: "Push certs", meetingDate: old }),
        entry({ kind: "update", text: "Today", meetingDate: today() }),
      ],
    });
    renderSos();
    const carried = within(agenda()).getByRole("list", { name: "Carried forward" });
    expect(carried).toHaveTextContent("open 7 days");
    fireEvent.click(within(carried).getByRole("button", { name: /^Resolve blocker/ }));
    expect(saved("s1")?.status).toBe("resolved");
    expect(
      within(agenda()).queryByRole("list", { name: "Carried forward" })
    ).not.toBeInTheDocument();
  });

  it("raises a blocker as an impediment that links back, with Undo", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry({ kind: "blocker", text: "Sandbox down", team: "Payments", meetingDate: today() }),
      ],
    });
    renderSos();
    fireEvent.click(screen.getByRole("button", { name: "Raise impediment: Sandbox down" }));
    expect(ws().impediments).toMatchObject([
      { title: "Sandbox down", sourceRef: { tool: "scrum-of-scrums", id: "s1" } },
    ]);
    expect(
      screen.getByRole("link", { name: "Raised as an impediment · open" })
    ).toBeInTheDocument();
    undoLast();
    expect(ws().impediments).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Raise impediment: Sandbox down" })
    ).toBeInTheDocument();
  });

  it("adds a dependency to the map and resolves it from either side", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry({
          kind: "dependency",
          text: "Refund API",
          team: "Checkout",
          blockedBy: "Payments",
          meetingDate: today(),
        }),
      ],
    });
    renderSos();
    fireEvent.click(
      screen.getByRole("button", { name: "Add dependency to the map: Checkout needs Payments" })
    );
    expect(map().edges).toMatchObject([
      {
        kind: "needs",
        status: "open",
        note: "Refund API",
        sourceRef: { tool: "scrum-of-scrums", id: "s1" },
      },
    ]);
    expect(screen.getByRole("link", { name: "On the Dependency Map" })).toBeInTheDocument();

    // Resolved on the map: the agenda shows it resolved.
    act(() =>
      ws().upsertDependencyMap({
        ...map(),
        edges: map().edges.map((e) => ({ ...e, status: "resolved" as const })),
      })
    );
    expect(
      within(agenda()).getByRole("button", { name: /^Reopen dependency/ })
    ).toBeInTheDocument();
    // Reopened here: the map edge reopens too.
    fireEvent.click(within(agenda()).getByRole("button", { name: /^Reopen dependency/ }));
    expect(map().edges[0].status).toBe("open");
    expect(saved("s1")?.status).toBe("open");
  });

  it("edits an entry in place and deletes it with Undo, its own edge too", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry({
          kind: "dependency",
          text: "Refund API",
          team: "Checkout",
          blockedBy: "Payments",
          meetingDate: today(),
        }),
      ],
    });
    renderSos();
    fireEvent.click(screen.getByRole("button", { name: /^Add dependency to the map/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit dependency “Refund API”" }));
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const details = within(form).getByLabelText(/^Details/);
    expect(details).toHaveFocus();
    fireEvent.change(details, { target: { value: "Refund API v2" } });
    fireEvent.submit(form);
    expect(saved("s1")?.text).toBe("Refund API v2");

    fireEvent.click(screen.getByRole("button", { name: "Delete dependency “Refund API v2”" }));
    expect(ws().sosEntries).toEqual([]);
    expect(map().edges).toEqual([]);
    expect(lastToast()[0]).toBe("Deleted dependency “Refund API v2”");
    undoLast();
    expect(saved("s1")?.text).toBe("Refund API v2");
    expect(map().edges).toHaveLength(1);
  });

  it("starts a backdated meeting that carries open items forward to it", () => {
    useWorkspaceStore.setState({
      sosEntries: [
        entry({ kind: "blocker", text: "Push certs", meetingDate: "2026-09-01" }),
        entry({ kind: "update", text: "Later news", meetingDate: today() }),
      ],
    });
    renderSos();
    fireEvent.change(screen.getByLabelText(/^New meeting on/), { target: { value: "2026-09-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a meeting" }));
    // ICU spells September "Sep" or "Sept" depending on its version.
    expect(screen.getByText(/^Agenda — 8 Sept? 2026$/)).toBeInTheDocument();
    expect(within(agenda()).getByRole("list", { name: "Carried forward" })).toHaveTextContent(
      "Push certs"
    );
    expect(agenda()).not.toHaveTextContent("Later news");
    // The add form now logs to that meeting.
    const form = screen.getByRole("button", { name: "Log entry" }).closest("form")!;
    expect(within(form).getByLabelText(/^Meeting date/)).toHaveValue("2026-09-08");

    fireEvent.change(screen.getByLabelText(/^Show meeting/), { target: { value: "2026-09-01" } });
    expect(screen.getByText(/^Agenda — 1 Sept? 2026$/)).toBeInTheDocument();
  });
});
