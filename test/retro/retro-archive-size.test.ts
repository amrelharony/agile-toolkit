import { describe, expect, it } from "vitest";
import type {
  HandoffLink,
  Impediment,
  RetroBoard,
  RetroCard,
  Sprint,
  SprintGoal,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
} from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import {
  RETRO_ARCHIVE_LIMIT,
  archivedRetroCopy,
  pastRetros,
  retroArchivesToPrune,
} from "@/app/(tools)/retro/archive";
import { RETRO_CARD_MAX } from "@/lib/retro/board";

/**
 * How much room past retros take, and why the limit is 52.
 *
 * Past retros used to stop at 20, about nine months of two-week sprints:
 * the 21st pushed the oldest out, with the actions it agreed. 52 is two
 * years. Everything a visitor makes lives in one localStorage entry
 * ("agile-toolkit:workspace"), under a quota of about 5 MB for the whole
 * site, so the question is whether 52 archived boards fit beside the rest.
 *
 * This file measures it, on boards and a workspace built here as the JSON
 * the store writes. Sizes are counted the strictest way a browser counts
 * them: two bytes per character (strings are UTF-16) against 5 MB. A
 * browser that allows 5 million characters has twice this room. Measured on
 * 2026-11-10:
 *
 *   one archived retro, typical (7 people, 28 cards)      8 KB of JSON, 16 KB stored
 *   one archived retro, busy (10 people, 60 long cards)   20 KB of JSON, 40 KB stored
 *   52 typical retros                                     0.82 MB stored, 16% of the quota
 *   20 typical retros (the old limit)                     0.32 MB stored,  6% of the quota
 *   52 busy retros                                        2.03 MB stored, 41% of the quota
 *   two years of sprint data, no past retros              1.59 MB stored, 32% of the quota
 *   that, with 52 typical retros                          2.41 MB stored, 48% of the quota
 *   that, with 52 busy retros                             3.61 MB stored, 72% of the quota
 *
 * So 52 fit comfortably beside a normal workspace: half the quota is left,
 * and going from 20 to 52 costs 10 points of it. What does not fit
 * comfortably is not the retros. A team that also keeps a standup note from
 * seven people for every working day of two years adds 1.92 MB (38%), more
 * than twice what the retros take: with 52 typical retros that is 87% of
 * the strict quota, and with 52 busy ones it is over. A lower retro limit
 * would not cure that (20 retros would still leave it at 76%), so the limit
 * stays at 52; when storage does run out the store says so ("This browser
 * stopped saving your work") rather than dropping anything, and a backup
 * file has no such limit.
 */

const QUOTA_BYTES = 5 * 1024 * 1024;
/** What a string costs in storage, counted as UTF-16. */
const storedBytes = (json: string) => json.length * 2;
const share = (bytes: number) => bytes / QUOTA_BYTES;

/** Text of about `chars` characters, different for each seed, like what a team types. */
const WORDS =
  "the deploy pipeline keeps failing on Friday afternoons and nobody owns the fix so we pair on reviews earlier and split stories that are too big to finish in one sprint".split(
    " "
  );
function text(seed: number, chars: number): string {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < chars; i++) {
    const word = WORDS[(seed * 7 + i * 13) % WORDS.length];
    out.push(word);
    length += word.length + 1;
  }
  return out.join(" ").slice(0, chars);
}

const iso = (day: number) => new Date(Date.UTC(2025, 0, 6 + day, 9, 30)).toISOString();
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

interface RetroShape {
  people: number;
  cardsEach: number;
  /** Characters in each card's text. */
  chars: number;
  actions: number;
}

/**
 * A finished retro as it is archived: every person's cards with votes, one
 * in four grouped under another, and the actions the team agreed with
 * owners, due dates and where they were sent.
 */
function archivedRetro(n: number, { people, cardsEach, chars, actions }: RetroShape): RetroBoard {
  const format = retroFormats[n % retroFormats.length];
  const keys = format.columns.map((c) => c.key);
  const cards: RetroCard[] = Array.from({ length: people * cardsEach }, (_, i) => {
    const action = i < actions;
    const link: HandoffLink = {
      route: "backlog-story",
      targetId: `story_${n}_${i}`,
      at: iso(n * 14),
    };
    return {
      id: uuid(n * 1000 + i),
      columnKey: keys[i % keys.length],
      text: text(n * 100 + i, chars),
      votes: i % 4,
      groupedWith: i % 4 === 3 ? uuid(n * 1000 + i - 3) : null,
      isActionItem: action,
      assignee: action ? `Person ${i % people}` : "",
      discussing: false,
      ...(action ? { dueDate: iso(n * 14 + 10).slice(0, 10), sentTo: [link] } : {}),
      ...(action && i % 2 === 0 ? { done: true, doneAt: iso(n * 14 + 9) } : {}),
    };
  });
  const board: RetroBoard = {
    id: "retro:current",
    format,
    phase: "actions",
    cards,
    userVotes: 3,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    votesBy: Object.fromEntries(Array.from({ length: people }, (_, p) => [`Person ${p}`, 3])),
    sprintId: `sprint_${n}`,
    previousRetroId: `retro:${iso((n - 1) * 14)}`,
  };
  return archivedRetroCopy(board, new Date(iso(n * 14)));
}

const TYPICAL: RetroShape = { people: 7, cardsEach: 4, chars: 80, actions: 4 };
const BUSY: RetroShape = { people: 10, cardsEach: 6, chars: 140, actions: 8 };

const retros = (count: number, shape: RetroShape) =>
  Array.from({ length: count }, (_, n) => archivedRetro(n + 1, shape));

const SPRINTS = 52;
const TEAM = 7;
const sprintId = (s: number) => `sprint_${s}`;
const sprintStart = (s: number) => (s - 1) * 14;

/**
 * Two years of two-week sprints for a team of seven, with what a Scrum team
 * records every sprint: the sprint and its daily log, 12 stories with
 * notes, acceptance criteria and their status history, two impediments, a
 * goal with its criteria and answer, and a review with five demo items and
 * five feedback notes.
 */
function twoYearsOfSprints() {
  const sprints: Sprint[] = [];
  const sprintSeries: SprintSeries[] = [];
  const stories: Story[] = [];
  const impediments: Impediment[] = [];
  const sprintGoals: SprintGoal[] = [];
  const sprintReviews: SprintReview[] = [];
  for (let s = 1; s <= SPRINTS; s++) {
    const id = sprintId(s);
    const start = sprintStart(s);
    sprints.push({
      id,
      name: `Sprint ${s}`,
      startDate: iso(start).slice(0, 10),
      endDate: iso(start + 13).slice(0, 10),
      goal: text(s, 90),
      pointsPlanned: 34,
      pointsCompleted: 30,
      status: "completed",
    });
    sprintSeries.push({
      id,
      days: Array.from({ length: 11 }, (_, day) => ({
        day,
        remaining: 34 - day * 3,
        scope: 34,
        completed: day * 3,
      })),
    } as SprintSeries);
    for (let i = 0; i < 12; i++) {
      const key = `PAY-${s * 12 + i}`;
      stories.push({
        id: `story_${s}_${i}`,
        title: text(s * 20 + i, 55),
        points: [1, 2, 3, 5, 8][i % 5],
        status: "done",
        sprintId: id,
        owner: `Person ${i % TEAM}`,
        createdAt: iso(start - 5),
        startedAt: iso(start + 2),
        doneAt: iso(start + 9),
        statusHistory: (["todo", "in_progress", "review", "done"] as const).map((status, k) => ({
          status,
          at: iso(start + k * 3),
        })) as Story["statusHistory"],
        sprintHistory: [{ sprintId: id, at: iso(start - 1), points: 3 }],
        readiness: {
          checked: ["value", "criteria", "sized"],
          ready: true,
          updatedAt: iso(start - 2),
        },
        ...(i % 2 === 0 ? { notes: text(s * 30 + i, 160) } : {}),
        ...(i % 3 === 0 ? { acceptanceCriteria: text(s * 40 + i, 220) } : {}),
        ...(i % 4 === 0
          ? { ticketKey: key, link: `https://tracker.example.com/browse/${key}` }
          : {}),
      });
    }
    for (let i = 0; i < 2; i++) {
      impediments.push({
        id: `imp_${s}_${i}`,
        title: text(s * 50 + i, 60),
        severity: "medium",
        raisedAt: iso(start + 3).slice(0, 10),
        resolvedAt: iso(start + 8).slice(0, 10),
        owner: `Person ${i}`,
        description: text(s * 60 + i, 140),
        category: "process",
      });
    }
    sprintGoals.push({
      id: `sprint-goal:sprint:${id}`,
      sprintId: id,
      businessObjective: text(s * 70, 120),
      goal: text(s, 90),
      criteria: Array.from({ length: 3 }, (_, c) => ({
        id: `crit_${s}_${c}`,
        text: text(s * 80 + c, 90),
        relevantChecked: true,
      })),
      keyResults: [],
      outcome: { met: "partly", note: text(s * 90, 80), decidedAt: iso(start + 13) },
    });
    sprintReviews.push({
      id: `sprint-review:sprint:${id}`,
      sprintId: id,
      features: Array.from({ length: 5 }, (_, f) => ({
        id: `feat_${s}_${f}`,
        name: text(s * 100 + f, 50),
        description: text(s * 110 + f, 120),
        acceptanceCriteria: text(s * 120 + f, 120),
        timeMinutes: 5,
      })),
      feedbackItems: Array.from({ length: 5 }, (_, f) => ({
        id: `fb_${s}_${f}`,
        stakeholder: `Stakeholder ${f}`,
        feedback: text(s * 130 + f, 140),
        category: "positive",
      })),
    } as unknown as SprintReview);
  }
  return {
    teamMembers: Array.from({ length: TEAM }, (_, p) => ({
      id: `member_${p}`,
      name: `Person ${p}`,
    })),
    sprints,
    sprintSeries,
    stories,
    impediments,
    sprintGoals,
    sprintReviews,
  };
}

/** A standup note from every person for every working day of those two years: 3,640 of them. */
function twoYearsOfStandupNotes(): StandupEntry[] {
  const entries: StandupEntry[] = [];
  for (let s = 1; s <= SPRINTS; s++) {
    for (let day = 0; day < 10; day++) {
      for (let p = 0; p < TEAM; p++) {
        entries.push({
          id: `standup_${s}_${day}_${p}`,
          member: `Person ${p}`,
          date: iso(sprintStart(s) + day).slice(0, 10),
          yesterday: text(s * 140 + day * 7 + p, 70),
          today: text(s * 150 + day * 7 + p, 70),
          blockers: p === 0 ? text(s * 160 + day, 50) : "",
          timestamp: Date.UTC(2025, 0, 6 + sprintStart(s) + day, 9, 30),
        });
      }
    }
  }
  return entries;
}

/** The entry as the workspace store writes it (zustand's persist wrapper). */
const persisted = (state: object) => JSON.stringify({ state, version: 1 });

describe("the size of past retros", () => {
  it("measures one archived retro: about 16 KB stored for a typical one, 40 KB for a busy one", () => {
    const typical = storedBytes(JSON.stringify(archivedRetro(1, TYPICAL)));
    const busy = storedBytes(JSON.stringify(archivedRetro(1, BUSY)));
    expect(typical).toBeGreaterThan(12 * 1024);
    expect(typical).toBeLessThan(20 * 1024);
    expect(busy).toBeGreaterThan(32 * 1024);
    expect(busy).toBeLessThan(48 * 1024);
  });

  it("keeps 52 typical retros under a fifth of the 5 MB quota, 10 points more than 20 took", () => {
    const fiftyTwo = storedBytes(JSON.stringify(retros(RETRO_ARCHIVE_LIMIT, TYPICAL)));
    const twenty = storedBytes(JSON.stringify(retros(20, TYPICAL)));
    expect(share(fiftyTwo)).toBeLessThan(0.2);
    expect(share(fiftyTwo - twenty)).toBeLessThan(0.12);
  });

  it("fits 52 retros beside two years of sprint data with half the quota to spare", () => {
    const workspace = twoYearsOfSprints();
    // The sprint data on its own: about a third of the quota.
    expect(share(storedBytes(persisted(workspace)))).toBeLessThan(0.35);
    const withRetros = persisted({
      ...workspace,
      retroBoards: retros(RETRO_ARCHIVE_LIMIT, TYPICAL),
    });
    expect(share(storedBytes(withRetros))).toBeLessThan(0.5);
  });

  it("still fits when every one of the 52 retros is a busy one", () => {
    const stored = storedBytes(
      persisted({ ...twoYearsOfSprints(), retroBoards: retros(RETRO_ARCHIVE_LIMIT, BUSY) })
    );
    expect(share(stored)).toBeLessThan(0.8);
  });

  it("is not what fills the quota: two years of daily standup notes take more than twice as much", () => {
    const standupEntries = twoYearsOfStandupNotes();
    const notes = storedBytes(JSON.stringify(standupEntries));
    const fiftyTwo = storedBytes(JSON.stringify(retros(RETRO_ARCHIVE_LIMIT, TYPICAL)));
    expect(notes).toBeGreaterThan(fiftyTwo * 2);

    // With those notes kept too, 52 typical retros still fit, without much room.
    const workspace = { ...twoYearsOfSprints(), standupEntries };
    const total = (count: number) =>
      share(storedBytes(persisted({ ...workspace, retroBoards: retros(count, TYPICAL) })));
    expect(total(RETRO_ARCHIVE_LIMIT)).toBeLessThan(0.9);
    // The old limit of 20 would not have made that workspace comfortable either.
    expect(total(20)).toBeGreaterThan(0.7);
  });

  it("bounds the worst board the page can make, so one retro can't take the quota", () => {
    // 200 cards of the longest text a card can hold.
    const worst = archivedRetro(1, {
      people: 20,
      cardsEach: 10,
      chars: RETRO_CARD_MAX,
      actions: 20,
    });
    expect(share(storedBytes(JSON.stringify(worst)))).toBeLessThan(0.06);
  });
});

describe("the limit on past retros", () => {
  it("is two years of two-week sprints", () => {
    expect(RETRO_ARCHIVE_LIMIT).toBe(52);
  });

  it("drops the oldest only when a 53rd is archived", () => {
    const full = retros(RETRO_ARCHIVE_LIMIT, { people: 1, cardsEach: 1, chars: 10, actions: 0 });
    // 51 past retros and a new one: nothing to drop.
    expect(retroArchivesToPrune(full.slice(1))).toEqual([]);
    // 52 already: the oldest makes room.
    const oldest = pastRetros(full)[RETRO_ARCHIVE_LIMIT - 1];
    expect(retroArchivesToPrune(full)).toEqual([oldest.id]);
  });
});
