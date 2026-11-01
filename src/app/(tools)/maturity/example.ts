import { exampleId } from "@/components/tool-frame/example-data";
import type { MaturityAssessment, MaturityAssessmentEntry } from "@/lib/stores/workspace-types";
import { MATURITY_ID } from "@/lib/maturity/assessment";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/** The example in memory: a doc with three dated assessments and an empty draft. */
export interface MaturityExample {
  doc: MaturityAssessment;
}

const entry = (
  key: string,
  assessedAt: string,
  scores: [number, number, number, number, number, number, number, number],
  note?: string
): MaturityAssessmentEntry => {
  const [scrum, collab, tech, product, metrics, improve, stake, culture] = scores;
  return {
    id: exampleId(`maturity-${key}`),
    assessedAt,
    scores: {
      "scrum-practices": scrum,
      "team-collaboration": collab,
      "technical-excellence": tech,
      "product-management": product,
      "metrics-transparency": metrics,
      "continuous-improvement": improve,
      "stakeholder-engagement": stake,
      "agile-culture": culture,
    },
    targetLevel: 4,
    ...(note ? { note } : {}),
  };
};

/**
 * A team that assessed itself three times over five months: from 16% to
 * 31%, with Technical Excellence still the weakest and Scrum Practices up
 * from 2 to 3. It shows the trend, what changed and the roadmap.
 *
 * Everything carries `example-` ids and stays in the page's memory: the
 * workspace's maturity level, the agent and the next steps never see it.
 */
export function buildExample(now: Date = new Date()): MaturityExample {
  const today = todayIso(now);
  const day = (n: number) => addDays(today, -n) ?? today;
  return {
    doc: {
      id: MATURITY_ID,
      scores: {},
      targetLevel: 4,
      history: [
        entry("1", day(160), [2, 2, 1, 2, 1, 2, 1, 2], "Baseline at the start of the year"),
        entry("2", day(80), [2, 3, 1, 2, 2, 2, 2, 2]),
        entry("3", day(10), [3, 3, 1, 2, 2, 3, 2, 2], "After the retro on our ceremonies"),
      ],
    },
  };
}
