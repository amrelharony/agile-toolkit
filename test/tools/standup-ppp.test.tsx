import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StandupEntry, StandupMode, TeamTimePerson } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useDockTimer } from "@/lib/timer/dock-timer";

/**
 * The Async Standup's Progress/Plans/Problems format, a DRI per blocker and
 * follow-the-sun hand-overs (P2.9): the async form's switch and fields, the
 * live form left as it was, the editor, the Hand-overs panel, both digests
 * with Team Time's places, and the digest summary without AI.
 */

type ToastOptions = { action?: { label: string; onClick: () => void } };
const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn<(label: string, opts?: ToastOptions) => string>(() => "toast-1"),
    { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }
  )
);
const clip = vi.hoisted(() => ({
  copy: vi.fn<(text: string) => Promise<boolean>>(async () => true),
}));
const exported = vi.hoisted(() => ({ byName: new Map<string, string | undefined>() }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/utils/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/export")>()),
  copyToClipboard: clip.copy,
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children, title }: { children: ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ filename, markdown }: { filename: string; markdown?: string }) => {
    exported.byName.set(filename, markdown);
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

import { FORMAT_KEY, StandupClient } from "@/app/(tools)/standup/standup-client";
import { buildExample } from "@/app/(tools)/standup/example";

const TODAY = todayLocalISO();
const YESTERDAY = addDays(TODAY, -1);

const entry = (id: string, member: string, extra: Partial<StandupEntry> = {}): StandupEntry => ({
  id,
  member,
  date: TODAY,
  yesterday: "y",
  today: "t",
  blockers: "",
  timestamp: Date.now(),
  mode: "async",
  ...extra,
});

const person = (id: string, name: string, timeZone: string, site?: string): TeamTimePerson => ({
  id,
  name,
  timeZone,
  start: "09:00",
  end: "17:00",
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  ...(site ? { site } : {}),
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
/** Sky in Sydney and Lou in the London office: two places, east to west. */
const PEOPLE = [
  person("p1", "Sky", "Australia/Sydney"),
  person("p2", "Lou", "Europe/London", "London office"),
];

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().standupEntries ?? [];

function renderStandup(mode: StandupMode = "async") {
  return render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <StandupClient mode={mode} />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
}

const memberInput = () => screen.getByLabelText(/^Team member/);
/** A field of the post form (the tabs below carry "Today" too). */
const field = (label: RegExp) =>
  within(memberInput().closest("form") as HTMLElement).getByLabelText(label);
const card = (member: string) => screen.getByRole("article", { name: `${member}'s update` });

function post(member: string, fields: { today: string; blockers?: string }) {
  fireEvent.change(memberInput(), { target: { value: member } });
  fireEvent.change(field(/^(Today|Plans)/), { target: { value: fields.today } });
  if (fields.blockers) {
    fireEvent.change(field(/^(Blockers|Problems)/), { target: { value: fields.blockers } });
  }
}

beforeEach(() => {
  toastSpy.mockClear();
  clip.copy.mockClear();
  history.log.mockClear();
  exported.byName.clear();
  localStorage.clear();
  sessionStorage.clear();
  resetSelectedSprint();
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({
    teamMembers: [],
    standupEntries: [],
    asyncUpdates: [],
    sprints: [],
    stories: [],
    impediments: [],
    teamTimePeople: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the form", () => {
  it("keeps the live form as it was: no format switch, no DRI, no hand-over", () => {
    useWorkspaceStore.setState({ teamTimePeople: PEOPLE });
    renderStandup("live");
    expect(screen.queryByRole("radiogroup", { name: "Update format" })).toBeNull();
    post("Sky", { today: "Ship", blockers: "Keys" });
    expect(screen.queryByLabelText(/^Who can clear it/)).toBeNull();
    expect(screen.queryByLabelText(/^Hand over to the next shift/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit Standup" }));
    expect(stored()[0]).not.toHaveProperty("format");
    expect(stored()[0]).not.toHaveProperty("blockerDri");
  });

  it("switches to Progress, Plans and Problems, remembered in this browser, and posts it", () => {
    const view = renderStandup();
    const group = screen.getByRole("radiogroup", { name: "Update format" });
    expect(
      within(group).getByRole("radio", { name: "Yesterday · Today · Blockers" })
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(group).getByRole("radio", { name: "Progress · Plans · Problems" }));
    expect(field(/^Progress/)).toHaveAttribute(
      "placeholder",
      "What moved forward since your last update?"
    );
    expect(field(/^Plans/)).toBeInTheDocument();
    expect(field(/^Problems/)).toBeInTheDocument();
    expect(localStorage.getItem(FORMAT_KEY)).toBe(JSON.stringify("ppp"));
    post("Ana", { today: "Ship the fix" });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored()[0]).toMatchObject({ member: "Ana", format: "ppp", today: "Ship the fix" });
    expect(within(card("Ana")).getByText("Plans")).toBeInTheDocument();
    view.unmount();
    renderStandup();
    expect(field(/^Plans/)).toBeInTheDocument();
  });

  it("asks who can clear a typed blocker, keeps the DRI, and shows it on the card", () => {
    renderStandup();
    post("Ana", { today: "Ship" });
    expect(screen.queryByLabelText(/^Who can clear it/)).toBeNull();
    fireEvent.change(field(/^Blockers/), { target: { value: "Needs a DBA review" } });
    expect(screen.getByText("The DRI: the one person who owns clearing it.")).toBeInTheDocument();
    fireEvent.change(field(/^Who can clear it/), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored()[0]).toMatchObject({ blockers: "Needs a DBA review", blockerDri: "Bo" });
    expect(within(card("Ana")).getByText(/^DRI:/).closest("p")).toHaveTextContent("DRI: Bo");
  });

  it("shows a blocker's DRI on the Blockers tab, open and resolved", () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("a", "Ana", { blockers: "Needs a DBA review", blockerDri: "Bo" }),
        entry("c", "Cy", { blockers: "Keys", blockerDri: "Di", blockerResolved: true }),
      ],
    });
    renderStandup();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Blockers/ }), { button: 0 });
    const open = screen.getByRole("region", { name: "Open blockers" });
    expect(within(open).getByText(/^DRI:/).closest("p")).toHaveTextContent("DRI: Bo");
    const resolved = screen.getByRole("region", { name: "Resolved" });
    expect(within(resolved).getByText(/^DRI:/).closest("p")).toHaveTextContent("DRI: Di");
  });

  it("offers a hand-over only when Team Time knows two places and the poster's", () => {
    useWorkspaceStore.setState({ teamTimePeople: PEOPLE });
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Kim" } });
    expect(screen.queryByLabelText(/^Hand over to the next shift/)).toBeNull();
    post("Sky", { today: "Test" });
    expect(
      screen.getByText("London office starts next: say what to pick up, and where it is.")
    ).toBeInTheDocument();
    fireEvent.change(field(/^Hand over to the next shift/), {
      target: { value: "Build is on staging" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored()[0]).toMatchObject({ member: "Sky", handoff: "Build is on staging" });
  });

  it("never saves a hand-over the form hid: picking someone Team Time doesn't place drops it", () => {
    useWorkspaceStore.setState({ teamTimePeople: PEOPLE });
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Sky" } });
    fireEvent.change(field(/^Hand over to the next shift/), {
      target: { value: "Sky's note for London" },
    });
    // Sam has no Team Time row: the field hides, and the note stays out.
    post("Sam", { today: "Write docs" });
    expect(screen.queryByLabelText(/^Hand over to the next shift/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    expect(stored()[0]).toMatchObject({ member: "Sam", today: "Write docs" });
    expect(stored()[0]).not.toHaveProperty("handoff");
  });

  it("asks before 'Post for' replaces a draft that holds only a hand-over", () => {
    useWorkspaceStore.setState({
      teamTimePeople: PEOPLE,
      teamMembers: [
        { id: "m1", name: "Sky" },
        { id: "m2", name: "Ana" },
      ],
    });
    renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Sky" } });
    fireEvent.change(field(/^Hand over to the next shift/), {
      target: { value: "Build is on staging" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post for Ana" }));
    expect(
      screen.getByText("These notes are for Sky. Save them, or start Ana's.")
    ).toBeInTheDocument();
    expect(memberInput()).toHaveValue("Sky");
    expect(field(/^Hand over to the next shift/)).toHaveValue("Build is on staging");
  });

  it("an edit follows the entry's format, and a cleared DRI is gone after the save", () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("e1", "Ana", { format: "ppp", blockers: "Keys", blockerDri: "Bo", handoff: "Over" }),
      ],
    });
    renderStandup();
    fireEvent.click(within(card("Ana")).getByRole("button", { name: "Edit Ana's update" }));
    const editor = card("Ana");
    expect(within(editor).getByLabelText(/^Problems/)).toHaveValue("Keys");
    fireEvent.change(within(editor).getByLabelText(/^Who can clear it/), { target: { value: "" } });
    fireEvent.change(within(editor).getByLabelText(/^Hand over to the next shift/), {
      target: { value: "" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(stored()[0]).toMatchObject({ format: "ppp", blockers: "Keys" });
    expect(stored()[0]).not.toHaveProperty("blockerDri");
    expect(stored()[0]).not.toHaveProperty("handoff");
  });
});

describe("follow the sun", () => {
  it("shows the shift chain, each place's notes and whether the next one posted", () => {
    useWorkspaceStore.setState({
      teamTimePeople: PEOPLE,
      standupEntries: [
        entry("s1", "Sky", { handoff: "Build is on staging" }),
        entry("l0", "Lou", { date: YESTERDAY, handoff: "Release notes drafted", timestamp: 1 }),
      ],
    });
    renderStandup();
    expect(screen.getByRole("heading", { name: "Hand-overs" })).toBeInTheDocument();
    const panel = document.querySelector("[data-handovers]") as HTMLElement;
    expect(within(panel).getByText("Sydney → London office → back to Sydney")).toBeInTheDocument();
    expect(within(panel).getByText(/to London office: Build is on staging/)).toBeInTheDocument();
    expect(
      within(panel).getByText(/\(yesterday\) to Sydney: Release notes drafted/)
    ).toBeInTheDocument();
    expect(within(panel).getByText("London office hasn't posted today yet.")).toBeInTheDocument();
    expect(within(panel).getByText("Sydney has posted today.")).toBeInTheDocument();
    expect(within(panel).getAllByText(/ there$/)).toHaveLength(2);
  });

  it("makes the places on one clock one shift: no hand-over between them", () => {
    useWorkspaceStore.setState({
      teamTimePeople: [
        person("p1", "Priya", "Europe/London", "London office"),
        person("p2", "Tom", "Europe/London"),
      ],
      standupEntries: [entry("p0", "Priya"), entry("t0", "Tom")],
    });
    const view = renderStandup();
    fireEvent.change(memberInput(), { target: { value: "Priya" } });
    expect(screen.queryByLabelText(/^Hand over to the next shift/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Hand-overs" })).toBeNull();
    view.unmount();
    // Berlin and Paris share a clock: one shift, after Sydney.
    useWorkspaceStore.setState({
      teamTimePeople: [
        person("p1", "Ben", "Europe/Berlin"),
        person("p2", "Pia", "Europe/Paris"),
        person("p3", "Sky", "Australia/Sydney"),
      ],
      standupEntries: [entry("b0", "Ben"), entry("p0", "Pia"), entry("s0", "Sky")],
    });
    renderStandup();
    const panel = document.querySelector("[data-handovers]") as HTMLElement;
    expect(within(panel).getByText("Sydney → Berlin / Paris → back to Sydney")).toBeInTheDocument();
    expect(within(panel).getByText("Ben, Pia")).toBeInTheDocument();
    fireEvent.change(memberInput(), { target: { value: "Ben" } });
    expect(
      screen.getByText("Sydney starts next: say what to pick up, and where it is.")
    ).toBeInTheDocument();
  });

  it("names the same next place in the panel, the form's hint and the digest", () => {
    // Bea is in Team Time only: not on the roster, and she hasn't posted.
    useWorkspaceStore.setState({
      teamTimePeople: [...PEOPLE, person("p3", "Bea", "Asia/Kolkata")],
      standupEntries: [
        entry("s1", "Sky", { handoff: "Build is on staging" }),
        entry("l1", "Lou", { timestamp: 1 }),
      ],
    });
    renderStandup();
    const panel = document.querySelector("[data-handovers]") as HTMLElement;
    expect(
      within(panel).getByText("Sydney → Kolkata → London office → back to Sydney")
    ).toBeInTheDocument();
    expect(within(panel).getByText(/to Kolkata: Build is on staging/)).toBeInTheDocument();
    fireEvent.change(memberInput(), { target: { value: "Sky" } });
    expect(
      screen.getByText("Kolkata starts next: say what to pick up, and where it is.")
    ).toBeInTheDocument();
    expect(exported.byName.get(`standup-digest-${TODAY}`)).toContain(
      "- **Sky**, Sydney → Kolkata: Build is on staging"
    );
  });

  it("isn't there with one place, or in the live standup", () => {
    useWorkspaceStore.setState({ teamTimePeople: PEOPLE.slice(0, 1) });
    const view = renderStandup();
    expect(screen.queryByRole("heading", { name: "Hand-overs" })).toBeNull();
    view.unmount();
    useWorkspaceStore.setState({ teamTimePeople: PEOPLE });
    renderStandup("live");
    expect(screen.queryByRole("heading", { name: "Hand-overs" })).toBeNull();
  });

  it("gives Today's and History's digests the places, as Amr's digest has them", () => {
    useWorkspaceStore.setState({
      teamTimePeople: PEOPLE,
      standupEntries: [
        entry("l1", "Lou", { timestamp: 1 }),
        entry("s1", "Sky", { handoff: "Build is on staging", timestamp: 2 }),
      ],
    });
    renderStandup();
    const today = exported.byName.get(`standup-digest-${TODAY}`) ?? "";
    expect(today).toContain(
      "## Hand-overs\n- **Sky**, Sydney → London office: Build is on staging"
    );
    // East to west: Sky before Lou, though Lou posted first.
    expect(today.indexOf("## Sky")).toBeLessThan(today.indexOf("## Lou"));
    fireEvent.mouseDown(screen.getByRole("tab", { name: /History/ }), { button: 0 });
    expect(exported.byName.get(`standup-${TODAY}`)).toBe(today);
  });

  it("gives the example's async rows one DRI and two hand-overs, and leaves the live rows alone", () => {
    const written = buildExample(new Date(), "async");
    expect(written.filter((e) => e.blockerDri)).toHaveLength(1);
    expect(written.filter((e) => e.handoff)).toHaveLength(2);
    const live = buildExample(new Date(), "live");
    expect(live.some((e) => e.blockerDri || e.handoff || e.format)).toBe(false);
  });
});

describe("the digest summary", () => {
  it("summarises without AI, says what it sends, logs counts only and copies into the digest", async () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("a", "Ana", { blockers: "Needs a DBA review", blockerDri: "Bo" }),
        entry("b", "Bo"),
      ],
    });
    renderStandup();
    expect(
      screen.getByText("Sends today's updates, with names, to the AI service.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Summarise" }));
    expect(await screen.findByText("Built from the updates")).toBeInTheDocument();
    expect(screen.getByText("2 updates posted; 1 blocker open")).toBeInTheDocument();
    expect(screen.getByText("Ask Bo: Needs a DBA review")).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith("digest_summarised", {
      date: TODAY,
      source: "rules",
      updateCount: 2,
      blockerCount: 1,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy digest with summary" }));
    });
    const copied = clip.copy.mock.calls.at(-1)?.[0] ?? "";
    expect(copied.split("\n").slice(0, 4)).toEqual([
      `# Standup — ${TODAY}`,
      "",
      "## Summary",
      "2 updates posted; 1 blocker open",
    ]);
    expect(copied).toContain("- Ask Bo: Needs a DBA review");
    expect(copied).toContain("## Blockers\n- **Ana**: Needs a DBA review (DRI: Bo)");
    // Nothing was saved from it.
    expect(stored()).toHaveLength(2);
  });

  it("marks the summary out of date once the updates change, and copies only a fresh one", async () => {
    useWorkspaceStore.setState({
      standupEntries: [
        entry("a", "Ana", { blockers: "Needs a DBA review", blockerDri: "Bo" }),
        entry("b", "Bo"),
      ],
    });
    renderStandup();
    fireEvent.click(screen.getByRole("button", { name: "Summarise" }));
    expect(await screen.findByText("2 updates posted; 1 blocker open")).toBeInTheDocument();
    expect(screen.queryByText(/^Out of date/)).toBeNull();
    // Cy posts, and Ana's blocker is resolved: the summary's facts are old.
    act(() => {
      useWorkspaceStore.setState({
        standupEntries: [
          entry("a", "Ana", {
            blockers: "Needs a DBA review",
            blockerDri: "Bo",
            blockerResolved: true,
          }),
          entry("b", "Bo"),
          entry("c", "Cy"),
        ],
      });
    });
    expect(screen.getByText(/^Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy digest with summary" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Summarise" }));
    expect(await screen.findByText("3 updates posted; no blockers open")).toBeInTheDocument();
    expect(screen.queryByText(/^Out of date/)).toBeNull();
    expect(screen.getByRole("button", { name: "Copy digest with summary" })).toBeInTheDocument();
  });
});
