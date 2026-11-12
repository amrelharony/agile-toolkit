import { describe, expect, it } from "vitest";
import type { HandoffLink, ParkingLotItem } from "@/lib/stores/workspace-types";
import {
  changedFields,
  countedItems,
  editedParkingItem,
  matchSuggestions,
  meetingsOf,
  newParkingItem,
  normalizeParkingItem,
  parkedWhen,
  parkingItems,
  parkingLotSteps,
  parkingSource,
  parkingSummary,
  rememberedMeeting,
  summaryText,
  validateParkingDraft,
  withParkingLinks,
} from "@/lib/parking-lot/model";
import { toCsv, toMarkdown } from "@/app/(tools)/parking-lot/markdown";

/**
 * Parking Lot's pure reading: tolerant rows, meetings grouped by name, the
 * remembered meeting, the form's checks, the status a send leaves (and Undo
 * puts back), what a send hands over, matching Amr's suggestions, the next
 * step, and the export.
 */

const NOW = new Date("2026-11-12T10:00:00");
const item = (over: Partial<ParkingLotItem> = {}): ParkingLotItem => ({
  id: "p1",
  text: "Who owns the release checklist?",
  status: "open",
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T09:00:00.000Z",
  ...over,
});
const link = (route: HandoffLink["route"], targetId = "t1"): HandoffLink => ({
  route,
  targetId,
  at: "2026-11-12T09:30:00.000Z",
});

describe("reading rows", () => {
  it("keeps what it can show, reads an unknown status as open and drops blank fields", () => {
    expect(
      normalizeParkingItem({ id: "x", text: "  Hello\nthere ", status: "parked", meeting: " " })
    ).toEqual({
      id: "x",
      text: "Hello there",
      status: "open",
      createdAt: "",
      updatedAt: "",
    });
    expect(normalizeParkingItem({ id: "x", text: "  " })).toBeNull();
    expect(normalizeParkingItem({ text: "No id" })).toBeNull();
    expect(normalizeParkingItem(null)).toBeNull();
    const withLinks = normalizeParkingItem({
      ...item(),
      sentTo: [link("impediment"), { route: "impediment" }, "junk"],
    });
    expect(withLinks?.sentTo).toEqual([link("impediment")]);
  });

  it("lists rows in the order raised, and counts the example only while it is alone", () => {
    const rows = parkingItems([
      item({ id: "b", createdAt: "2026-11-12T09:05:00Z" }),
      item({ id: "a", createdAt: "2026-11-12T09:01:00Z" }),
      { junk: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    const ex = item({ id: "example-p1" });
    expect(countedItems([ex]).map((r) => r.id)).toEqual(["example-p1"]);
    expect(countedItems([ex, item()]).map((r) => r.id)).toEqual(["p1"]);
  });
});

describe("meetings", () => {
  const rows = [
    item({ id: "1", meeting: "daily scrum", createdAt: "2026-11-11T09:00:00Z" }),
    item({
      id: "2",
      meeting: "Sprint Planning",
      createdAt: "2026-11-11T10:00:00Z",
      status: "sent",
    }),
    item({ id: "3", createdAt: "2026-11-12T08:00:00Z" }),
    item({ id: "4", meeting: "Daily  Scrum ", createdAt: "2026-11-12T09:00:00Z" }),
  ];

  it("groups by name in any case, the most recent first, 'no meeting' last", () => {
    expect(meetingsOf(rows)).toEqual([
      { key: "daily scrum", name: "Daily Scrum", total: 2, open: 2 },
      { key: "sprint planning", name: "Sprint Planning", total: 1, open: 0 },
      { key: "", name: "", total: 1, open: 1 },
    ]);
  });

  it("remembers the meeting of the last point the team parked, never the example's", () => {
    expect(rememberedMeeting(rows)).toBe("Daily  Scrum");
    expect(rememberedMeeting([...rows, item({ id: "5", createdAt: "2026-11-12T09:30:00Z" })])).toBe(
      ""
    );
    expect(rememberedMeeting([item({ id: "example-1", meeting: "Example meeting" })])).toBe("");
  });
});

describe("the form's checks", () => {
  it("needs the point, keeps optional fields optional, and holds the agents' caps", () => {
    const blank = validateParkingDraft({ text: "  ", meeting: "", raisedBy: "" });
    expect(blank.ok || blank.errors).toEqual({ text: "Say what the point is." });
    const long = validateParkingDraft({
      text: "x".repeat(1001),
      meeting: "m".repeat(201),
      raisedBy: "r".repeat(201),
    });
    expect(long.ok || Object.keys(long.errors).sort()).toEqual(["meeting", "raisedBy", "text"]);
    expect(
      validateParkingDraft({ text: " Fix CI\n now ", meeting: " Daily ", raisedBy: "" })
    ).toEqual({
      ok: true,
      values: { text: "Fix CI now", meeting: "Daily" },
    });
  });

  it("makes an open point, and an edit clears what was emptied", () => {
    const made = newParkingItem({ text: "A", meeting: "M" }, "p9", "2026-11-12T10:00:00Z");
    expect(made).toEqual({
      id: "p9",
      text: "A",
      meeting: "M",
      status: "open",
      createdAt: "2026-11-12T10:00:00Z",
      updatedAt: "2026-11-12T10:00:00Z",
    });
    const edited = editedParkingItem(
      { ...made, raisedBy: "Sam" },
      { text: "B" },
      "2026-11-12T11:00:00Z"
    );
    expect(edited).toEqual({
      id: "p9",
      text: "B",
      status: "open",
      createdAt: "2026-11-12T10:00:00Z",
      updatedAt: "2026-11-12T11:00:00Z",
    });
    expect(changedFields({ ...made, raisedBy: "Sam" }, { text: "B", meeting: "M" })).toEqual([
      "text",
      "raisedBy",
    ]);
  });
});

describe("sending", () => {
  it("turns a point sent with its first link, and Undo puts back the status it had", () => {
    const at = "2026-11-12T10:00:00Z";
    const sent = withParkingLinks(
      item({ status: "discussed" }),
      [link("backlog-story")],
      "discussed",
      at
    );
    expect(sent).toMatchObject({ status: "sent", sentTo: [link("backlog-story")], updatedAt: at });
    const undone = withParkingLinks(sent, [], "discussed", at);
    expect(undone.status).toBe("discussed");
    expect(undone).not.toHaveProperty("sentTo");
    // Undo of a send from a point already sent elsewhere keeps it sent.
    expect(withParkingLinks(sent, [link("impediment")], "sent", at).status).toBe("sent");
    expect(withParkingLinks(sent, [], "sent", at).status).toBe("open");
  });

  it("hands over its words, where it came up and who raised it, with a link back", () => {
    expect(parkingSource(item({ meeting: "Daily Scrum", raisedBy: "Priya" }))).toEqual({
      title: "Who owns the release checklist?",
      description: "Parked in Daily Scrum, raised by Priya.",
      raisedBy: "Priya",
      sourceRef: { tool: "parking-lot", id: "p1" },
    });
    const long = "x".repeat(250);
    expect(parkingSource(item({ text: long })).description).toBe(`${long}\n\nParked in a meeting.`);
  });

  it("matches suggestions to open points: one each, in the points' order, none made up", () => {
    const open = [item({ id: "a" }), item({ id: "b" }), item({ id: "c", status: "dropped" })];
    expect(
      matchSuggestions(
        [
          { id: "b", destination: "impediment", reason: "r1" },
          { id: "zzz", destination: "backlog", reason: "made up" },
          { id: "a", destination: "action", reason: "r2" },
          { id: "a", destination: "drop", reason: "second" },
          { id: "c", destination: "drop", reason: "decided already" },
        ],
        open
      )
    ).toEqual([
      { id: "a", destination: "action", reason: "r2" },
      { id: "b", destination: "impediment", reason: "r1" },
    ]);
  });
});

describe("words and counts", () => {
  it("says when a point was parked", () => {
    expect(parkedWhen(item({ createdAt: "2026-11-12T08:00:00" }), NOW)).toBe("today");
    expect(parkedWhen(item({ createdAt: "2026-11-11T18:00:00" }), NOW)).toBe("yesterday");
    expect(parkedWhen(item({ createdAt: "2026-11-03T09:00:00" }), NOW)).toBe("3 Nov");
    expect(parkedWhen(item({ createdAt: "2025-11-03T09:00:00" }), NOW)).toBe("3 Nov 2025");
    expect(parkedWhen(item({ createdAt: "soon" }), NOW)).toBe("");
  });

  it("counts by status in one line", () => {
    const s = parkingSummary([
      item(),
      item({ id: "2", status: "sent" }),
      item({ id: "3", status: "dropped" }),
    ]);
    expect(s).toEqual({ total: 3, open: 1, discussed: 0, sent: 1, dropped: 1 });
    expect(summaryText(s)).toBe("1 open · 1 sent · 1 dropped");
  });
});

describe("the next step", () => {
  it("points stale open points first, then the review, and leaves the example out", () => {
    expect(parkingLotSteps([], NOW)).toEqual([]);
    expect(parkingLotSteps([item({ id: "example-1" })], NOW)).toEqual([]);
    const [review] = parkingLotSteps([item(), item({ id: "2", status: "sent" })], NOW);
    expect(review).toMatchObject({
      id: "parking-lot-review",
      label: "Review the open parked point",
      href: "/parking-lot",
    });
    expect(review.detail).toContain("“Who owns the release checklist?”");
    const [stale] = parkingLotSteps(
      [
        item({ id: "old", createdAt: "2026-11-01T09:00:00Z" }),
        item({ id: "old2", createdAt: "2026-11-02T09:00:00Z", text: "Second" }),
        item({ id: "new" }),
      ],
      NOW
    );
    expect(stale).toMatchObject({
      id: "parking-lot-stale",
      label: "Decide on the 2 points parked over a week ago",
    });
    expect(stale.detail).toContain(", and 1 other are still open");
  });
});

describe("the export", () => {
  const rows = [
    item({ id: "1", meeting: "Daily Scrum", raisedBy: "Sam", text: "Fix | pipes" }),
    item({
      id: "2",
      meeting: "Daily Scrum",
      status: "sent",
      sentTo: [link("backlog-story"), link("retro-action", "c1")],
      text: "Add CSV export",
    }),
    item({ id: "3", status: "dropped", text: "Old idea" }),
  ];

  it("writes a checklist by meeting, open first, saying where each decided point went", () => {
    expect(toMarkdown(rows, NOW)).toBe(
      [
        "# Parking lot",
        "",
        "12 Nov 2026 · 1 open · 1 sent · 1 dropped",
        "",
        "## Daily Scrum",
        "",
        "- [ ] Fix \\| pipes (raised by Sam)",
        "- [x] Add CSV export — sent to the backlog and Retro Actions",
        "",
        "## No meeting named",
        "",
        "- [x] ~~Old idea~~ — dropped",
        "",
      ].join("\n")
    );
    expect(toMarkdown([], NOW, "Daily Scrum")).toBe(
      "# Parking lot — Daily Scrum\n\nNothing parked yet.\n"
    );
  });

  it("offers one CSV row per point", () => {
    const csv = toCsv(rows);
    expect(csv.headers).toEqual(["Point", "Meeting", "Raised by", "Status", "Sent to", "Parked"]);
    expect(csv.rows[1]).toEqual([
      "Add CSV export",
      "Daily Scrum",
      "",
      "Sent",
      "the backlog and Retro Actions",
      "2026-11-12",
    ]);
  });
});
