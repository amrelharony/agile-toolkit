import { exampleId } from "@/components/tool-frame/example-data";
import { addDays } from "@/lib/flow/days";
import { BUILT_IN_TEMPLATES, type Milestone, type Onboardee } from "./model";

/**
 * Four new joiners at day 5, 20, 45 and 95, each with the built-in
 * milestones and the days they reached them (backdated, as they would be
 * logged): Ana's first commit is overdue and her first PR at risk, Ben and
 * Cleo each have one at risk, and Dev has finished. Three have made a first PR (days 4–6), so its
 * average shows; only Dev is productive yet, so that one waits for more.
 * The ramp counts each day only for the people who have reached it: three
 * at day 20, two at day 25, so the curve stops there.
 *
 * Everything has `example-` ids and stays in the page's memory: nothing is
 * saved, and Clear example leaves your own people as they were.
 */
export function buildExample(today: string): Onboardee[] {
  const day = (n: number) => addDays(today, -n) ?? today;
  const person = (
    key: string,
    name: string,
    role: string,
    daysIn: number,
    reached: Partial<Record<string, number>>,
    extra: Partial<Onboardee> = {}
  ): Onboardee => {
    const start = day(daysIn);
    const milestones: Milestone[] = BUILT_IN_TEMPLATES.map((t) => {
      const at = reached[t.id];
      return {
        id: exampleId(`onb-${key}-${t.id}`),
        templateId: t.id,
        name: t.name,
        targetDays: t.targetDays,
        ...(t.marks ? { marks: t.marks } : {}),
        ...(at !== undefined ? { completedAt: addDays(start, at) ?? start } : {}),
      };
    });
    return { id: exampleId(`onb-${key}`), name, role, startDate: start, milestones, ...extra };
  };
  return [
    person("ana", "Ana", "Frontend Engineer", 5, {}, { buddy: "Ben" }),
    person("ben", "Ben", "Backend Engineer", 20, {
      "first-commit": 1,
      "first-pr": 5,
      "first-merge": 12,
    }),
    person(
      "cleo",
      "Cleo",
      "Data Engineer",
      45,
      { "first-commit": 2, "first-pr": 6, "first-merge": 15, "first-deploy": 28 },
      { buddy: "Dev" }
    ),
    person("dev", "Dev", "Platform Engineer", 95, {
      "first-commit": 1,
      "first-pr": 4,
      "first-merge": 10,
      "first-deploy": 25,
      "independent-feature": 55,
      "mentor-peer": 80,
    }),
  ];
}
