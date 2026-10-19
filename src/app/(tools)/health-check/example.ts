import { exampleId } from "@/components/tool-frame/example-data";
import {
  HEALTH_CHECK_DIMENSIONS,
  type HealthCheckEntry,
  type HealthCheckSnapshot,
  type HealthDimension,
  type HealthDimensionScore,
  type HealthTrafficLight,
  type HealthTrend,
} from "@/lib/stores/workspace-types";
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

const CURRENT: [HealthTrafficLight, HealthTrend][] = [
  [G, "up"],
  [G, "up"],
  [Y, "same"],
  [R, "down"],
  [G, "same"],
  [G, "same"],
  [Y, "up"],
  [G, "same"],
];

function scores(
  pick: (i: number) => HealthDimensionScore
): Record<HealthDimension, HealthDimensionScore> {
  return Object.fromEntries(HEALTH_CHECK_DIMENSIONS.map((d, i) => [d, pick(i)])) as Record<
    HealthDimension,
    HealthDimensionScore
  >;
}

const RANK: Record<HealthTrafficLight, number> = { red: 0, yellow: 1, green: 2 };

/** A saved check's trend: its light against the check before. */
function trendFrom(prev: HealthTrafficLight | undefined, light: HealthTrafficLight): HealthTrend {
  if (!prev || RANK[prev] === RANK[light]) return "same";
  return RANK[light] > RANK[prev] ? "up" : "down";
}

/**
 * A mobile checkout squad's last three checks, a fortnight apart, and this
 * sprint's check, fully rated. The surprise: a new release pipeline turned
 * Easy to Release from red to green, while the codebase slid to red under
 * flaky tests. Teamwork and Mission stay green throughout.
 */
export function buildExample(now: Date = new Date()): {
  current: HealthCheckSnapshot;
  history: HealthCheckEntry[];
} {
  const weeksAgo = (n: number) =>
    todayLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n * 7));
  return {
    current: {
      sprintName: EXAMPLE_CURRENT_SPRINT,
      scores: scores((d) => ({ light: CURRENT[d][0], trend: CURRENT[d][1] })),
    },
    history: HISTORY.map(([sprintName, lights], i) => ({
      id: exampleId(`check-${i + 1}`),
      sprintName,
      date: weeksAgo(2 * (HISTORY.length - i)),
      scores: scores((d) => ({
        light: lights[d],
        trend: trendFrom(HISTORY[i - 1]?.[1][d], lights[d]),
      })),
    })),
  };
}
