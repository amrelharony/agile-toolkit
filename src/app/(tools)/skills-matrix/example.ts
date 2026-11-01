import { exampleId } from "@/components/tool-frame/example-data";
import type { SkillsMatrix, TeamMember } from "@/lib/stores/workspace-types";
import { SKILLS_MATRIX_ID } from "@/lib/skills/coverage";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/** The example in memory: a matrix and the team it rates. */
export interface SkillsExample {
  doc: SkillsMatrix;
  roster: TeamMember[];
}

const person = (key: string, name: string, skills?: string[]): TeamMember => ({
  id: exampleId(`person-${key}`),
  name,
  ...(skills ? { skills } : {}),
});

/**
 * A checkout team of four rating five skills: TypeScript is well covered
 * and meets its target, Kubernetes hangs on Bo alone, nobody can do
 * Payments yet, CI/CD is below its target of two at Advanced, and a few
 * people haven't rated themselves in React. One pair is already in the
 * plan, and Ana lists Terraform on the Team page, which the matrix lacks.
 *
 * Everything carries `example-` ids and stays in the page's memory: the
 * roster, the agent and the next steps never see it.
 */
export function buildExample(now: Date = new Date()): SkillsExample {
  const today = todayIso(now);
  const ana = person("ana", "Ana", ["TypeScript", "Terraform"]);
  const bo = person("bo", "Bo", ["Kubernetes"]);
  const chen = person("chen", "Chen");
  const dee = person("dee", "Dee");
  const skill = (key: string) => exampleId(`skill-${key}`);
  const doc: SkillsMatrix = {
    id: SKILLS_MATRIX_ID,
    version: 2,
    members: [],
    skills: [
      {
        id: skill("ts"),
        name: "TypeScript",
        description: "The web app and the API",
        targetPeople: 3,
      },
      { id: skill("react"), name: "React" },
      { id: skill("k8s"), name: "Kubernetes", description: "Deploys and on-call" },
      { id: skill("payments"), name: "Payments", description: "The card provider's API" },
      { id: skill("ci"), name: "CI/CD", targetPeople: 2, targetLevel: 3 },
    ],
    grid: {
      [skill("ts")]: { [ana.id]: 4, [bo.id]: 3, [chen.id]: 2, [dee.id]: 1 },
      [skill("react")]: { [ana.id]: 3, [chen.id]: 2 },
      [skill("k8s")]: { [ana.id]: 1, [bo.id]: 3, [chen.id]: 0, [dee.id]: 1 },
      [skill("payments")]: { [ana.id]: 1, [bo.id]: 0, [chen.id]: 1, [dee.id]: 0 },
      [skill("ci")]: { [ana.id]: 2, [bo.id]: 3, [chen.id]: 1, [dee.id]: 2 },
    },
    training: [
      {
        id: exampleId("training-k8s-dee"),
        skillId: skill("k8s"),
        learnerId: dee.id,
        mentorId: bo.id,
        toLevel: 2,
        createdAt: `${addDays(today, -9) ?? today}T09:00:00.000Z`,
        due: addDays(today, 12) ?? undefined,
      },
    ],
  };
  return { doc, roster: [ana, bo, chen, dee] };
}
