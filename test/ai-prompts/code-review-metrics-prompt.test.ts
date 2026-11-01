// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateCodeReviewPrompts } from "@/lib/ai-prompts/code-review-metrics";
import type { PrSample } from "@/lib/stores/workspace-types";

/**
 * The code-review prompt reads the log as the page does
 * (lib/quality/review): medians, never means, in the team's working hours
 * with the basis they count (the log's window, or whole working days),
 * time to first review beside the cycle, the team view by PR size with no
 * author anywhere, the weekly median and each PR's times.
 */

const pr = (id: string, extra: Partial<PrSample>): PrSample => ({
  id,
  author: "dana",
  openedAt: "2026-10-19T09:00",
  reviewerCount: 1,
  commentCount: 1,
  linesChanged: 50,
  ...extra,
});

const SAMPLES: PrSample[] = [
  pr("p1", {
    prNumber: "101",
    firstReviewAt: "2026-10-19T11:00",
    mergedAt: "2026-10-19T15:00",
    commentCount: 2,
  }),
  pr("p2", {
    prNumber: "102",
    openedAt: "2026-10-19T10:00",
    firstReviewAt: "2026-10-19T14:00",
    mergedAt: "2026-10-20T10:00",
    linesChanged: 80,
    commentCount: 3,
  }),
  pr("p3", {
    prNumber: "103",
    openedAt: "2026-10-20T09:00",
    firstReviewAt: "2026-10-20T10:00",
    mergedAt: "2026-10-20T12:00",
    linesChanged: 30,
  }),
  pr("p4", {
    prNumber: "104",
    author: "sam",
    openedAt: "2026-10-21T09:00",
    mergedAt: "2026-10-23T17:00",
    linesChanged: 600,
    commentCount: 0,
    description: "Big `refactor`",
  }),
  pr("p5", { prNumber: "105", openedAt: "2026-10-26T09:00", linesChanged: 120 }),
];

const WINDOW = { start: "09:00", end: "17:00" };

describe("generateCodeReviewPrompts", () => {
  const [bottlenecks, size] = generateCodeReviewPrompts({
    samples: SAMPLES,
    workingWindow: WINDOW,
  });

  it("quotes medians in working hours with the basis, first review beside the cycle", () => {
    expect(bottlenecks.prompt).toContain(
      "Working hours count Mon–Fri, 09:00–17:00. 5 pull requests: 4 merged, 1 open (1 still waiting for a first review)."
    );
    expect(bottlenecks.prompt).toContain(
      "Median time to first review: 2 h working (2 h elapsed). Median cycle, opened to merged: 6 h working (6 h elapsed). P85 cycle: — (needs 5 merged PRs)."
    );
    expect(bottlenecks.prompt).toContain(
      "Verdict: Half of pull requests get a first review within 2 working hours and merge within 6."
    );
  });

  it("gives the team view by PR size and the weekly median, with no author anywhere", () => {
    expect(size.prompt).toContain("| Up to 100 lines | 3 | 3 | 2 | 6 | 2 |");
    expect(size.prompt).toContain("| Over 400 lines | 1 | 1 | — | — | — |");
    expect(size.prompt).toContain("Large PRs (over 400 lines) merged with no review comment: 1.");
    expect(size.prompt).toContain("| Week 43, 2026 | 4 | 6 |");
    expect(size.prompt).not.toMatch(/dana|\bsam\b|author/i);
  });

  it("lists each PR's working times, an open one waiting for review", () => {
    expect(bottlenecks.prompt).toContain("| 102 | Up to 100 lines | 80 | 4 h | 8 h | 1 | 3 | — |");
    expect(bottlenecks.prompt).toContain(
      "| 104 | Over 400 lines | 600 | — | 24 h | 1 | 0 | Big 'refactor' |"
    );
    expect(bottlenecks.prompt).toContain(
      "| 105 | 101–400 lines | 120 | Waiting | Open | 1 | 1 | — |"
    );
  });

  it("counts whole working days without a window, and says what a median needs", () => {
    const [p] = generateCodeReviewPrompts({ samples: SAMPLES.slice(3) });
    expect(p.prompt).toContain("Working hours count Mon–Fri, whole days.");
    expect(p.prompt).toContain(
      "Median time to first review: — (needs 3 PRs with a first review). Median cycle, opened to merged: — (needs 3 merged PRs)."
    );
    expect(generateCodeReviewPrompts({ samples: [] })).toEqual([]);
  });

  it("lists the latest 12 weeks, says so, and reads the weekly summary over all of them", () => {
    // Three 2-hour merges a week for 13 weeks, the first in week 31.
    const day = (offset: number) =>
      new Date(Date.UTC(2026, 6, 27 + offset)).toISOString().slice(0, 10);
    const weeks = Array.from({ length: 13 }, (_, w) =>
      Array.from({ length: 3 }, (_, i) =>
        pr(`w${w}-${i}`, {
          openedAt: `${day(7 * w)}T09:00`,
          firstReviewAt: `${day(7 * w)}T10:00`,
          mergedAt: `${day(7 * w)}T11:00`,
        })
      )
    ).flat();
    const [, p] = generateCodeReviewPrompts({ samples: weeks, workingWindow: WINDOW });
    expect(p.prompt).toContain("(Showing the latest 12 of 13 weeks)");
    expect(p.prompt).not.toContain("| Week 31, 2026 |");
    expect(p.prompt).toContain("| Week 32, 2026 | 3 | 2 |");
    // As the page's chart reads it: from the first week, not the first one listed.
    expect(p.prompt).toContain("from Week 31, 2026 to Week 43, 2026.");
  });
});
