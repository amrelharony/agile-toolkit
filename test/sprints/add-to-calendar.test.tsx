import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Sprint } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import type { CalendarAction } from "@/lib/sprints/ics";

/**
 * "Add to calendar": the button saves the sprint's ceremonies as a calendar
 * file, the two options beside it choose the extras, a sprint without dates,
 * a cancelled one, one whose ceremonies are all past (or no sprint) disables
 * it with the reason, and the note says the file is a snapshot.
 */

const saved = vi.hoisted(() => [] as { ics: string; filename: string }[]);
vi.mock("@/lib/utils/export", () => ({
  exportToICS: (ics: string, filename: string) => saved.push({ ics, filename }),
}));

import { AddToCalendar } from "@/components/sprints/add-to-calendar";

// Monday 19 Oct 2026 to Friday 30 Oct 2026: 14 ceremonies on the default cadence.
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 30,
  status: "active",
};
/** The page was opened on Sunday 18 Oct 2026, the day before the sprint starts. */
const NOW = new Date(2026, 9, 18, 9, 0, 0);
const ACTIONS: CalendarAction[] = [
  { id: "a1", text: "Pair on the flaky test", assignee: "Omar", dueDate: "2026-10-28" },
  { id: "a2", text: "Write the runbook", dueDate: "2026-11-02" },
  { id: "a3", text: "No due date yet" },
  { id: "a4", text: "Done already", dueDate: "2026-10-27", done: true },
];

const button = () => screen.getByRole("button", { name: /Add to calendar|Downloaded/ });
const actionsBox = () => screen.getByRole("checkbox", { name: /Open retro actions/ });
const storyBox = () => screen.getByRole("checkbox", { name: /Agile at Work story/ });
const entries = (ics: string) => ics.split("BEGIN:VEVENT").length - 1;

beforeEach(() => {
  saved.length = 0;
});

describe("AddToCalendar", () => {
  it("downloads the sprint's ceremonies as a calendar file and says so on the button", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="cockpit"
      />
    );
    expect(button()).toBeEnabled();
    // The file asks for the reminder; whether one shows is up to the calendar app.
    expect(button()).toHaveAccessibleDescription(
      "Downloads a calendar file with the 14 ceremonies of Sprint 1. Open the file to add them to your calendar. Each asks for a reminder 10 minutes before, though some calendars use their own setting."
    );
    fireEvent.click(button());

    expect(saved).toHaveLength(1);
    expect(saved[0].filename).toBe("sprint-1-ceremonies");
    expect(saved[0].ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(entries(saved[0].ics)).toBe(14);
    // The links are to the site the file was made on.
    expect(saved[0].ics).toContain(`URL:${window.location.origin}/standup?sprint=s1`);
    expect(button()).toHaveTextContent("Downloaded");
  });

  it("says the file is a snapshot and how it reaches the team", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="team"
      />
    );
    expect(
      screen.getByText(
        "The file is a snapshot. It does not change when the ceremony times do, so download it again after a change. Each teammate imports it into their own calendar, or the Scrum Master forwards it. Times are in this device’s time zone."
      )
    ).toBeInTheDocument();
  });

  it("adds the open retro actions with a due date unless that is unticked", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="cockpit"
      />
    );
    // On while there are any; the label counts the ones that can be placed.
    expect(actionsBox()).toBeChecked();
    expect(actionsBox().closest("label")).toHaveTextContent("(2 with a due date)");
    fireEvent.click(button());
    expect(entries(saved[0].ics)).toBe(16);
    expect(saved[0].ics).toContain("UID:retro-action-a1@agile.amrelharony.com");
    expect(saved[0].ics).toContain("UID:retro-action-a2@agile.amrelharony.com");
    expect(saved[0].ics).not.toContain("retro-action-a3");
    expect(saved[0].ics).not.toContain("retro-action-a4");

    fireEvent.click(actionsBox());
    expect(actionsBox()).not.toBeChecked();
    fireEvent.click(button());
    expect(entries(saved[1].ics)).toBe(14);
    expect(saved[1].ics).not.toContain("retro-action-");
  });

  it("counts and adds a card once when two boards hold the same card id", () => {
    const twice: CalendarAction[] = [
      { id: "a1", text: "Pair on the flaky test", dueDate: "2026-10-28" },
      { id: "a1", text: "Pair on the flaky test", dueDate: "2026-10-30" },
    ];
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={twice}
        now={NOW}
        place="cockpit"
      />
    );
    expect(actionsBox().closest("label")).toHaveTextContent("(1 with a due date)");
    fireEvent.click(button());
    expect(entries(saved[0].ics)).toBe(15);
    expect(saved[0].ics.split("UID:retro-action-a1@")).toHaveLength(2);
  });

  it("has the actions option off and disabled, with the reason, when none can be placed", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS.slice(2)}
        now={NOW}
        place="cockpit"
      />
    );
    expect(actionsBox()).toBeDisabled();
    expect(actionsBox()).not.toBeChecked();
    expect(actionsBox().closest("label")).toHaveTextContent("(no open action has a due date)");
    fireEvent.click(button());
    expect(entries(saved[0].ics)).toBe(14);
  });

  it("adds the weekly Agile at Work story only when asked", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="cockpit"
      />
    );
    expect(storyBox()).not.toBeChecked();
    fireEvent.click(button());
    expect(saved[0].ics).not.toContain("RRULE");

    fireEvent.click(storyBox());
    fireEvent.click(button());
    expect(entries(saved[1].ics)).toBe(15);
    expect(saved[1].ics).toContain("UID:agile-at-work-weekly-story@agile.amrelharony.com");
    expect(saved[1].ics).toContain("RRULE:FREQ=WEEKLY");
  });

  it("follows the ceremony times it is given", () => {
    const cadence = { ...DEFAULT_CADENCE, refinement: null, holidays: ["2026-10-22"] };
    render(<AddToCalendar sprint={SPRINT} cadence={cadence} actions={[]} now={NOW} place="team" />);
    // No refinements (2) and no Daily Scrum on the holiday.
    expect(button()).toHaveAccessibleDescription(/the 11 ceremonies of Sprint 1/);
    fireEvent.click(button());
    expect(entries(saved[0].ics)).toBe(11);
  });

  it("is disabled for a sprint without dates, and says how to give it some", () => {
    const undated = { ...SPRINT, name: "Sprint 9", startDate: "", endDate: "" };
    const { rerender } = render(
      <AddToCalendar
        sprint={undated}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="cockpit"
      />
    );
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "Sprint 9 has no dates, so its ceremonies can’t go on a calendar. Click Edit details and set its first and last day."
    );
    // Nothing to choose, and no snapshot note, for a file that can't be made.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/The file is a snapshot/)).toBeNull();
    fireEvent.click(button());
    expect(saved).toEqual([]);

    // On the Team page the dates are set in the cockpit.
    rerender(
      <AddToCalendar
        sprint={undated}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="team"
      />
    );
    expect(button()).toBeDisabled();
    const reason = screen.getByText(/Sprint 9 has no dates/);
    expect(reason).toHaveTextContent(
      "Sprint 9 has no dates, so its ceremonies can’t go on a calendar. Set its first and last day in the Sprint Cockpit."
    );
    // The link opens the cockpit on the sprint the sentence names, whichever
    // one this browser last picked there.
    expect(within(reason).getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute(
      "href",
      "/sprint?sprint=s1"
    );
    rerender(
      <AddToCalendar
        sprint={{ ...undated, id: "legacy sprint/3" }}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="team"
      />
    );
    expect(screen.getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute(
      "href",
      "/sprint?sprint=legacy%20sprint%2F3"
    );

    // The old Velocity tool's placeholder dates are not dates either.
    rerender(
      <AddToCalendar
        sprint={{ ...undated, startDate: "2020-01-05", endDate: "2020-01-15" }}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="team"
      />
    );
    expect(button()).toBeDisabled();
  });

  it("is disabled until the team has a sprint", () => {
    render(
      <AddToCalendar
        sprint={undefined}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={NOW}
        place="team"
      />
    );
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "There is no sprint yet, so there are no ceremonies to add. Create one in the Sprint Cockpit."
    );
    expect(screen.getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute("href", "/sprint");
  });

  it("is disabled for a cancelled sprint, whose ceremonies won't take place", () => {
    const cancelled: Sprint = { ...SPRINT, name: "Sprint 4", status: "cancelled" };
    const { rerender } = render(
      <AddToCalendar
        sprint={cancelled}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="cockpit"
      />
    );
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "Sprint 4 was cancelled, so it has no ceremonies to add. Pick another sprint under Sprint, or click New sprint."
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(button());
    expect(saved).toEqual([]);

    rerender(
      <AddToCalendar
        sprint={cancelled}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="team"
      />
    );
    expect(button()).toHaveAccessibleDescription(
      "Sprint 4 was cancelled, so it has no ceremonies to add. Create a new sprint in the Sprint Cockpit."
    );
    // To a new sprint, not to the cancelled one.
    expect(screen.getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute("href", "/sprint");
  });

  it("is disabled once every ceremony of the sprint is in the past", () => {
    // The retro on Friday 30 Oct starts at 15:30 on the default times.
    const retro = new Date(2026, 9, 30, 15, 30, 0);
    const { rerender } = render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={retro}
        place="cockpit"
      />
    );
    // One starting now is still to come, as on the next-ceremony card.
    expect(button()).toBeEnabled();
    expect(button()).toHaveAccessibleDescription(/the 14 ceremonies of Sprint 1/);

    const after = new Date(retro.getTime() + 60_000);
    rerender(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={after}
        place="cockpit"
      />
    );
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(
      "Every ceremony of Sprint 1 is in the past, so there is nothing to add to a calendar. Pick the next sprint under Sprint, or click New sprint."
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/The file is a snapshot/)).toBeNull();
    fireEvent.click(button());
    expect(saved).toEqual([]);

    rerender(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={after}
        place="team"
      />
    );
    expect(button()).toHaveAccessibleDescription(
      "Every ceremony of Sprint 1 is in the past, so there is nothing to add to a calendar. Plan the next sprint in the Sprint Cockpit."
    );
    expect(screen.getByRole("link", { name: "Sprint Cockpit" })).toHaveAttribute("href", "/sprint");
  });

  it("still offers a sprint under way, with every ceremony in the file", () => {
    // Day 8 of 11: the first ceremonies are past, the rest to come.
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={[]}
        now={new Date(2026, 9, 27, 12, 0, 0)}
        place="team"
      />
    );
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    expect(entries(saved[0].ics)).toBe(14);
  });

  it("makes each option's label the 44px target on touch, and nothing bigger with a mouse", () => {
    render(
      <AddToCalendar
        sprint={SPRINT}
        cadence={DEFAULT_CADENCE}
        actions={ACTIONS}
        now={NOW}
        place="cockpit"
      />
    );
    const group = screen.getByRole("group", { name: "Also put in the file" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      const label = box.closest("label")!;
      expect(label).toHaveClass("pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
      for (const c of label.className.split(/\s+/)) {
        if (/min-[hw]-/.test(c)) expect(c).toMatch(/^pointer-coarse:/);
      }
    }
    // Clicking the words ticks the box.
    fireEvent.click(screen.getByText("The new Agile at Work story, as a weekly entry on Sundays"));
    expect(storyBox()).toBeChecked();
  });
});
