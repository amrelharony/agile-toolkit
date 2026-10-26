// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateOneOnOnePrompts } from "@/lib/ai-prompts/one-on-one";
import {
  addressedShare,
  cadenceByReport,
  cadenceVerdict,
  meetingsThisMonth,
  overdueActions,
  type Meeting,
} from "@/app/(tools)/one-on-one/model";
import { nameKey } from "@/lib/team/names";

/**
 * The 1:1 prompt reads the tracker's own shapes and numbers: Done is a
 * status of its own (with its day), a carried-over action is listed once,
 * and the cadence, overdue actions and the addressed share are the page's.
 */

const TODAY = "2026-10-26";

const MEETINGS: Meeting[] = [
  {
    id: "m1",
    manager: "Mia",
    report: "Raj",
    date: "2026-10-05",
    agenda: [
      {
        id: "m1-a",
        text: "RFC",
        status: "action_required",
        action: "Write the RFC",
        dueDate: "2026-10-10",
      },
      {
        id: "m1-b",
        text: "Training",
        status: "done",
        action: "Book the course",
        doneAt: "2026-10-08",
      },
      { id: "m1-c", text: "Holiday", status: "discussed" },
    ],
  },
  {
    id: "m2",
    manager: "Mia",
    report: "Raj",
    date: "2026-10-15",
    agenda: [
      // Carried over from m1: the follow-up lives here now.
      {
        id: "m2-a",
        text: "RFC",
        status: "action_required",
        action: "Write the RFC",
        dueDate: "2026-10-20",
        carriedFrom: "m1-a",
      },
      { id: "m2-b", text: "Team move", status: "open" },
    ],
  },
  {
    id: "m3",
    manager: "Mia",
    report: "Lee",
    date: "2026-10-24",
    agenda: [
      // A plain topic closed with Done: no action, owner or due day.
      { id: "m3-a", text: "Set up laptop", status: "done", doneAt: "2026-10-25" },
      // Done with an owner but no action text: still a follow-up.
      { id: "m3-b", text: "Order a monitor", status: "done", owner: "Lee", doneAt: "2026-10-25" },
    ],
  },
];

const REPORTS = cadenceByReport(MEETINGS, { [nameKey("Raj")]: 7 }, [], TODAY);
const [cadence, career] = generateOneOnOnePrompts({
  meetings: MEETINGS,
  reports: REPORTS,
  today: TODAY,
});

describe("generateOneOnOnePrompts", () => {
  it("states the page's numbers", () => {
    expect(overdueActions(MEETINGS, TODAY)).toBe(1);
    expect(addressedShare(MEETINGS)).toBeCloseTo(5 / 6);
    expect(cadence.prompt).toContain(`- ${cadenceVerdict(REPORTS)}`);
    expect(cadence.prompt).toContain(
      `- Meetings this month: ${meetingsThisMonth(MEETINGS, TODAY)}`
    );
    expect(cadence.prompt).toContain("- Action items overdue: 1");
    expect(cadence.prompt).toContain("- Addressed (discussed, actioned or done): 83%");
    expect(cadence.prompt).toContain("- Past their cadence: 1 of 2 reports");
    expect(cadence.prompt).toContain(
      "| Raj | 2 | last 1:1 11 days ago | every 7 days | 4 d | — | 1 |"
    );
  });

  it("counts Done as its own status, with its day", () => {
    expect(cadence.prompt).toContain("| 2026-10-05 | Mia | Raj | 3 | 0/1/1/1 |");
    expect(cadence.prompt).toContain("| 2026-10-24 | Mia | Lee | 2 | 0/0/0/2 |");
    expect(cadence.prompt).toContain("| Book the course | — | — | Done 2026-10-08 |");
    // A done item is never an open action, and isn't read as discussed.
    expect(career.prompt).toContain("0/0/0/2");
  });

  it("lists a Done item as a closed action only when it was an action", () => {
    const actions = cadence.prompt.split("## Action items")[1].split("## Questions")[0];
    expect(actions).not.toContain("Set up laptop");
    expect(actions).toContain(
      "| Mia ↔ Lee (2026-10-24) | Order a monitor | Lee | — | Done 2026-10-25 |"
    );
    // Open first, then the done ones: Write the RFC, Book the course, Order a monitor.
    expect(actions.match(/^\| Mia ↔/gm)).toHaveLength(3);
  });

  it("lists a carried-over action once, in the 1:1 it was carried to", () => {
    expect(cadence.prompt.match(/Write the RFC/g)).toHaveLength(1);
    expect(cadence.prompt).toContain(
      "| Mia ↔ Raj (2026-10-15) | Write the RFC | — | 2026-10-20 | Overdue |"
    );
  });

  it("has no prompts without a 1:1", () => {
    expect(generateOneOnOnePrompts({ meetings: [], reports: [], today: TODAY })).toEqual([]);
  });
});
