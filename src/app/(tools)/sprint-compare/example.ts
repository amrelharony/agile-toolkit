import { EXAMPLE_ID_PREFIX, exampleId } from "@/components/tool-frame/example-data";
import type {
  HealthCheck,
  HealthCheckEntry,
  HealthDimension,
  HealthDimensionScore,
  MoodEntry,
  SprintGoal,
  SprintSeries,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS } from "@/lib/stores/workspace-types";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import { HEALTH_CHECK_DOC_ID } from "@/lib/sprints/compare";
import { blankGoal } from "@/lib/sprints/goal-doc";
import { dayDate, todayIso } from "@/lib/sprints/series";

/**
 * Sprint Comparison's example, shown in memory only: the shared example
 * sprints (four finished, one running) with what every score is read from,
 * so each source chip shows: goal outcomes, Burnup scope readings, Mood
 * Tracker check-ins, two Squad Health Checks and one rating the team typed.
 *
 * Sprint 3 is the story: 6 points of scope crept in mid-sprint, the goal
 * slipped, the team's mood dipped and the health check flagged releases as
 * painful. Sprint 4 recovered on all of them.
 */
export interface CompareExample extends ExampleSprints {
  goals: SprintGoal[];
  moodEntries: MoodEntry[];
  healthChecks: HealthCheck[];
}

const GOALS = [
  { goal: "Customers can browse the catalogue on mobile", met: "partly" },
  { goal: "Search returns results in under a second", met: "met" },
  { goal: "Customers can check out as guests", met: "not-met" },
  { goal: "Guest checkout ships to everyone", met: "met" },
] as const;

/** Scope readings (day, total points) logged in Burnup, per finished sprint. */
const SCOPE: { day: number; scope: number }[][] = [
  [{ day: 4, scope: 36 }],
  [{ day: 6, scope: 32 }],
  [
    { day: 3, scope: 39 },
    { day: 8, scope: 42 },
  ],
  [{ day: 5, scope: 34 }],
];

/** Mood check-ins (1–5) per finished sprint; the running one has too few to say. */
const MOOD = [
  [4, 3, 4, 4],
  [4, 5, 4, 4, 5],
  [3, 2, 3, 3],
  [4, 4, 5, 4],
  [4, 4],
];
const PEOPLE = ["amira", "ben", "chloe", "dev", "eli"];

const light = (l: HealthDimensionScore["light"]): HealthDimensionScore => ({
  light: l,
  trend: "same",
});

function healthEntry(
  id: string,
  sprintName: string,
  date: string,
  lights: Partial<Record<HealthDimension, HealthDimensionScore["light"]>>
): HealthCheckEntry {
  const scores = Object.fromEntries(
    HEALTH_CHECK_DIMENSIONS.map((d) => [d, light(lights[d] ?? "green")])
  ) as Record<HealthDimension, HealthDimensionScore>;
  return { id, sprintName, date, scores };
}

/**
 * The shared readers (moodDuring, healthCheckFor) leave `example-` rows
 * out, so an example loaded into a tool never reaches the team's own
 * numbers. This one never leaves the page, so its rows are re-keyed to be
 * counted in the preview.
 */
const counted = (id: string) => id.replace(EXAMPLE_ID_PREFIX, "preview-");

export function buildExample(today: string = todayIso()): CompareExample {
  const base = exampleSprints(today);
  const finished = base.sprints.filter((s) => s.status === "completed");

  const series: SprintSeries[] = base.sprints.map((s, i) => ({
    id: s.id,
    days: [...(base.series.find((x) => x.id === s.id)?.days ?? []), ...(SCOPE[i] ?? [])].sort(
      (a, b) => a.day - b.day
    ),
    // Only one rating typed by hand: the rest are computed or prefilled.
    ...(i === 1 ? { ratings: { "Team Happiness": 9 } } : {}),
  }));

  const goals: SprintGoal[] = finished.map((s, i) => ({
    ...blankGoal(s.id),
    goal: GOALS[i].goal,
    outcome: { met: GOALS[i].met, decidedAt: `${s.endDate}T16:00:00.000Z` },
  }));
  goals.push({ ...blankGoal(base.current.id), goal: base.current.goal ?? "" });

  const moodEntries: MoodEntry[] = base.sprints.flatMap((s, i) =>
    (MOOD[i] ?? []).map((score, j) => ({
      id: counted(exampleId(`mood-${i + 1}-${j + 1}`)),
      memberId: PEOPLE[j % PEOPLE.length],
      date: dayDate(s, 1 + j) ?? s.startDate,
      score: score as MoodEntry["score"],
    }))
  );

  const [, , third, fourth] = finished;
  const healthChecks: HealthCheck[] = [
    {
      id: HEALTH_CHECK_DOC_ID,
      current: { sprintName: "", scores: healthEntry("", "", "", {}).scores },
      history: [
        healthEntry(counted(exampleId("health-3")), third.name, third.endDate, {
          "Easy to Release": "red",
          "Health of Codebase": "yellow",
        }),
        healthEntry(counted(exampleId("health-4")), fourth.name, fourth.endDate, {
          "Easy to Release": "yellow",
        }),
      ],
    },
  ];

  return { ...base, series, goals, moodEntries, healthChecks };
}
