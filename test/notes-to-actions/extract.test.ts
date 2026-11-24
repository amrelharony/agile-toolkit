// @vitest-environment node
/**
 * Notes to Actions without AI and the check on what AI finds: the keyword
 * rules pick actions, decisions, blockers, bugs, stories and questions from
 * lines and sentences, with owners and due dates from the notes; grounding
 * drops an item whose quote isn't in the notes, an owner who is neither on
 * the team nor named, and a due date before the meeting. The model's sends,
 * forgetting, counts, reader and next step are here too.
 */

import { describe, expect, it } from "vitest";
import {
  FOUND_MAX,
  extractByRules,
  groundedItems,
  noteLines,
  type FoundItem,
} from "@/lib/notes-to-actions/extract";
import {
  ROUTES_BY_KIND,
  alreadyKept,
  forgetText,
  isNoteDone,
  itemSource,
  keptItem,
  noteCounts,
  notesToActionsSteps,
  readMeetingNote,
  readMeetingNotes,
  routeOf,
  withItemLinks,
} from "@/lib/notes-to-actions/model";
import type { MeetingNote, MeetingNoteItem } from "@/lib/stores/workspace-types";

const FRI = "2026-11-20";
const NOTES = [
  "Sprint Review notes",
  "- Ana to update the onboarding copy by Friday",
  "- Decided: we stop supporting the old export",
  "- Waiting on legal sign-off for the cookie banner",
  "- CSV export cuts off long names",
  "- Do we demo on staging or live?",
  "- The demo went well. Everyone liked the new search.",
].join("\n");

describe("noteLines", () => {
  it("splits lines and sentences, and drops bullets", () => {
    expect(noteLines("- One thing. Another thing\n\n* Third?\n1. Fourth")).toEqual([
      "One thing.",
      "Another thing",
      "Third?",
      "Fourth",
    ]);
  });
});

describe("extractByRules", () => {
  it("finds the example's five items, with the owner and the due date, and skips plain lines", () => {
    const items = extractByRules({ notes: NOTES, date: FRI });
    expect(items.map((i) => [i.kind, i.text])).toEqual([
      ["action", "Ana to update the onboarding copy by Friday"],
      ["decision", "We stop supporting the old export"],
      ["impediment", "Waiting on legal sign-off for the cookie banner"],
      ["bug", "CSV export cuts off long names"],
      ["question", "Do we demo on staging or live?"],
    ]);
    expect(items[0]).toMatchObject({ owner: "Ana", due: "2026-11-20" });
    expect(items[1].quote).toBe("Decided: we stop supporting the old export");
  });

  it.each([
    ["Action: book the room", "action", "Book the room"],
    ["TODO update the runbook", "action", "Update the runbook"],
    ["[ ] send the survey", "action", "Send the survey"],
    ["Ping @Sam about the keys", "action", "Ping @Sam about the keys"],
    ["We agreed to keep the WIP limit at 3", "decision", "We agreed to keep the WIP limit at 3"],
    ["We'll go with Postgres", "decision", "We'll go with Postgres"],
    ["Blocked on the security review", "impediment", "Blocked on the security review"],
    ["Bug: the login page crashes on Safari", "bug", "The login page crashes on Safari"],
    ["Error when exporting to PDF", "bug", "Error when exporting to PDF"],
    ["We need to build a refund screen", "story", "We need to build a refund screen"],
    ["Feature request: dark mode", "story", "Dark mode"],
    ["Q: who owns the release notes", "question", "Who owns the release notes"],
  ])("“%s” → %s", (line, kind, text) => {
    const [item] = extractByRules({ notes: line, date: FRI });
    expect(item).toMatchObject({ kind, text, quote: line });
  });

  it("names the owner of '<Name> will', and not of 'We will'", () => {
    expect(extractByRules({ notes: "Priya will chase the vendor", date: FRI })[0].owner).toBe(
      "Priya"
    );
    expect(extractByRules({ notes: "We will chase the vendor", date: FRI })).toEqual([]);
  });

  it("reads 'went down well' as praise, and 'the site went down' as a blocker", () => {
    const notes = [
      "- The new search went down well with the three customers who came.",
      "- The demo goes down really well every time",
      "- The site went down twice on Monday",
    ].join("\n");
    expect(extractByRules({ notes, date: FRI }).map((i) => [i.kind, i.text])).toEqual([
      ["impediment", "The site went down twice on Monday"],
    ]);
  });

  it("reads the end of the sprint from the running sprint", () => {
    const [item] = extractByRules({
      notes: "Action: merge the branch by end of sprint",
      date: FRI,
      sprintEnd: "2026-11-27",
    });
    expect(item.due).toBe("2026-11-27");
  });

  it("finds each item once, and at most 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Action: task ${i}`).join("\n");
    expect(extractByRules({ notes: many, date: FRI })).toHaveLength(FOUND_MAX);
    expect(extractByRules({ notes: "Action: x\nAction: x", date: FRI })).toHaveLength(1);
  });
});

describe("groundedItems", () => {
  const found = (over: Partial<FoundItem>): FoundItem => ({
    kind: "action",
    text: "Update the copy",
    quote: "Ana to update the onboarding copy by Friday",
    ...over,
  });

  it("keeps an item quoted from the notes, whatever the case and spacing", () => {
    const [item] = groundedItems(
      [found({ quote: "  ana TO update   the onboarding copy by friday " })],
      NOTES,
      { date: FRI }
    );
    expect(item?.text).toBe("Update the copy");
  });

  it("drops an invented item, an unknown kind and a repeat", () => {
    expect(
      groundedItems(
        [
          found({ quote: "Ana to rewrite the whole site" }),
          found({ kind: "risk" as never }),
          found({}),
          found({}),
        ],
        NOTES,
        { date: FRI }
      )
    ).toHaveLength(1);
  });

  it("keeps an owner on the roster (its spelling) or named in the notes, and no other", () => {
    const roster = [{ name: "Ana Lima" }, { name: "sam" }];
    const out = groundedItems(
      [
        found({ owner: "Ana" }),
        found({ text: "B", owner: "SAM" }),
        found({ text: "C", owner: "Bob" }),
      ],
      NOTES,
      { roster, date: FRI }
    );
    expect(out.map((i) => i.owner)).toEqual(["Ana", "sam", undefined]);
  });

  it("keeps a real due date on or after the meeting only", () => {
    const out = groundedItems(
      [
        found({ due: "2026-11-27" }),
        found({ text: "B", due: "2026-11-01" }),
        found({ text: "C", due: "2026-02-30" }),
      ],
      NOTES,
      { date: FRI }
    );
    expect(out.map((i) => i.due)).toEqual(["2026-11-27", undefined, undefined]);
  });

  it("checks a quote cut short up to its ellipsis", () => {
    const [item] = groundedItems([found({ quote: "Ana to update the onboarding…" })], NOTES, {
      date: FRI,
    });
    expect(item?.quote).toBe("Ana to update the onboarding");
  });
});

/* ── The model ──────────────────────────────────────────────────────── */

const AT = "2026-11-20T10:00:00.000Z";
const item = (id: string, over: Partial<MeetingNoteItem> = {}): MeetingNoteItem => ({
  id,
  kind: "action",
  text: `Item ${id}`,
  status: "open",
  keptAt: AT,
  quote: `Quote ${id}`,
  ...over,
});
const note = (over: Partial<MeetingNote> = {}): MeetingNote => ({
  id: "mnote_a",
  meeting: "Sprint Review",
  date: FRI,
  text: NOTES,
  items: [item("i1"), item("i2", { kind: "decision", detail: "Context" })],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe("the model", () => {
  it("sends each kind on its route, and a question nowhere", () => {
    expect(ROUTES_BY_KIND).toEqual({
      action: "retro-action",
      decision: "decision",
      impediment: "impediment",
      story: "backlog-story",
      bug: "bug",
    });
    expect(routeOf("question")).toBeNull();
  });

  it("hands over the words, detail, owner and due, never the quote; a decision as proposed", () => {
    const action = itemSource(note(), item("i1", { owner: "Ana", due: "2026-11-27" }));
    expect(action).toEqual({
      title: "Item i1",
      owner: "Ana",
      due: "2026-11-27",
      sourceRef: { tool: "notes-to-actions", id: "i1", doc: "mnote_a" },
    });
    const decision = itemSource(
      note(),
      item("i2", { kind: "decision", detail: "Ctx", due: "2026-12-01" })
    );
    expect(decision).toEqual({
      title: "Item i2",
      description: "Ctx",
      decision: { recommendation: "Item i2" },
      sourceRef: { tool: "notes-to-actions", id: "i2", doc: "mnote_a" },
    });
    expect(JSON.stringify([action, decision])).not.toContain("Quote");
  });

  it("forgets the text and every quote, keeping the items and their details", () => {
    const forgotten = forgetText(note(), AT);
    expect(forgotten.text).toBe("");
    expect(forgotten.forgottenAt).toBe(AT);
    expect(forgotten.items.map((i) => i.quote)).toEqual([undefined, undefined]);
    expect(forgotten.items[1].detail).toBe("Context");
  });

  it("keeps a found item open and stamped, and knows one already kept", () => {
    expect(keptItem({ kind: "bug", text: " Crash ", quote: "q", due: "bad" }, "m1", AT)).toEqual({
      id: "m1",
      kind: "bug",
      text: "Crash",
      quote: "q",
      status: "open",
      keptAt: AT,
    });
    expect(alreadyKept(note(), { kind: "action", text: "item  I1", quote: "x" })).toBe(true);
    expect(alreadyKept(note(), { kind: "bug", text: "Item i1", quote: "x" })).toBe(false);
  });

  it("knows an item kept in other words by the line it came from, while its quote is there", () => {
    const other = { kind: "action" as const, text: "Something else" };
    expect(alreadyKept(note(), { ...other, quote: "quote  I1" })).toBe(true);
    expect(alreadyKept(note(), { ...other, kind: "bug", quote: "Quote i1" })).toBe(false);
    expect(alreadyKept(note(), { ...other, quote: "" })).toBe(false);
    expect(alreadyKept(forgetText(note(), AT), { ...other, quote: "Quote i1" })).toBe(false);
  });

  it("counts by status, and is done once nothing is open", () => {
    const n = note({ items: [item("a", { status: "sent" }), item("b", { status: "answered" })] });
    expect(noteCounts(n)).toEqual({ total: 2, open: 0, sent: 1, dropped: 0, answered: 1 });
    expect(isNoteDone(n)).toBe(true);
    expect(isNoteDone(note({ items: [] }))).toBe(false);
  });

  it("turns sent with a live link and back to open when Undo takes it", () => {
    const link = { route: "retro-action" as const, targetId: "t", at: AT };
    const sent = withItemLinks(item("a"), [link], "open", () => true);
    expect(sent).toMatchObject({ status: "sent", sentTo: [link] });
    const undone = withItemLinks(sent, [], "open", () => true);
    expect(undone.status).toBe("open");
    expect(undone.sentTo).toBeUndefined();
  });

  it("reads stored rows defensively, and a forgotten note keeps no text or quote", () => {
    const read = readMeetingNote({
      id: "n",
      date: FRI,
      text: "stale text",
      forgottenAt: AT,
      items: [item("a"), { id: "b", kind: "nope", text: "x" }, { id: "c", text: "No kind" }],
    });
    expect(read?.text).toBe("");
    expect(read?.items.map((i) => [i.id, i.quote])).toEqual([["a", undefined]]);
    expect(readMeetingNote({ id: "n", date: "nope" })).toBeNull();
    expect(
      readMeetingNotes([
        { id: "old", date: "2026-11-01", items: [] },
        { id: "new", date: FRI, items: [] },
      ]).map((n) => n.id)
    ).toEqual(["new", "old"]);
  });
});

describe("the next step", () => {
  const NOW = new Date("2026-11-22T10:00:00.000Z");

  it("asks to send the open items of the note that has waited longest", () => {
    expect(notesToActionsSteps({ notes: [note()] }, NOW)).toEqual([
      {
        id: "notes-to-actions-send",
        label: "Send the 2 open items from Sprint Review notes",
        detail: "Kept items wait here until each is sent, answered or dropped.",
        href: "/notes-to-actions?note=mnote_a",
      },
    ]);
  });

  it("waits a day, and leaves the example's notes and finished notes out", () => {
    const fresh = new Date("2026-11-20T20:00:00.000Z");
    expect(notesToActionsSteps({ notes: [note()] }, fresh)).toEqual([]);
    expect(notesToActionsSteps({ notes: [note({ id: "example-notes" })] }, NOW)).toEqual([]);
    expect(
      notesToActionsSteps({ notes: [note({ items: [item("a", { status: "sent" })] })] }, NOW)
    ).toEqual([]);
    expect(notesToActionsSteps({ notes: undefined }, NOW)).toEqual([]);
  });
});
