/**
 * lib/flow items: stories and Flow-board cards as FlowItems.
 *
 *   - the two workflows, and a "backlog" story reading as To do;
 *   - a story's arrival (sprint move, else planning move, else creation,
 *     else the sprint start), its start and its done day (doneOn);
 *   - moves from the recorded history, and rebuilt from the stamps when there
 *     is none, it began mid-way, it was capped, or it ends elsewhere;
 *   - reopened items aren't done; examples are left out unless asked for;
 *   - stageOn day by day, bucketed by local day.
 */

import { describe, expect, it } from "vitest";
import {
  BOARD_WORKFLOW,
  SPRINT_WORKFLOW,
  cardItems,
  doneOn,
  stageKind,
  stageOn,
  storyItems,
  workflowOf,
} from "@/lib/flow";
import { KANBAN_HISTORY_CAP, movedCard } from "@/lib/kanban/flow";
import { STORY_STATUS_HISTORY_CAP } from "@/lib/sprints/story-status";
import type { KanbanCard, StoryStatusChange } from "@/lib/stores/workspace-types";
import { card, local, sprint, story } from "./fixtures";

describe("workflows", () => {
  it("lists each board's stages in order, one done stage, last", () => {
    for (const wf of [SPRINT_WORKFLOW, BOARD_WORKFLOW]) {
      expect(wf.stages.filter((s) => s.kind === "done")).toHaveLength(1);
      expect(wf.stages[wf.stages.length - 1].kind).toBe("done");
    }
    expect(SPRINT_WORKFLOW.stages.map((s) => `${s.id}:${s.kind}`)).toEqual([
      "todo:queue",
      "in_progress:active",
      "review:active",
      "done:done",
    ]);
    expect(BOARD_WORKFLOW.stages.map((s) => `${s.id}:${s.kind}`)).toEqual([
      "backlog:queue",
      "ready:queue",
      "in_progress:active",
      "review:active",
      "done:done",
    ]);
    expect(workflowOf({ kind: "story" })).toBe(SPRINT_WORKFLOW);
    expect(workflowOf({ kind: "card" })).toBe(BOARD_WORKFLOW);
    expect(stageKind({ kind: "card", stage: "ready" })).toBe("queue");
    expect(stageKind({ kind: "story", stage: "ready" })).toBeNull();
  });
});

describe("storyItems", () => {
  const planned = story("a", {
    status: "in_progress",
    owner: " Amira ",
    points: 5,
    createdAt: local("2026-10-01"),
    startedAt: local("2026-10-07", 10),
    statusHistory: [
      { status: "todo", from: "backlog", at: local("2026-10-05", 9) },
      { status: "in_progress", from: "todo", at: local("2026-10-07", 10) },
    ],
    sprintHistory: [{ sprintId: "s1", at: local("2026-10-05", 9) }],
  });

  it("reads a story's stage, arrival, start and moves from its history", () => {
    const [item] = storyItems([planned]);
    expect(item).toEqual({
      id: "a",
      title: "Story a",
      kind: "story",
      stage: "in_progress",
      arrivedOn: "2026-10-05",
      startedOn: "2026-10-07",
      doneOn: null,
      // Planning it in (backlog to to do) isn't a move on the Sprint board.
      moves: [{ to: "in_progress", from: "todo", at: local("2026-10-07", 10) }],
      basis: "history",
      blocked: false,
      owner: "Amira",
      points: 5,
      sprintId: "s1",
    });
    expect(stageOn(item, "2026-10-04")).toBeNull();
    expect(stageOn(item, "2026-10-05")).toBe("todo");
    expect(stageOn(item, "2026-10-06")).toBe("todo");
    expect(stageOn(item, "2026-10-07")).toBe("in_progress");
    expect(stageOn(item, "2026-10-30")).toBe("in_progress");
    expect(stageOn(item, "not a day")).toBeNull();
  });

  it("reads a story still marked backlog in a sprint as To do", () => {
    const [item] = storyItems([story("b", { status: "backlog" })]);
    expect(item.stage).toBe("todo");
    expect(item.startedOn).toBeNull();
  });

  it("dates the arrival by the sprint move, else the latest planning move, else creation, else the sprint start", () => {
    const s1 = sprint();
    const arrival = (patch: Parameters<typeof story>[1]) =>
      storyItems([story("x", patch)], { sprint: s1 })[0].arrivedOn;
    // Its first move into this sprint, not an earlier sprint's.
    expect(
      arrival({
        sprintHistory: [
          { sprintId: "s0", at: local("2026-09-20") },
          { sprintId: "s1", from: "s0", at: local("2026-10-04"), carriedOver: true },
        ],
      })
    ).toBe("2026-10-04");
    // Sprint Planning writes backlog to to do each time it plans the story in.
    expect(
      arrival({
        statusHistory: [
          { status: "todo", from: "backlog", at: local("2026-09-21") },
          { status: "backlog", from: "todo", at: local("2026-10-02") },
          { status: "todo", from: "backlog", at: local("2026-10-06") },
        ],
      })
    ).toBe("2026-10-06");
    expect(arrival({ createdAt: local("2026-10-03", 23, 30) })).toBe("2026-10-03");
    expect(arrival({})).toBe("2026-10-05");
    // Without a sprint to fall back on, nothing says.
    expect(storyItems([story("x")])[0].arrivedOn).toBeNull();
  });

  it("keeps only the sprint's stories when given one, and leaves examples out unless asked", () => {
    const stories = [planned, story("other", { sprintId: "s2" }), story("example-1")];
    expect(storyItems(stories).map((i) => i.id)).toEqual(["a", "other"]);
    expect(storyItems(stories, { sprint: sprint() }).map((i) => i.id)).toEqual(["a"]);
    expect(
      storyItems(stories, { sprint: sprint(), includeExamples: true }).map((i) => i.id)
    ).toEqual(["a", "example-1"]);
    expect(storyItems([])).toEqual([]);
  });

  it("dates done only while the story is done: a reopened story isn't finished", () => {
    const history: StoryStatusChange[] = [
      { status: "todo", from: "backlog", at: local("2026-10-05") },
      { status: "in_progress", from: "todo", at: local("2026-10-06") },
      { status: "done", from: "in_progress", at: local("2026-10-08") },
      { status: "review", from: "done", at: local("2026-10-09") },
    ];
    const [reopened] = storyItems([
      story("r", { status: "review", startedAt: local("2026-10-06"), statusHistory: history }),
    ]);
    expect(reopened.doneOn).toBeNull();
    expect(reopened.startedOn).toBe("2026-10-06");
    expect(stageOn(reopened, "2026-10-08")).toBe("done");
    expect(stageOn(reopened, "2026-10-09")).toBe("review");

    const [done] = storyItems([
      story("d", {
        status: "done",
        startedAt: local("2026-10-06"),
        doneAt: local("2026-10-10", 23, 45),
        statusHistory: [
          ...history,
          { status: "done", from: "review", at: local("2026-10-10", 23, 45) },
        ],
      }),
    ]);
    expect(done.doneOn).toBe("2026-10-10");
    expect(done.basis).toBe("history");
  });

  it("rebuilds a story with no history from its stamps", () => {
    const [item] = storyItems([
      story("s", {
        status: "done",
        createdAt: local("2026-10-01"),
        startedAt: local("2026-10-02"),
        doneAt: local("2026-10-04"),
        blocked: true,
      }),
    ]);
    expect(item.basis).toBe("stamps");
    expect(item.moves.map((m) => `${m.from}>${m.to}`)).toEqual([
      "todo>in_progress",
      "in_progress>done",
    ]);
    expect(stageOn(item, "2026-10-01")).toBe("todo");
    expect(stageOn(item, "2026-10-03")).toBe("in_progress");
    expect(stageOn(item, "2026-10-04")).toBe("done");
    expect(item).toMatchObject({ startedOn: "2026-10-02", doneOn: "2026-10-04" });
    // A done story isn't blocked, whatever the flag says.
    expect(item.blocked).toBe(false);
  });

  it("marks a capped history as stamps, reading the stage before it from its first entry", () => {
    // Back and forth between In progress and Review, one move a day from 1 August.
    const statusHistory: StoryStatusChange[] = Array.from(
      { length: STORY_STATUS_HISTORY_CAP },
      (_, i) => ({
        status: i % 2 ? "review" : "in_progress",
        from: i % 2 ? "in_progress" : "review",
        at: new Date(2026, 7, 1 + i, 9).toISOString(),
      })
    );
    const [item] = storyItems([
      story("c", { status: "review", startedAt: statusHistory[0].at, statusHistory }),
    ]);
    expect(item.basis).toBe("stamps");
    expect(stageOn(item, "2026-07-31")).toBe("review");
    expect(stageOn(item, "2026-08-01")).toBe("in_progress");
    expect(stageOn(item, "2026-08-02")).toBe("review");
    // A history that still starts with the creation (no `from`) wasn't capped.
    const [full] = storyItems([
      story("f", {
        status: "review",
        statusHistory: [{ status: "review", at: local("2026-09-01") }],
      }),
    ]);
    expect(full.basis).toBe("history");
    expect(stageOn(full, "2026-08-31")).toBeNull();
  });

  it("ends the moves where the story is when the history disagrees (a hand edit)", () => {
    const [item] = storyItems([
      story("h", {
        status: "done",
        startedAt: local("2026-10-06"),
        doneAt: local("2026-10-09"),
        statusHistory: [{ status: "in_progress", from: "todo", at: local("2026-10-06") }],
      }),
    ]);
    expect(item.basis).toBe("stamps");
    expect(stageOn(item, "2026-10-08")).toBe("in_progress");
    expect(stageOn(item, "2026-10-09")).toBe("done");
    expect(item.doneOn).toBe("2026-10-09");
  });
});

describe("doneOn", () => {
  it("is the local day of doneAt, else the last move into done, else null", () => {
    expect(doneOn({ doneAt: local("2026-10-20", 23, 30) })).toBe("2026-10-20");
    expect(doneOn({ doneAt: local("2026-10-21", 0, 30) })).toBe("2026-10-21");
    expect(
      doneOn({
        statusHistory: [
          { status: "done", from: "review", at: local("2026-10-02") },
          { status: "review", from: "done", at: local("2026-10-03") },
          { status: "done", from: "review", at: local("2026-10-05", 23, 59) },
        ],
      })
    ).toBe("2026-10-05");
    expect(doneOn({ doneAt: "2026-10-07" })).toBe("2026-10-07");
    expect(doneOn({})).toBeNull();
  });
});

describe("cardItems", () => {
  /** A card moved through the board with the page's own writer. */
  function walked(): KanbanCard {
    let c = card("w", { assignee: "  Ben " });
    c = movedCard(c, "ready", local("2026-10-02"));
    c = movedCard(c, "in_progress", local("2026-10-03"));
    c = movedCard(c, "review", local("2026-10-05"));
    return movedCard(c, "done", local("2026-10-06", 23, 50));
  }

  it("reads a card's moves from its history", () => {
    const [item] = cardItems([walked()]);
    expect(item).toMatchObject({
      kind: "card",
      stage: "done",
      arrivedOn: "2026-10-01",
      startedOn: "2026-10-03",
      doneOn: "2026-10-06",
      basis: "history",
      owner: "Ben",
    });
    expect(item.moves).toHaveLength(4);
    expect(stageOn(item, "2026-09-30")).toBeNull();
    expect(stageOn(item, "2026-10-01")).toBe("backlog");
    expect(stageOn(item, "2026-10-02")).toBe("ready");
    expect(stageOn(item, "2026-10-04")).toBe("in_progress");
    expect(stageOn(item, "2026-10-05")).toBe("review");
    expect(stageOn(item, "2026-10-06")).toBe("done");
  });

  it("rebuilds a card without history from its stamps", () => {
    const [item] = cardItems([
      card("s", {
        column: "review",
        startedAt: local("2026-10-03"),
        columnSince: local("2026-10-05"),
      }),
    ]);
    expect(item.basis).toBe("stamps");
    expect(stageOn(item, "2026-10-02")).toBe("backlog");
    expect(stageOn(item, "2026-10-04")).toBe("in_progress");
    expect(stageOn(item, "2026-10-05")).toBe("review");
    expect(item.startedOn).toBe("2026-10-03");
    // Never moved: exact, nothing was rebuilt.
    expect(cardItems([card("n")])[0]).toMatchObject({
      basis: "history",
      moves: [],
      stage: "backlog",
    });
  });

  it("fills the moves from before a history that began mid-way from the stamps", () => {
    // Started before the history was kept, then moved to Review with it.
    const older = card("o", { column: "in_progress", startedAt: local("2026-10-03") });
    const [item] = cardItems([movedCard(older, "review", local("2026-10-06"))]);
    expect(item.basis).toBe("stamps");
    expect(stageOn(item, "2026-10-02")).toBe("backlog");
    expect(stageOn(item, "2026-10-04")).toBe("in_progress");
    expect(stageOn(item, "2026-10-06")).toBe("review");
  });

  it("marks a capped history as stamps", () => {
    let c = card("c", { column: "in_progress", startedAt: local("2026-09-01") });
    for (let i = 0; i < KANBAN_HISTORY_CAP + 3; i++) {
      c = movedCard(c, i % 2 ? "in_progress" : "review", local("2026-09-02", 0, i));
    }
    expect(c.history).toHaveLength(KANBAN_HISTORY_CAP);
    expect(cardItems([c])[0].basis).toBe("stamps");
  });

  it("gives a card dropped straight into Done no start, and counts only cards in Done as done", () => {
    const dropped = movedCard(card("d", { column: "ready" }), "done", local("2026-10-04"));
    const [item] = cardItems([dropped]);
    expect(item).toMatchObject({ stage: "done", startedOn: null, doneOn: "2026-10-04" });
    // Moved out of Done by an older agent write, which left the stamp behind.
    const [stale] = cardItems([
      card("r", {
        column: "review",
        startedAt: local("2026-10-02"),
        completedAt: local("2026-10-03"),
      }),
    ]);
    expect(stale.doneOn).toBeNull();
  });

  it("leaves examples out unless asked, reads an unknown column as Backlog, and drops a done card's flag", () => {
    const cards = [
      card("example-kanban-1"),
      card("u", { column: "icebox" as never }),
      card("b", { column: "done", blocked: true, completedAt: local("2026-10-02") }),
    ];
    expect(cardItems(cards).map((i) => i.id)).toEqual(["u", "b"]);
    expect(cardItems(cards, { includeExamples: true })).toHaveLength(3);
    expect(cardItems(cards)[0].stage).toBe("backlog");
    expect(cardItems(cards)[1].blocked).toBe(false);
    expect(cardItems([])).toEqual([]);
  });
});
