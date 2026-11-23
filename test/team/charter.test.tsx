import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard, Sprint } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { SELECTED_SPRINT_KEY } from "@/lib/sprints/use-selected-sprint";
import { useRefinementStore } from "@/app/(tools)/refinement/store";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { DOD_STORAGE_KEY } from "@/app/(tools)/dod-builder/summary";

/**
 * Team charter: each standing agreement as a card that reads the tool's
 * own data, the ceremony times editable in place (with the current sprint's
 * ceremonies as a calendar file), and the export.
 */

vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const calendars = vi.hoisted(() => [] as { ics: string; filename: string }[]);
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  exportToICS: (ics: string, filename: string) => calendars.push({ ics, filename }),
}));
const cadence = vi.hoisted(() => ({ patches: [] as unknown[] }));
vi.mock("@/lib/sprints/use-ceremony-cadence", async () => {
  const { DEFAULT_CADENCE } = await import("@/lib/sprints/cadence");
  return {
    useCeremonyCadence: () => [DEFAULT_CADENCE, (patch: unknown) => cadence.patches.push(patch)],
  };
});

import { TeamCharter } from "@/app/(meta)/team/charter";

const sprint = (id: string, name: string, extra: Partial<Sprint>): Sprint => ({
  id,
  name,
  startDate: "",
  endDate: "",
  pointsPlanned: 10,
  status: "planned",
  ...extra,
});
const actionCard = (id: string, extra: Partial<RetroCard> = {}): RetroCard => ({
  id,
  columnKey: "start",
  text: id,
  votes: 0,
  groupedWith: null,
  isActionItem: true,
  assignee: "",
  discussing: false,
  ...extra,
});
const currentRetro = (cards: RetroCard[]): RetroBoard => ({
  id: "retro:current",
  format: retroFormats[0],
  phase: "actions",
  cards,
  userVotes: 0,
  timerSeconds: 0,
  timerRunning: false,
  discussingIndex: 0,
});

beforeEach(() => {
  // Monday 12 Oct 2026, so the October sprints below have ceremonies to come.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0));
  cadence.patches.length = 0;
  calendars.length = 0;
  window.localStorage.clear();
  useWorkspaceStore.setState({
    teamMembers: [{ id: "m1", name: "Ann", role: "Dev" }],
    workingAgreements: [
      {
        id: "workingAgreement:current",
        rules: [
          { id: "r1", category: "communication", text: "Core hours 10–15", agreedBy: ["Ann"] },
        ],
        meta: { version: 1 },
      },
    ],
  });
  useRefinementStore.setState({
    criteria: [
      { id: "c1", label: "Acceptance criteria defined" },
      { id: "c2", label: "Estimated by team" },
      { id: "c3", label: "Fits in a sprint" },
    ],
    history: [],
  });
  useEstimationGuideStore.setState({
    selectedScale: "Fibonacci",
    descriptions: { "Fibonacci:1": "Our tiniest change" },
    examples: {},
    referenceStoryIds: {},
  });
  window.localStorage.setItem(
    DOD_STORAGE_KEY,
    JSON.stringify({
      items: [{ id: "d1", label: "Code reviewed", category: "code", required: true }],
      history: [],
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  useWorkspaceStore.setState({
    teamMembers: [],
    workingAgreements: [],
    stories: [],
    sprints: [],
    retroBoards: [],
  });
});

describe("TeamCharter", () => {
  it("shows one card per agreement, read from each tool's data", async () => {
    render(<TeamCharter />);
    const list = screen.getByRole("list", { name: "Charter documents" });
    const card = (id: string) => list.querySelector(`[data-charter="${id}"]`) as HTMLElement;

    expect(card("agreement")).toHaveTextContent("1 rule · 1 with everyone's consent");
    // The stored "version 1" was never published (no date, no snapshot).
    expect(card("agreement")).toHaveTextContent("Not published yet");
    expect(within(card("agreement")).getByRole("link", { name: /Open/ })).toHaveAttribute(
      "href",
      "/working-agreement"
    );
    expect(card("dor")).toHaveTextContent("3 checks");
    expect(card("estimation")).toHaveTextContent(/Fibonacci · 1 of \d+ values in the team's words/);
    // The DoD blob is read from storage after mount.
    expect(await within(card("dod")).findByText("1 criterion · 1 required")).toBeInTheDocument();
  });

  it("offers to write an agreement that doesn't exist yet", () => {
    useWorkspaceStore.setState({ workingAgreements: [] });
    render(<TeamCharter />);
    const card = screen
      .getByRole("list", { name: "Charter documents" })
      .querySelector('[data-charter="agreement"]') as HTMLElement;
    expect(card).toHaveTextContent("No rules agreed yet");
    expect(within(card).getByRole("link", { name: /Write it/ })).toBeInTheDocument();
  });

  it("reads refinement checks on the stories and lists the guide's pinned stories", async () => {
    useWorkspaceStore.setState({
      stories: [
        {
          id: "s1",
          title: "Refund an order",
          status: "done",
          points: 8,
          readiness: {
            checked: ["c1", "c2", "c3"],
            ready: true,
            updatedAt: new Date(2026, 9, 20, 12).toISOString(),
          },
        },
        {
          id: "s2",
          title: "Split a bill",
          status: "backlog",
          readiness: {
            checked: [],
            ready: false,
            updatedAt: new Date(2026, 9, 21, 12).toISOString(),
          },
        },
      ],
    });
    // The example's pin on 8 is the guide's sample, not the team's.
    useEstimationGuideStore.setState({
      referenceStoryIds: { "Fibonacci:8": ["s1", "example-guide-ref-8"] },
    });
    render(<TeamCharter />);
    const list = screen.getByRole("list", { name: "Charter documents" });
    const card = (id: string) => list.querySelector(`[data-charter="${id}"]`) as HTMLElement;

    expect(card("dor")).toHaveTextContent("50% pass rate over the last 2 stories");
    expect(card("estimation")).toHaveTextContent("1 reference story on 1 card");
    const refs = within(card("estimation")).getByRole("list", {
      name: "Reference stories by card",
    });
    expect(within(refs).getAllByRole("listitem")).toHaveLength(1);
    expect(refs).toHaveTextContent("Card 8Refund an order");
    expect(within(refs).getByRole("link", { name: "Refund an order" })).toHaveAttribute(
      "href",
      "/estimation-guide"
    );

    await screen.findByText("1 criterion · 1 required");
    expect(screen.getByTestId("export-markdown").textContent).toContain(" |  | Refund an order |");
  });

  it("reports the DoD on the latest completed sprint's done stories", async () => {
    useWorkspaceStore.setState({
      sprints: [
        {
          id: "sp7",
          name: "Sprint 7",
          startDate: "2026-10-01",
          endDate: "2026-10-14",
          pointsPlanned: 10,
          status: "completed",
        },
      ],
      stories: [
        {
          id: "s1",
          title: "Refund an order",
          status: "done",
          sprintId: "sp7",
          dodChecks: { checked: ["d1"], updatedAt: "2026-10-10T12:00:00.000Z" },
        },
        { id: "s2", title: "Split a bill", status: "done", sprintId: "sp7" },
      ],
    });
    render(<TeamCharter />);
    const card = screen
      .getByRole("list", { name: "Charter documents" })
      .querySelector('[data-charter="dod"]') as HTMLElement;
    expect(
      await within(card).findByText("Sprint 7: 1 of 2 done stories meet it")
    ).toBeInTheDocument();
  });

  it("edits the ceremony times in place", () => {
    render(<TeamCharter />);
    fireEvent.change(screen.getByLabelText("Sprint Review"), { target: { value: "15:00" } });
    expect(cadence.patches).toContainEqual({ reviewTime: "15:00" });
  });

  it("adds the active sprint's ceremonies to a calendar, with the open retro actions", () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint("sp7", "Sprint 7", {
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          status: "completed",
        }),
        // Monday 19 to Friday 30 Oct: 14 ceremonies on the default times.
        sprint("sp8", "Sprint 8", {
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          status: "active",
        }),
        sprint("sp9", "Sprint 9", { startDate: "2026-11-02", endDate: "2026-11-13" }),
      ],
      retroBoards: [
        currentRetro([
          actionCard("act-open", { text: "Pair on the flaky test", dueDate: "2026-10-28" }),
          actionCard("act-done", { dueDate: "2026-10-27", done: true }),
          actionCard("act-undated"),
        ]),
      ],
    });
    render(<TeamCharter />);
    const button = screen.getByRole("button", { name: "Add to calendar" });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(/the 14 ceremonies of Sprint 8/);
    expect(screen.getByRole("checkbox", { name: /Open retro actions/ })).toBeChecked();
    expect(screen.getByText(/The file is a snapshot/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(calendars).toHaveLength(1);
    expect(calendars[0].filename).toBe("sprint-8-ceremonies");
    const { ics } = calendars[0];
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(1 + 14 + 1);
    expect(ics).toContain("UID:sprint-sp8-planning-20261019@agile.amrelharony.com");
    expect(ics).toContain("UID:retro-action-act-open@agile.amrelharony.com");
    expect(ics).not.toContain("act-done");
    expect(ics).not.toContain("act-undated");
  });

  it("offers the planned sprint between sprints, not the one just completed", () => {
    // Saturday 17 Oct: Sprint 7 ended yesterday.
    vi.setSystemTime(new Date(2026, 9, 17, 9, 0, 0));
    const sp7 = sprint("sp7", "Sprint 7", {
      startDate: "2026-10-05",
      endDate: "2026-10-16",
      status: "completed",
    });
    // Planned, with dates.
    useWorkspaceStore.setState({
      sprints: [sp7, sprint("sp8", "Sprint 8", { startDate: "2026-10-19", endDate: "2026-10-30" })],
    });
    const { unmount } = render(<TeamCharter />);
    const button = () => screen.getByRole("button", { name: "Add to calendar" });
    expect(button()).toBeEnabled();
    expect(button()).toHaveAccessibleDescription(/the 14 ceremonies of Sprint 8/);
    unmount();

    // Planned without dates yet: the card asks for them, rather than offering Sprint 7.
    useWorkspaceStore.setState({ sprints: [sp7, sprint("sp8", "Sprint 8", {})] });
    render(<TeamCharter />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "Sprint 8 has no dates, so its ceremonies can’t go on a calendar. Set its first and last day in the Sprint Cockpit."
    );
  });

  it("says a completed sprint's ceremonies are past when there is no other", () => {
    vi.setSystemTime(new Date(2026, 9, 17, 9, 0, 0));
    useWorkspaceStore.setState({
      sprints: [
        sprint("sp7", "Sprint 7", {
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          status: "completed",
        }),
        sprint("sp8", "Sprint 8", {
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          status: "cancelled",
        }),
      ],
    });
    render(<TeamCharter />);
    const button = screen.getByRole("button", { name: "Add to calendar" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "Every ceremony of Sprint 7 is in the past, so there is nothing to add to a calendar. Plan the next sprint in the Sprint Cockpit."
    );
    fireEvent.click(button);
    expect(calendars).toEqual([]);
  });

  it("says every sprint is cancelled rather than that there is none", () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint("sp7", "Sprint 7", {
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          status: "cancelled",
        }),
        sprint("sp8", "Sprint 8", {
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          status: "cancelled",
        }),
      ],
    });
    render(<TeamCharter />);
    const button = screen.getByRole("button", { name: "Add to calendar" });
    expect(button).toBeDisabled();
    // The newest, as the cockpit opens on it.
    expect(button).toHaveAccessibleDescription(
      "Sprint 8 was cancelled, so it has no ceremonies to add. Create a new sprint in the Sprint Cockpit."
    );
    fireEvent.click(button);
    expect(calendars).toEqual([]);
  });

  it("disables Add to calendar, with the reason, without a sprint or its dates", () => {
    const { unmount } = render(<TeamCharter />);
    const button = () => screen.getByRole("button", { name: "Add to calendar" });
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "There is no sprint yet, so there are no ceremonies to add. Create one in the Sprint Cockpit."
    );
    unmount();

    useWorkspaceStore.setState({ sprints: [sprint("sp1", "Sprint 1", { status: "active" })] });
    render(<TeamCharter />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "Sprint 1 has no dates, so its ceremonies can’t go on a calendar. Set its first and last day in the Sprint Cockpit."
    );
    expect(screen.queryByRole("checkbox", { name: /Open retro actions/ })).toBeNull();
    fireEvent.click(button());
    expect(calendars).toEqual([]);
  });

  it("links a sprint without dates to the cockpit opened on that sprint", () => {
    // The cockpit opens on the sprint this browser last picked: here, an older one.
    window.localStorage.setItem(SELECTED_SPRINT_KEY, "sp0");
    useWorkspaceStore.setState({
      sprints: [
        sprint("sp0", "Sprint 0", {
          startDate: "2026-10-05",
          endDate: "2026-10-16",
          status: "completed",
        }),
        sprint("sp1", "Sprint 1", { status: "active" }),
      ],
    });
    render(<TeamCharter />);
    const reason = screen.getByText(/Sprint 1 has no dates/);
    expect(within(reason).getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute(
      "href",
      "/sprint?sprint=sp1"
    );
  });

  it("exports the charter with every section", async () => {
    render(<TeamCharter />);
    await screen.findByText("1 criterion · 1 required");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Team charter");
    expect(md).toContain("- Ann (Dev)");
    expect(md).toContain("- Core hours 10–15 _(communication)_ — agreed by Ann");
    expect(md).toContain("- Fits in a sprint");
    expect(md).toContain("- Code reviewed");
    expect(md).toContain("| 1 | Our tiniest change |  |");
  });
});
