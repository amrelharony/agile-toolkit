import { exampleId } from "@/components/tool-frame/example-data";
import {
  HEALTH_CHECK_DIMENSIONS,
  HEALTH_CHECK_ID,
  type HealthCheck,
  type HealthCheckEntry,
  type HealthCheckSnapshot,
  type HealthDimension,
  type HealthDimensionScore,
  type HealthTrafficLight,
  type HealthVotes,
} from "@/lib/stores/workspace-types";
import { lightFromVotes, trendFor } from "@/lib/health-check/score";
import { todayLocalISO } from "@/lib/utils/formatters";

/** Lights in HEALTH_CHECK_DIMENSIONS order: Delivering Value, Easy to
 *  Release, Fun, Health of Codebase, Learning, Mission, Speed, Teamwork. */
type Row = [
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
  HealthTrafficLight,
];

const G = "green" as const;
const Y = "yellow" as const;
const R = "red" as const;

const HISTORY: [sprintName: string, lights: Row][] = [
  ["Sprint 12", [G, R, G, Y, Y, G, Y, G]],
  ["Sprint 13", [G, R, Y, Y, G, G, R, G]],
  ["Sprint 14", [Y, Y, Y, R, G, G, R, G]],
];

export const EXAMPLE_CURRENT_SPRINT = "Sprint 15";

/** The team's own dimension in the example. */
export const EXAMPLE_CUSTOM_ID = "custom-example1";
const EXAMPLE_CUSTOM_NAME = "On-call load";

/** This sprint's vote counts (seven people voted) for the dimensions they voted on. */
const VOTES: Partial<Record<HealthDimension, HealthVotes>> = {
  "Easy to Release": { green: 6, yellow: 1, red: 0 },
  "Health of Codebase": { green: 1, yellow: 1, red: 5 },
  Speed: { green: 2, yellow: 3, red: 2 },
};

const CURRENT: Row = [G, G, Y, R, G, G, Y, G];

const NOTES: Partial<Record<HealthDimension, string>> = {
  "Health of Codebase": "Flaky checkout tests block a merge most days.",
  "Easy to Release": "The new pipeline ships every merge to staging.",
};

function scores(
  pick: (d: HealthDimension, i: number) => HealthDimensionScore
): Record<HealthDimension, HealthDimensionScore> {
  return Object.fromEntries(HEALTH_CHECK_DIMENSIONS.map((d, i) => [d, pick(d, i)])) as Record<
    HealthDimension,
    HealthDimensionScore
  >;
}

/**
 * A mobile checkout squad's last three checks, a fortnight apart, and this
 * sprint's check, fully rated: three dimensions from an anonymous vote,
 * the rest agreed aloud. The surprise: a new release pipeline turned Easy
 * to Release from red to green, while the codebase slid to red under flaky
 * tests. Teamwork and Mission stay green throughout.
 *
 * The whole document is the example (every saved check's id is an
 * `exampleId`): the page shows it as a read-only preview and never writes
 * it into the workspace.
 */
export function buildExample(now: Date = new Date()): HealthCheck {
  const weeksAgo = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n * 7));
  const history: HealthCheckEntry[] = HISTORY.map(([sprintName, lights], i) => ({
    id: exampleId(`check-${i + 1}`),
    sprintName,
    date: weeksAgo(2 * (HISTORY.length - i)),
    scores: scores((_d, k) => ({
      light: lights[k],
      trend: trendFor(HISTORY[i - 1]?.[1][k], lights[k]),
    })),
    customScores: {
      [EXAMPLE_CUSTOM_ID]: { light: i === 2 ? R : Y, trend: i === 2 ? "down" : "same" },
    },
  }));
  const current: HealthCheckSnapshot = {
    sprintName: EXAMPLE_CURRENT_SPRINT,
    scores: scores((d, k) => {
      const votes = VOTES[d];
      return {
        light: (votes && lightFromVotes(votes)) || CURRENT[k],
        trend: "same",
        ...(votes ? { votes } : {}),
        ...(NOTES[d] ? { note: NOTES[d] } : {}),
      };
    }),
    customScores: { [EXAMPLE_CUSTOM_ID]: { light: Y, trend: "same" } },
    rated: [...HEALTH_CHECK_DIMENSIONS, EXAMPLE_CUSTOM_ID],
    source: "room",
    responses: 7,
  };
  return {
    id: HEALTH_CHECK_ID,
    current,
    history,
    customDimensions: [
      {
        id: EXAMPLE_CUSTOM_ID,
        name: EXAMPLE_CUSTOM_NAME,
        description: "Nights and weekends on call stay bearable.",
      },
    ],
  };
}
