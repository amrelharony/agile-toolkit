import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  WORKING_AGREEMENT_ID,
  type TeamTimePoll,
  type TeamTimeRotation,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { TEAM_TIME_ACTIONS } from "@/lib/history/event-actions";
import { canonicalZone } from "@/lib/team-time/zones";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";
import { london, newYork, tokyo } from "../team-time/fixtures";

/**
 * Team Time on workspace.teamTimePeople / teamTimePolls / teamTimeRotations:
 * the empty state and the example (in memory only: it never reaches the
 * workspace, and nothing is logged), the roster's people with "Set time
 * zone", the zone check, one row per person, edit and delete with Undo; the
 * shared hours as strips and as a list, the core-hours band and the tips
 * without AI; a poll created, answered (even after its times have passed),
 * filled from hours and chosen with Undo, its Quick Vote link and calendar
 * file; a rotation planned, held and skipped; the office days; the export
 * and Clear with Undo. Times are shown in UTC throughout, so the machine's
 * own zone never matters.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as unknown[][]);
const ics = vi.hoisted(() => [] as { text: string; name: string }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/team-time",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/utils/export", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/export")>();
  return {
    ...actual,
    exportToICS: (text: string, name: string) => ics.push({ text, name }),
  };
});
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { TeamTimeClient } from "@/app/(tools)/team-time/team-time-client";

const ws = () => useWorkspaceStore.getState();
const AT = "2026-11-16T00:00:00.000Z";
const FAR = "2031-03-04T14:00:00.000Z";
const FAR2 = "2031-03-05T14:00:00.000Z";

const poll = (over: Partial<TeamTimePoll> = {}): TeamTimePoll => ({
  id: "poll1",
  title: "Review",
  minutes: 60,
  slots: [
    { id: "a", start: FAR },
    { id: "b", start: FAR2 },
  ],
  answers: [],
  status: "open",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const rotation = (over: Partial<TeamTimeRotation> = {}): TeamTimeRotation => ({
  id: "rot1",
  meeting: "Retro",
  minutes: 60,
  everyWeeks: 1,
  startDate: "2026-11-16",
  mode: "in-turn",
  options: [
    { id: "A", label: "Europe morning", weekday: 2, time: "09:00", timeZone: "Europe/London" },
    {
      id: "B",
      label: "Americas afternoon",
      weekday: 2,
      time: "15:00",
      timeZone: "America/New_York",
    },
  ],
  held: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

type Tab = "people" | "shared" | "find" | "rotate" | "office";
/** The page's own view (this browser): times in UTC, on `tab`. */
const seedView = (tab: Tab = "people") =>
  localStorage.setItem(
    "agile-toolkit:team-time",
    JSON.stringify({ state: { displayZone: "UTC", tab, weekOffset: 0 }, version: 0 })
  );

/** The page on `tab`, once it has loaded (role queries over the whole page are slow). */
const renderPage = async (tab: Tab = "people") => {
  seedView(tab);
  const view = render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <TeamTimeClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
  await screen.findByRole("tab", { name: "People" }, { timeout: 5000 });
  return view;
};

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const logged = (action: string) => logs.filter((l) => l.action === action);
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  ics.length = 0;
  localStorage.clear();
  useWorkspaceStore.setState({
    teamTimePeople: [],
    teamTimePolls: [],
    teamTimeRotations: [],
    teamMembers: [],
    ceremonyCadences: [],
    workingAgreements: [],
    meetingAudits: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the empty page and the example", () => {
  it("says where to start and loads the example in memory only, logging nothing", async () => {
    await renderPage();
    expect(await screen.findByText(/No one's time zone yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      await screen.findByText(/Example: a checkout team from Toronto to Sydney/)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Priya (PM)").length).toBeGreaterThan(0);
    expect(ws().teamTimePeople).toEqual([]);
    expect(ws().teamTimePolls).toEqual([]);
    expect(ws().teamTimeRotations).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("changes only the example while it is loaded, and clears it with Undo", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Priya (PM)" }));
    expect(screen.queryByRole("button", { name: "Remove Priya (PM)" })).toBeNull();
    expect(ws().teamTimePeople).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(await screen.findByText(/No one's time zone yet/)).toBeInTheDocument();
    undoLast();
    expect(await screen.findByText(/Example: a checkout team/)).toBeInTheDocument();
    expect(logs).toEqual([]);
  });

  it("shows the example's all-but-one window and the London anchor day", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    tab("Shared hours");
    expect(
      await screen.findByText(/All but Lee \(iOS\): 13:00–14:00 UTC, Mon–Thu/)
    ).toBeInTheDocument();
    tab("Office days");
    expect(await screen.findByText(/Anchor day: Thu, when 2 of 2 are in/)).toBeInTheDocument();
  });
});

describe("People", () => {
  it("lists the roster with Set time zone, and saves a row linked to the member", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Lee" }] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Set time zone for Lee" }));
    const form = screen.getByRole("form", { name: "Person" });
    fireEvent.change(within(form).getByLabelText(/Time zone/), { target: { value: "Asia/Tokyo" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    const [row] = ws().teamTimePeople ?? [];
    expect(row).toMatchObject({
      teamMemberId: "m1",
      name: "Lee",
      timeZone: canonicalZone("Asia/Tokyo"),
      start: "09:00",
      end: "17:00",
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(row.id).toMatch(/^ttp_/);
    expect(logged(TEAM_TIME_ACTIONS.PERSON_SAVED)).toEqual([
      { action: "person_saved", payload: { personId: row.id, people: 1 } },
    ]);
    expect(
      await screen.findByText(/Now (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/)
    ).toBeInTheDocument();
  });

  it("refuses a zone it doesn't know and puts focus on it", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add someone" }));
    const form = screen.getByRole("form", { name: "Person" });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: "Ana" } });
    const zone = within(form).getByLabelText(/Time zone/);
    fireEvent.change(zone, { target: { value: "Mars/Base" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(await within(form).findByText(/isn't a time zone/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(zone));
    expect(ws().teamTimePeople).toEqual([]);
  });

  it("offers matching zones for a typed city", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add someone" }));
    const form = screen.getByRole("form", { name: "Person" });
    const zone = within(form).getByLabelText(/Time zone/);
    fireEvent.change(zone, { target: { value: "toky" } });
    fireEvent.click(within(form).getByRole("button", { name: /^Tokyo/ }));
    expect(zone).toHaveValue(canonicalZone("Asia/Tokyo"));
  });

  it("keeps one row per person", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add someone" }));
    const form = screen.getByRole("form", { name: "Person" });
    fireEvent.change(within(form).getByLabelText(/^Name/), { target: { value: "lou" } });
    fireEvent.change(within(form).getByLabelText(/Time zone/), { target: { value: "UTC" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(await within(form).findByText(/already has a row/)).toBeInTheDocument();
    expect(ws().teamTimePeople).toHaveLength(1);
  });

  it("edits a person's hours, and lets office days be working days only", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Lou" }));
    const form = screen.getByRole("form", { name: "Person" });
    const office = within(form).getByRole("group", { name: "Office days" });
    expect(within(office).getByRole("checkbox", { name: "Sat" })).toBeDisabled();
    fireEvent.click(within(office).getByRole("checkbox", { name: "Thu" }));
    fireEvent.change(within(form).getByLabelText(/Day starts/), { target: { value: "08:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(ws().teamTimePeople?.[0]).toMatchObject({
      id: "london",
      start: "08:00",
      officeDays: [4],
    });
  });

  it("removes a person with Undo", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove Lou" }));
    expect(ws().teamTimePeople?.map((p) => p.id)).toEqual(["ny"]);
    expect(logged(TEAM_TIME_ACTIONS.PERSON_REMOVED)).toEqual([
      { action: "person_removed", payload: { personId: "london" } },
    ]);
    undoLast();
    expect(
      ws()
        .teamTimePeople?.map((p) => p.id)
        .sort()
    ).toEqual(["london", "ny"]);
  });
});

describe("Shared hours", () => {
  it("lists the week's windows and draws a strip per person", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage("shared");
    expect(await screen.findByText("Everyone: 14:00–17:30 UTC, Mon–Fri")).toBeInTheDocument();
    const strips = screen.getAllByRole("img");
    expect(strips.map((s) => s.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Lou: /), expect.stringMatching(/^Noor: /)])
    );
    expect(screen.getByRole("link", { name: "Make these your core hours" })).toHaveAttribute(
      "href",
      "/working-agreement?template=core-hours"
    );
  });

  it("names who is left out of the all-but-one window", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork, tokyo] });
    await renderPage("shared");
    expect(await screen.findByText("All but Taro: 14:00–17:30 UTC, Mon–Fri")).toBeInTheDocument();
  });

  it("draws the charter's core hours when the template is applied", async () => {
    const agreement = {
      id: WORKING_AGREEMENT_ID,
      rules: [],
      meta: { version: 0 },
      templates: {
        coreHours: {
          start: "14:00",
          end: "16:00",
          timeZone: "UTC",
          days: [0, 1, 2, 3, 4, 5, 6],
          purposes: ["meetings"],
          appliedAt: AT,
        },
      },
    } as unknown as WorkingAgreement;
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      workingAgreements: [agreement],
    });
    await renderPage("shared");
    expect(
      await screen.findByRole("img", { name: /^Core hours: 14:00–16:00/ })
    ).toBeInTheDocument();
  });

  it("writes tips without AI, from the places and the shared time", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage("shared");
    fireEvent.click(screen.getByRole("button", { name: "Get tips" }));
    expect(await screen.findByText("Written without AI")).toBeInTheDocument();
    expect(
      screen.getByText(/^The team works in 2 places, from London to New York/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/^Keep the team's meetings inside the shared hours/)
    ).toBeInTheDocument();
    expect(ws().teamTimePeople).toHaveLength(2);
    expect(logs).toEqual([]);
  });

  it("shows Amr's answer as his when AI runs", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              note: "You share three and a half hours.",
              tips: ["Meet after lunch in London."],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage("shared");
    fireEvent.click(screen.getByRole("button", { name: "Ask Amr for tips" }));
    expect(await screen.findByText("Amr's note (AI, not saved)")).toBeInTheDocument();
    expect(screen.getByText("Meet after lunch in London.")).toBeInTheDocument();
    const init = fetchMock.mock.calls[0][1];
    expect(String(init?.body)).toContain("team-time.schedule_note");
    expect(String(init?.body)).not.toMatch(/Lou|Noor/);
  });
});

describe("Find a time", () => {
  it("creates a poll from suggested times", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "New poll" }));
    const form = screen.getByRole("form", { name: "New poll" });
    fireEvent.change(within(form).getByLabelText(/What it's for/), { target: { value: "Review" } });
    fireEvent.click(within(form).getByRole("button", { name: "Suggest times" }));
    const boxes = within(form).getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(within(form).getByRole("button", { name: "Create poll with 2 times" }));
    const [saved] = ws().teamTimePolls ?? [];
    expect(saved).toMatchObject({ title: "Review", minutes: 60, status: "open", answers: [] });
    expect(saved.slots).toHaveLength(2);
    expect(saved.id).toMatch(/^ttpoll_/);
    expect(logged(TEAM_TIME_ACTIONS.POLL_CREATED)).toEqual([
      { action: "poll_created", payload: { pollId: saved.id, slots: 2, minutes: 60 } },
    ]);
  });

  it("refuses a poll with no times, and a typed time in the past", async () => {
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "New poll" }));
    const form = screen.getByRole("form", { name: "New poll" });
    fireEvent.change(within(form).getByLabelText(/What it's for/), { target: { value: "Review" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create poll" }));
    expect(await within(form).findByText("Add at least one time.")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2020-01-07" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add time" }));
    expect(
      await within(form).findByText("A new time has to be in the future.")
    ).toBeInTheDocument();
    expect(ws().teamTimePolls).toEqual([]);
  });

  it("records an answer, even on a poll whose times have passed", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimePolls: [poll({ slots: [{ id: "a", start: "2020-01-07T14:00:00.000Z" }] })],
    });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "Answers" }));
    const select = screen.getByRole("combobox", { name: /^Lou, / });
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: "maybe" } });
    expect(ws().teamTimePolls?.[0].answers).toEqual([{ name: "Lou", picks: { a: "maybe" } }]);
    expect(screen.getByText("0 yes · 1 if needed · 0 no")).toBeInTheDocument();
    expect(logged(TEAM_TIME_ACTIONS.POLL_ANSWERED)).toEqual([
      { action: "poll_answered", payload: { pollId: "poll1", answers: 1 } },
    ]);
  });

  it("fills the answers from everyone's hours, with Undo", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork], teamTimePolls: [poll()] });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "Fill from hours" }));
    expect(ws().teamTimePolls?.[0].answers).toEqual([
      { name: "Lou", picks: { a: "yes", b: "yes" } },
      { name: "Noor", picks: { a: "yes", b: "yes" } },
    ]);
    undoLast();
    expect(ws().teamTimePolls?.[0].answers).toEqual([]);
  });

  it("chooses a time with Amr's cheer, and Undo reopens the poll", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london], teamTimePolls: [poll()] });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "Choose Tue 4 Mar 14:00 UTC" }));
    expect(ws().teamTimePolls?.[0]).toMatchObject({ status: "closed", chosenSlotId: "a" });
    expect(logged(TEAM_TIME_ACTIONS.SLOT_CHOSEN)).toEqual([
      { action: "slot_chosen", payload: { pollId: "poll1", slotId: "a" } },
    ]);
    expect(cheers).toEqual([["team-time", "agreed"]]);
    expect(await screen.findByText(/^Chosen:/)).toBeInTheDocument();
    undoLast();
    expect(ws().teamTimePolls?.[0].status).toBe("open");
    expect(ws().teamTimePolls?.[0]).not.toHaveProperty("chosenSlotId");
  });

  it("saves the chosen time as a calendar file and offers the invite", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london],
      teamTimePolls: [poll({ status: "closed", chosenSlotId: "a" })],
    });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(ics).toHaveLength(1);
    expect(ics[0].text).toContain("UID:team-time-poll-poll1@agile.amrelharony.com");
    expect(ics[0].text).toContain("DTSTART:20310304T140000Z");
    expect(ics[0].text.replace(/\r\n /g, "")).toContain("/team-time");
    expect(screen.getByRole("button", { name: "Copy invite" })).toBeInTheDocument();
  });

  it("links an open poll to Quick Vote with its first 12 times in UTC", async () => {
    const slots = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`,
      start: new Date(Date.parse(FAR) + i * 3_600_000).toISOString(),
    }));
    useWorkspaceStore.setState({ teamTimePolls: [poll({ slots })] });
    await renderPage("find");
    const link = screen.getByRole("link", { name: "Vote on it in Quick Vote" });
    const params = new URL(link.getAttribute("href")!, "https://x.test").searchParams;
    expect(params.get("preset")).toBe("poll");
    expect(params.get("question")).toBe("Review");
    const options = params.get("options")!.split("\n");
    expect(options).toHaveLength(12);
    expect(options[0]).toBe("Tue 4 Mar 14:00 UTC");
  });

  it("deletes a poll with Undo", async () => {
    useWorkspaceStore.setState({ teamTimePolls: [poll()] });
    await renderPage("find");
    fireEvent.click(screen.getByRole("button", { name: "Delete the poll Review" }));
    expect(ws().teamTimePolls).toEqual([]);
    expect(logged(TEAM_TIME_ACTIONS.POLL_REMOVED)).toHaveLength(1);
    undoLast();
    expect(ws().teamTimePolls).toHaveLength(1);
  });
});

describe("Rotate", () => {
  it("creates a rotation and plans its next 8 meetings", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage("rotate");
    fireEvent.click(screen.getByRole("button", { name: "New rotation" }));
    const form = screen.getByRole("form", { name: "New rotation" });
    fireEvent.change(within(form).getByLabelText(/^Meeting/), { target: { value: "Retro" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create rotation" }));
    const [saved] = ws().teamTimeRotations ?? [];
    expect(saved).toMatchObject({ meeting: "Retro", minutes: 60, everyWeeks: 2, mode: "in-turn" });
    expect(saved.options).toHaveLength(2);
    expect(logged(TEAM_TIME_ACTIONS.ROTATION_SAVED)).toEqual([
      { action: "rotation_saved", payload: { rotationId: saved.id, options: 2, mode: "in-turn" } },
    ]);
    const list = await screen.findByRole("list", { name: "The next meetings of Retro" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
  });

  it("refuses two of the same time", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london] });
    await renderPage("rotate");
    fireEvent.click(screen.getByRole("button", { name: "New rotation" }));
    const form = screen.getByRole("form", { name: "New rotation" });
    fireEvent.change(within(form).getByLabelText(/^Meeting/), { target: { value: "Retro" } });
    fireEvent.change(within(form).getByLabelText("Time 2: time"), { target: { value: "09:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Create rotation" }));
    expect(await within(form).findByText(/Two of the times are the same/)).toBeInTheDocument();
    expect(ws().teamTimeRotations).toEqual([]);
  });

  it("marks the next meeting held, then skips one and keeps the turn", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimeRotations: [rotation()],
    });
    await renderPage("rotate");
    fireEvent.click(screen.getByRole("button", { name: "Mark held" }));
    const held = ws().teamTimeRotations?.[0].held ?? [];
    expect(held).toHaveLength(1);
    expect(held[0]).not.toHaveProperty("skipped");
    expect(logged(TEAM_TIME_ACTIONS.OCCURRENCE_HELD)).toEqual([
      { action: "occurrence_held", payload: { rotationId: "rot1", optionId: held[0].optionId } },
    ]);
    const nextOption = held[0].optionId === "A" ? "B" : "A";
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    const after = ws().teamTimeRotations?.[0].held ?? [];
    expect(after[1]).toMatchObject({ optionId: nextOption, skipped: true });
    expect(logged(TEAM_TIME_ACTIONS.OCCURRENCE_SKIPPED)).toEqual([
      { action: "occurrence_skipped", payload: { rotationId: "rot1" } },
    ]);
    // A skip uses no turn: the next meeting takes the same time.
    const list = screen.getByRole("list", { name: "The next meetings of Retro" });
    const label = nextOption === "A" ? "Europe morning" : "Americas afternoon";
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(label);
  });

  it("says who carries the late and night points", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimeRotations: [rotation()],
    });
    await renderPage("rotate");
    const card = screen.getByRole("list", { name: "Rotations" });
    expect(
      within(card).getByText(/(carries \d+ of \d+ late or night points|calls are shared)/)
    ).toBeInTheDocument();
  });

  it("deletes a rotation with Undo", async () => {
    useWorkspaceStore.setState({ teamTimeRotations: [rotation()] });
    await renderPage("rotate");
    fireEvent.click(screen.getByRole("button", { name: "Delete the rotation for Retro" }));
    expect(ws().teamTimeRotations).toEqual([]);
    undoLast();
    expect(ws().teamTimeRotations).toHaveLength(1);
  });
});

describe("Office days", () => {
  it("finds the anchor day per office and who never meets", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [
        { ...london, site: "London office", officeDays: [1] },
        { ...london, id: "l2", name: "Mo", site: "London office", officeDays: [2] },
        { ...london, id: "l3", name: "Kit", site: "London office", officeDays: [1, 2] },
      ],
    });
    await renderPage("office");
    expect(
      await screen.findByText(/Anchor day: Mon or Tue, when 2 of 3 are in/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Never in on the same day: Lou and Mo/)).toBeInTheDocument();
  });
});

describe("export and clear", () => {
  it("exports the people, the shared hours, the polls and the rotations as Markdown", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimePolls: [poll()],
      teamTimeRotations: [rotation()],
    });
    await renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toMatch(/^# Team Time/);
    expect(md).toContain("| Lou | Europe/London | 09:00–17:30 | Mon–Fri | – | – |");
    expect(md).toContain("- Everyone: 14:00–17:30 (UTC), Mon–Fri");
    expect(md).toContain("### Review (1 h, open)");
    expect(md).toContain("### Retro (every week, in turn)");
  });

  it("clears Team Time with Undo, logging the counts", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london], teamTimePolls: [poll()] });
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear Team Time" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear Team Time" }));
    expect(ws().teamTimePeople).toEqual([]);
    expect(ws().teamTimePolls).toEqual([]);
    expect(logged(TEAM_TIME_ACTIONS.TEAM_TIME_RESET)).toEqual([
      { action: "team_time_reset", payload: { people: 1, polls: 1, rotations: 0 } },
    ]);
    undoLast();
    expect(ws().teamTimePeople).toHaveLength(1);
    expect(ws().teamTimePolls).toHaveLength(1);
  });

  it("keeps the tab and the clock for this browser", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    await renderPage();
    tab("Rotate");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("agile-toolkit:team-time") ?? "{}").state.tab).toBe(
        "rotate"
      )
    );
    expect(screen.getByLabelText("Show times on")).toHaveValue("UTC");
  });
});
