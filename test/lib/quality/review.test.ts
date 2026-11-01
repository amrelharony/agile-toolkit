/**
 * lib/quality/review: Code Review Metrics' times, medians and size bands,
 * shared by the page and tool.code_review_metrics.*.
 *
 *   1. reviewTimes — a weekend-spanning review, a holiday, a window, the
 *      same minute, out of order, a bare date, a zone suffix, legacy rows.
 *   2. reviewSummary — median not mean, gated at 3 (P85 at 5); bands;
 *      large PRs with no comments; dense weekly medians, gated at 3 a
 *      week; total adds up.
 *   3. workingBasisLabel, reviewVerdict.
 *   4. sampleErrors / sampleFromDraft / toWallClock.
 *   5. parseReviewCsv — header or positional, row errors (never 0),
 *      duplicates, zones, the cap.
 */

import { describe, expect, it } from "vitest";
import {
  REVIEW_IMPORT_MAX,
  SIZE_BANDS,
  cleanAuthor,
  elapsedHours,
  latestWallClock,
  nowWallClock,
  parseReviewCsv,
  reviewSummary,
  reviewTimes,
  reviewVerdict,
  sampleErrors,
  sampleFromDraft,
  sizeBandOf,
  toWallClock,
  windowMinutes,
  workingBasisLabel,
  workingWindowError,
} from "@/lib/quality/review";
import type { PrSample } from "@/lib/stores/workspace-types";
import { DEFAULT_CALENDAR, type WorkingCalendar } from "@/lib/sprints/calendar";
import { CODE_REVIEW_LOG } from "../../stores/phase8-fixtures";

const NINE_TO_FIVE = { startMinute: 9 * 60, endMinute: 17 * 60 };

let n = 0;
function pr(partial: Partial<PrSample>): PrSample {
  n += 1;
  return {
    id: `pr_${n}`,
    author: "Alice",
    openedAt: "2026-10-19T09:00",
    reviewerCount: 1,
    commentCount: 2,
    linesChanged: 50,
    ...partial,
  };
}

describe("reviewTimes", () => {
  it("counts a Friday-to-Monday review in working hours, not the weekend", () => {
    // Friday 23 Oct 17:00 → Monday 26 Oct 10:00.
    const s = pr({
      openedAt: "2026-10-23T17:00",
      firstReviewAt: "2026-10-26T10:00",
      mergedAt: "2026-10-26T15:00",
    });
    const whole = reviewTimes(s);
    expect(whole.status).toBe("merged");
    expect(whole.toFirstReviewH).toBe(65);
    expect(whole.toFirstReviewWorkingH).toBe(17); // 7 h Friday evening + 10 h Monday
    const windowed = reviewTimes(s, DEFAULT_CALENDAR, NINE_TO_FIVE);
    expect(windowed.toFirstReviewWorkingH).toBe(1);
    expect(windowed.cycleWorkingH).toBe(6);
    expect(windowed.cycleH).toBe(70);
  });

  it("skips the team's holidays", () => {
    const calendar: WorkingCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-26"] };
    const s = pr({ openedAt: "2026-10-23T16:00", mergedAt: "2026-10-27T10:00" });
    expect(reviewTimes(s, calendar, NINE_TO_FIVE).cycleWorkingH).toBe(2); // Fri 1 h + Tue 1 h
  });

  it("is 0 for the same minute and reads a bare date as midnight", () => {
    expect(reviewTimes(pr({ mergedAt: "2026-10-19T09:00" })).cycleWorkingH).toBe(0);
    const bare = reviewTimes(pr({ openedAt: "2026-10-19", mergedAt: "2026-10-20" }));
    expect(bare.cycleH).toBe(24);
  });

  it("reads a zone-suffixed time as written", () => {
    const s = pr({ openedAt: "2026-10-19T09:00:00Z", mergedAt: "2026-10-19T12:30+05:00" });
    expect(reviewTimes(s).cycleH).toBe(3.5);
  });

  it("flags a merge before the open as invalid, never open", () => {
    const legacy = CODE_REVIEW_LOG.samples.find((s) => s.id === "pr_legacy") as PrSample;
    expect(reviewTimes(legacy)).toEqual({
      status: "invalid",
      reviewOutOfOrder: false,
      toFirstReviewH: null,
      toFirstReviewWorkingH: null,
      cycleH: null,
      cycleWorkingH: null,
    });
    expect(reviewTimes(pr({ openedAt: "yesterday" })).status).toBe("invalid");
    expect(reviewTimes(pr({ mergedAt: "soon" })).status).toBe("invalid");
  });

  it("leaves out a first review outside opened … merged, keeping the cycle", () => {
    const t = reviewTimes(pr({ firstReviewAt: "2026-10-21T09:00", mergedAt: "2026-10-20T09:00" }));
    expect(t.reviewOutOfOrder).toBe(true);
    expect(t.toFirstReviewWorkingH).toBeNull();
    expect(t.cycleWorkingH).toBe(24);
  });

  it("is open without a merge", () => {
    const t = reviewTimes(pr({ firstReviewAt: "2026-10-19T11:00" }));
    expect(t.status).toBe("open");
    expect(t.toFirstReviewWorkingH).toBe(2);
    expect(t.cycleH).toBeNull();
  });
});

describe("reviewSummary", () => {
  const merged = (hours: number, lines = 50, extra: Partial<PrSample> = {}) =>
    pr({
      openedAt: "2026-10-19T00:00",
      mergedAt: `2026-10-19T${String(hours).padStart(2, "0")}:00`,
      linesChanged: lines,
      ...extra,
    });

  it("quotes no median below 3 merged PRs, never a mean", () => {
    const two = reviewSummary([merged(1), merged(9)]);
    expect(two.cycle.count).toBe(2);
    expect(two.cycle.average).toBe(5);
    expect(two.headline.medianCycleWorkingH).toBeNull();
  });

  it("quotes the nearest-rank median from 3, and P85 from 5", () => {
    const three = reviewSummary([merged(1), merged(2), merged(12)]);
    expect(three.headline.medianCycleWorkingH).toBe(2); // the mean would be 5
    expect(three.headline.p85CycleWorkingH).toBeNull();
    const five = reviewSummary([merged(1), merged(2), merged(3), merged(4), merged(20)]);
    expect(five.headline.medianCycleWorkingH).toBe(3);
    expect(five.headline.p85CycleWorkingH).toBe(20);
  });

  it("adds up: merged + open + invalid", () => {
    const s = reviewSummary([
      ...CODE_REVIEW_LOG.samples,
      pr({}),
      pr({ firstReviewAt: "2026-10-19T10:00" }),
    ]);
    expect(s).toMatchObject({ total: 4, merged: 1, open: 2, invalid: 1, awaitingReview: 1 });
  });

  it("groups by PR size, with medians per band from 3", () => {
    expect(sizeBandOf(100)).toBe("small");
    expect(sizeBandOf(101)).toBe("medium");
    expect(sizeBandOf(400)).toBe("medium");
    expect(sizeBandOf(401)).toBe("large");
    expect(sizeBandOf(-1)).toBeNull();
    expect(SIZE_BANDS.map((b) => b.id)).toEqual(["small", "medium", "large"]);
    const s = reviewSummary([
      merged(1, 20, { commentCount: 1 }),
      merged(2, 40, { commentCount: 3 }),
      merged(3, 60, { commentCount: 2 }),
      merged(9, 800, { commentCount: 0 }),
      merged(12, 900, { commentCount: 0 }),
      pr({ linesChanged: 1200, commentCount: 4 }),
    ]);
    const [small, medium, large] = s.bySize;
    expect(small).toMatchObject({ n: 3, merged: 3, medianCycleWorkingH: 2, medianComments: 2 });
    expect(medium).toMatchObject({ n: 0, medianCycleWorkingH: null });
    // Two merged large PRs: too few for a median.
    expect(large).toMatchObject({ n: 3, merged: 2, medianCycleWorkingH: null, medianComments: 0 });
    expect(s.largeNoComments).toBe(2);
  });

  it("gives a dense weekly median by merge week, quoted from 3 merges in the week", () => {
    const s = reviewSummary([
      pr({ openedAt: "2026-10-05T09:00", mergedAt: "2026-10-05T10:00" }),
      pr({ openedAt: "2026-10-06T09:00", mergedAt: "2026-10-06T13:00" }),
      pr({ openedAt: "2026-10-06T09:00", mergedAt: "2026-10-06T15:00" }),
      pr({ openedAt: "2026-10-19T09:00", mergedAt: "2026-10-19T11:00" }),
      pr({ openedAt: "2026-10-20T09:00", mergedAt: "2026-10-20T12:00" }),
    ]);
    // W43 has two merges: its n is there, its median isn't (MIN_SAMPLE.average, as the headline).
    expect(s.weekly).toEqual([
      { week: "2026-W41", n: 3, medianCycleWorkingH: 4 },
      { week: "2026-W42", n: 0, medianCycleWorkingH: null },
      { week: "2026-W43", n: 2, medianCycleWorkingH: null },
    ]);
  });

  it("is empty with no samples", () => {
    const s = reviewSummary([]);
    expect(s.total).toBe(0);
    expect(s.weekly).toEqual([]);
    expect(s.headline.medianFirstReviewWorkingH).toBeNull();
    expect(reviewVerdict(s)).toBe("No pull requests logged yet.");
  });
});

describe("workingBasisLabel and reviewVerdict", () => {
  it("says what working hours count", () => {
    expect(workingBasisLabel()).toBe("Mon–Fri, whole days");
    expect(
      workingBasisLabel(
        { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] },
        {
          start: "09:00",
          end: "17:00",
        }
      )
    ).toBe("Mon–Fri, holidays excluded, 09:00–17:00");
    expect(workingBasisLabel({ workingDays: [0, 1, 3, 5, 6], holidays: [] })).toBe(
      "Mon, Wed, Fri–Sun, whole days"
    );
  });

  it("reads the window, and ignores one that can't be used", () => {
    expect(windowMinutes({ start: "09:00", end: "17:30" })).toEqual({
      startMinute: 540,
      endMinute: 1050,
    });
    expect(windowMinutes({ start: "17:00", end: "09:00" })).toBeUndefined();
    expect(windowMinutes(undefined)).toBeUndefined();
    expect(workingWindowError("9", "17:00")).toMatch(/HH:MM/);
    expect(workingWindowError("10:00", "10:00")).toBe("The window must end after it starts.");
    expect(workingWindowError("08:30", "16:30")).toBeNull();
  });

  it("states the medians and how much longer large PRs take", () => {
    const at = (h: number, lines: number, review: number) =>
      pr({
        openedAt: "2026-10-19T00:00",
        firstReviewAt: `2026-10-19T${String(review).padStart(2, "0")}:30`,
        mergedAt: `2026-10-19T${String(h).padStart(2, "0")}:00`,
        linesChanged: lines,
      });
    const s = reviewSummary([
      at(2, 10, 1),
      at(3, 10, 1),
      at(3, 10, 2),
      at(9, 500, 3),
      at(9, 500, 3),
      at(10, 500, 4),
    ]);
    expect(reviewVerdict(s)).toBe(
      "Half of pull requests get a first review within 2.5 working hours and merge within 3; large ones take 3× longer to merge than small ones."
    );
  });

  it("asks for more merged PRs before quoting a median", () => {
    expect(reviewVerdict(reviewSummary([pr({ mergedAt: "2026-10-19T10:00" })]))).toBe(
      "Log 2 more merged pull requests to see the typical review time."
    );
  });
});

describe("sampleErrors, sampleFromDraft and toWallClock", () => {
  const NOW = "2026-10-27T12:00";
  const ok = {
    author: "@alice",
    openedAt: "2026-10-20T09:00",
    firstReviewAt: "2026-10-20T11:00",
    mergedAt: "2026-10-21T10:00",
    reviewerCount: "2",
    commentCount: "0",
    linesChanged: "120",
  };

  it("accepts a draft in order", () => {
    expect(sampleErrors(ok, NOW)).toEqual({});
  });

  it("puts each problem on its field", () => {
    expect(
      sampleErrors(
        {
          author: "@",
          openedAt: "",
          mergedAt: "tomorrow",
          reviewerCount: "",
          commentCount: "-1",
          linesChanged: "1.5",
        },
        NOW
      )
    ).toEqual({
      author: "Enter who opened the pull request.",
      openedAt: "Enter when it was opened.",
      mergedAt: "Enter a date and time as YYYY-MM-DDTHH:MM.",
      reviewerCount: "Enter the number of reviewers.",
      commentCount: "Enter a whole number of 0 or more.",
      linesChanged: "Enter a whole number of 0 or more.",
    });
  });

  it("enforces opened ≤ first review ≤ merged ≤ now", () => {
    expect(sampleErrors({ ...ok, mergedAt: "2026-10-19T09:00", firstReviewAt: "" }, NOW)).toEqual({
      mergedAt: "It can't be merged before it was opened.",
    });
    expect(sampleErrors({ ...ok, firstReviewAt: "2026-10-20T08:00" }, NOW)).toEqual({
      firstReviewAt: "The first review can't come before it was opened.",
    });
    expect(sampleErrors({ ...ok, firstReviewAt: "2026-10-22T08:00" }, NOW)).toEqual({
      firstReviewAt: "The first review can't come after the merge.",
    });
    expect(sampleErrors({ ...ok, mergedAt: "2026-10-27T12:01" }, NOW)).toEqual({
      mergedAt: "That's in the future.",
    });
  });

  it("refuses a PR number another logged PR holds, given them", () => {
    const existing = [
      { id: "pr_1", prNumber: " 412 ", author: "a", openedAt: "2026-10-01T09:00" },
      { id: "pr_2", author: "b", openedAt: "2026-10-02T09:00" },
    ].map((s) => ({ ...s, reviewerCount: 1, commentCount: 0, linesChanged: 10 }));
    expect(sampleErrors({ ...ok, prNumber: "412" }, NOW, { existing })).toEqual({
      prNumber: "Already logged: PR 412.",
    });
    // The PR being edited may keep its own number; a blank number never clashes.
    expect(sampleErrors({ ...ok, prNumber: "412" }, NOW, { existing, editingId: "pr_1" })).toEqual(
      {}
    );
    expect(sampleErrors({ ...ok, prNumber: " " }, NOW, { existing })).toEqual({});
    // Without them (the agent's check), the number isn't compared.
    expect(sampleErrors({ ...ok, prNumber: "412" }, NOW)).toEqual({});
  });

  it("stores the author without '@' and the times as wall-clock", () => {
    expect(sampleFromDraft({ ...ok, description: " ", prNumber: " 412 " }, "pr_x")).toEqual({
      id: "pr_x",
      author: "alice",
      openedAt: "2026-10-20T09:00",
      firstReviewAt: "2026-10-20T11:00",
      mergedAt: "2026-10-21T10:00",
      reviewerCount: 2,
      commentCount: 0,
      linesChanged: 120,
      prNumber: "412",
    });
    expect(cleanAuthor("  @@bob ")).toBe("bob");
  });

  it("drops a zone, or converts it to local time when asked", () => {
    expect(toWallClock("2026-10-20T09:00:59.123Z")).toBe("2026-10-20T09:00");
    expect(toWallClock("2026-10-20")).toBe("2026-10-20T00:00");
    expect(toWallClock("2026-02-30T10:00")).toBeNull();
    const utc = "2026-10-20T09:00:00Z";
    expect(toWallClock(utc, { localize: true })).toBe(nowWallClock(new Date(utc)));
    // A bare date's "-20" is its day, not a zone.
    expect(toWallClock("2026-10-20", { localize: true })).toBe("2026-10-20T00:00");
  });

  it("knows the latest time anyone could call now", () => {
    expect(latestWallClock(new Date("2026-10-27T12:00:00Z"))).toBe("2026-10-28T02:00");
    expect(elapsedHours("2026-10-20T09:00", "2026-10-20T08:00")).toBeNull();
  });
});

describe("parseReviewCsv", () => {
  const HEADER = "PR number,Author,Opened at,First review at,Merged at,Reviewers,Comments,Lines";

  it("reads columns by header name, in any order", () => {
    const csv = `${HEADER}\n412,@alice,2026-10-20T09:00,2026-10-20T11:00,2026-10-21T10:00,2,3,120`;
    const r = parseReviewCsv(csv, { newId: () => "pr_new" });
    expect(r.errors).toEqual([]);
    expect(r.samples).toEqual([
      {
        id: "pr_new",
        prNumber: "412",
        author: "alice",
        openedAt: "2026-10-20T09:00",
        firstReviewAt: "2026-10-20T11:00",
        mergedAt: "2026-10-21T10:00",
        reviewerCount: 2,
        commentCount: 3,
        linesChanged: 120,
      },
    ]);
  });

  it("reports a missing number as a row error, never a 0", () => {
    const csv = `${HEADER}\n1,a,2026-10-20T09:00,,,2,,40\n2,b,yesterday,,,1,1,10`;
    const r = parseReviewCsv(csv);
    expect(r.samples).toEqual([]);
    expect(r.errors).toEqual([
      { row: 2, message: "commentCount: Enter the number of review comments." },
      { row: 3, message: "openedAt: Enter a date and time as YYYY-MM-DDTHH:MM." },
    ]);
  });

  it("refuses a header without a required column", () => {
    const r = parseReviewCsv("Author,Opened at,Reviewers\na,2026-10-20T09:00,1");
    expect(r.errors).toEqual([
      { row: 1, message: "The header has no commentCount, linesChanged columns." },
    ]);
  });

  it("reads a headerless file by position, and flags a short row", () => {
    const csv =
      "7,bob,2026-10-20T09:00,2026-10-20T12:00,1,0,30,Tidy\n8,carol,2026-10-20T09:00,,1,2";
    const r = parseReviewCsv(csv);
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0]).toMatchObject({ prNumber: "7", description: "Tidy", linesChanged: 30 });
    expect(r.errors[0].row).toBe(2);
    expect(r.errors[0].message).toMatch(/at least 7 columns/);
  });

  it("skips PR numbers already logged or earlier in the file", () => {
    const csv = `${HEADER}\n412,a,2026-10-20T09:00,,,1,1,10\n413,a,2026-10-20T09:00,,,1,1,10\n413,b,2026-10-21T09:00,,,1,1,10`;
    const r = parseReviewCsv(csv, { existing: CODE_REVIEW_LOG.samples });
    expect(r.samples.map((s) => s.prNumber)).toEqual(["413"]);
    expect(r.duplicates).toEqual([
      { row: 2, prNumber: "412" },
      { row: 4, prNumber: "413" },
    ]);
  });

  it("reads a tab-separated paste and refuses future times when told now", () => {
    const tsv = "Author\tOpened at\tReviewers\tComments\tLines\na\t2026-10-29T09:00\t1\t0\t5";
    const r = parseReviewCsv(tsv, { now: "2026-10-27T12:00" });
    expect(r.errors).toEqual([{ row: 2, message: "openedAt: That's in the future." }]);
  });

  it("judges the order after localising zone-suffixed times", () => {
    const csv = `Author,Opened at,Merged at,Reviewers,Comments,Lines\na,2026-10-20T09:00:00Z,2026-10-20T10:00:00Z,1,1,10`;
    const r = parseReviewCsv(csv, { localize: true });
    expect(r.samples[0].openedAt).toBe(nowWallClock(new Date("2026-10-20T09:00:00Z")));
    expect(r.samples[0].mergedAt).toBe(nowWallClock(new Date("2026-10-20T10:00:00Z")));
  });

  it("reads at most REVIEW_IMPORT_MAX rows", () => {
    const line = "a,2026-10-20T09:00,1,1,10";
    const csv = [
      "Author,Opened at,Reviewers,Comments,Lines",
      ...Array(REVIEW_IMPORT_MAX + 3).fill(line),
    ].join("\n");
    const r = parseReviewCsv(csv);
    expect(r.samples).toHaveLength(REVIEW_IMPORT_MAX);
    expect(r.notRead).toBe(3);
  });

  it("is empty for an empty paste", () => {
    expect(parseReviewCsv("")).toEqual({ samples: [], errors: [], duplicates: [], notRead: 0 });
  });
});
