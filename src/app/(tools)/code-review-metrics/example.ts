import { exampleId } from "@/components/tool-frame/example-data";
import { addDays } from "@/lib/impediments/model";
import { CODE_REVIEW_LOG_ID } from "@/lib/quality/review";
import type { CodeReviewLog, PrSample } from "@/lib/stores/workspace-types";

const AUTHORS = ["Ana", "Ben", "Chen", "Dee"];

/** The Monday of the week `day` falls in (local "YYYY-MM-DD"). */
function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(day, -weekday);
}

const at = (monday: string, plusDays: number, time: string) =>
  `${addDays(monday, plusDays)}T${time}`;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Eight weeks of pull requests, three a week, before this one: a small PR
 * reviewed the same day, a medium one the next morning, and a large one
 * opened on a Thursday and merged the next Tuesday, so its elapsed hours run
 * over the weekend while its working hours don't. Two large ones merge
 * with no comments, and the last week's two later PRs are still open (one
 * awaiting its first review). The log counts 09:00–17:30 as the working
 * day. Held in memory by the page: nothing in it is saved.
 */
export function buildExample(today: string): CodeReviewLog {
  const samples: PrSample[] = [];
  const thisMonday = mondayOf(today);
  for (let w = 0; w < 8; w++) {
    const monday = addDays(thisMonday, -7 * (8 - w));
    const lastWeek = w === 7;
    // A few minutes' drift a week, so the weekly medians aren't a flat line.
    const drift = pad(10 + w * 5);
    const n = samples.length;
    const pr = (k: number, s: Omit<PrSample, "id" | "prNumber" | "author">): PrSample => ({
      id: exampleId(`pr-${n + k + 1}`),
      prNumber: `#${400 + n + k + 1}`,
      author: AUTHORS[(n + k) % AUTHORS.length],
      ...s,
    });
    samples.push(
      pr(0, {
        openedAt: at(monday, 0, `10:${drift}`),
        firstReviewAt: at(monday, 0, "14:00"),
        mergedAt: at(monday, 1, "11:00"),
        reviewerCount: 1,
        commentCount: 2 + (w % 3),
        linesChanged: 40 + w * 7,
        description: "Small fix",
      }),
      pr(1, {
        openedAt: at(monday, 1, `15:${drift}`),
        ...(lastWeek ? {} : { firstReviewAt: at(monday, 2, "10:30") }),
        ...(lastWeek ? {} : { mergedAt: at(monday, 3, `16:${drift}`) }),
        reviewerCount: 2,
        commentCount: 5 + (w % 4),
        linesChanged: 180 + w * 20,
      }),
      pr(2, {
        openedAt: at(monday, 3, "11:00"),
        firstReviewAt: at(monday, 4, `15:${drift}`),
        ...(lastWeek ? {} : { mergedAt: at(monday, 8, "12:00") }),
        reviewerCount: 2,
        // Two large PRs merge without a single comment.
        commentCount: w === 2 || w === 5 ? 0 : 9 + w,
        linesChanged: 520 + w * 40,
        description: "Feature slice",
      })
    );
  }
  return { id: CODE_REVIEW_LOG_ID, samples, workingWindow: { start: "09:00", end: "17:30" } };
}
