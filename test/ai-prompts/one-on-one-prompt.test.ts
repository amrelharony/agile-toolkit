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
    agenda: [{ id: "m3-a", text: "Set up laptop", status: "done", doneAt: "2026-10-25" }],
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
    expect(addressedShare(MEETINGS)).toBeCloseTo(0.8);
    expect(cadence.prompt).toContain(`- ${cadenceVerdict(REPORTS)}`);
    expect(cadence.prompt).toContain(
      `- Meetings this month: ${meetingsThisMonth(MEETINGS, TODAY)}`
    );
    expect(cadence.prompt).toContain("- Action items overdue: 1");
    expect(cadence.prompt).toContain("- Addressed (discussed, actioned or done): 80%");
    expect(cadence.prompt).toContain("- Past their cadence: 1 of 2 reports");
    expect(cadence.prompt).toContain(
      "| Raj | 2 | last 1:1 11 days ago | every 7 days | 4 d | — | 1 |"
    );
  });

  it("counts Done as its own status, with its day", () => {
    expect(cadence.prompt).toContain("| 2026-10-05 | Mia | Raj | 3 | 0/1/1/1 |");
    expect(cadence.prompt).toContain("| 2026-10-24 | Mia | Lee | 1 | 0/0/0/1 |");
    expect(cadence.prompt).toContain("| Book the course | — | — | Done 2026-10-08 |");
    // A done item is never an open action, and isn't read as discussed.
    expect(career.prompt).toContain("0/0/0/1");
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
