import { exampleId } from "@/components/tool-frame/example-data";
import type { SixHatsHat, SixHatsSession, SixHatsThought } from "@/lib/stores/workspace-types";
import { DEFAULT_ORDER } from "./session";

export const EXAMPLE_SESSION_ID = exampleId("session");

/**
 * A team deciding whether to release weekly instead of every sprint, worn
 * in the common order and closed with a summary. Black collects the most
 * (the manual regression pass and on-call), Yellow and Green answer it, and
 * the closing Blue round turns that into a trial.
 */
const ROUNDS: [SixHatsHat, string[]][] = [
  ["blue", ["Question: should we release every week instead of at the end of each sprint?"]],
  [
    "white",
    [
      "We released 6 times last quarter; the median change waited 9 days to ship.",
      "The manual regression pass takes about half a day.",
      "Two of the last six releases needed a hotfix within a week.",
    ],
  ],
  [
    "green",
    [
      "Ship behind feature flags so unfinished work can go out switched off.",
      "Automate the top 20 regression checks first.",
      "Try a release train: every Tuesday, whatever is ready goes.",
    ],
  ],
  [
    "yellow",
    ["Smaller releases are easier to roll back.", "Customers see fixes in days, not weeks."],
  ],
  [
    "black",
    [
      "A half-day regression pass every week eats 10% of the team's time.",
      "On-call load could rise while monitoring is thin.",
      "Marketing plans launches around sprint ends.",
      "Database migrations are hard to roll back.",
    ],
  ],
  ["red", ["Excited, but nervous about the Friday pager.", "Tired of big-bang releases."]],
  ["blue", ["Agreed: trial weekly releases for two sprints, then review."]],
];

const SUMMARY =
  "Trial weekly releases for two sprints. Before the first one: automate the top 20 regression checks and put new work behind feature flags. Release on Tuesdays, never Fridays. Review the hotfix rate and on-call pages at the end of the trial.";

/** The example session and its thoughts, every id an example id ("Clear example" removes exactly these). */
export function buildExample(now: Date = new Date()): {
  session: SixHatsSession;
  thoughts: SixHatsThought[];
} {
  const start = now.getTime() - 60 * 60 * 1000;
  const at = (minute: number) => new Date(start + minute * 60 * 1000).toISOString();
  const thoughts: SixHatsThought[] = [];
  ROUNDS.forEach(([hat, texts], round) => {
    texts.forEach((text, k) => {
      thoughts.push({
        id: exampleId(`thought-${round + 1}-${k + 1}`),
        hat,
        text,
        loggedAt: at(round * 5 + k + 1),
        sessionId: EXAMPLE_SESSION_ID,
      });
    });
  });
  return {
    session: {
      id: EXAMPLE_SESSION_ID,
      topic: "Move to weekly releases?",
      order: [...DEFAULT_ORDER],
      roundMinutes: 5,
      summary: SUMMARY,
      startedAt: at(0),
      closedAt: at(ROUNDS.length * 5),
    },
    thoughts,
  };
}
