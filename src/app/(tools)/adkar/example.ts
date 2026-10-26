import { exampleId } from "@/components/tool-frame/example-data";
import type { AdkarDoc } from "@/lib/stores/workspace-types";
import { ADKAR_DOC_ID } from "@/lib/adkar/model";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/** The example in memory: a doc with three initiatives. */
export interface AdkarExample {
  doc: AdkarDoc;
}

/**
 * Three changes a platform team is rolling out, with dated history from
 * their start dates: trunk-based development is at Ability but Support's
 * barrier is still Desire (it moved past them), the new incident process
 * is held at Knowledge for the on-call group, and the design system is in
 * Reinforcement with every group above 3. One step back is in the history.
 *
 * Everything carries `example-` ids and stays in the page's memory: the
 * agent and the next steps never see it.
 */
export function buildExample(now: Date = new Date()): AdkarExample {
  const today = todayIso(now);
  const day = (n: number) => addDays(today, -n) ?? today;
  return {
    doc: {
      id: ADKAR_DOC_ID,
      initiatives: [
        {
          id: exampleId("adkar-trunk"),
          name: "Trunk-based development",
          owner: "Priya",
          startDate: day(75),
          description: "Short-lived branches and feature flags instead of release branches.",
          currentStage: "ability",
          stageHistory: [
            { stage: "awareness", enteredAt: day(75) },
            { stage: "desire", enteredAt: day(61) },
            { stage: "knowledge", enteredAt: day(40) },
            { stage: "ability", enteredAt: day(12) },
          ],
          groups: [
            {
              id: exampleId("adkar-trunk-devs"),
              name: "Developers",
              scores: { awareness: 5, desire: 4, knowledge: 4, ability: 3 },
              assessedAt: day(5),
            },
            {
              id: exampleId("adkar-trunk-support"),
              name: "Support",
              scores: { awareness: 4, desire: 2 },
              assessedAt: day(5),
              note: "Worried about more incidents during rollout",
            },
          ],
        },
        {
          id: exampleId("adkar-incidents"),
          name: "New incident process",
          owner: "Sam",
          startDate: day(50),
          currentStage: "knowledge",
          stageHistory: [
            { stage: "awareness", enteredAt: day(50) },
            { stage: "desire", enteredAt: day(38) },
            { stage: "knowledge", enteredAt: day(30) },
            { stage: "desire", enteredAt: day(24) },
            { stage: "knowledge", enteredAt: day(14) },
          ],
          groups: [
            {
              id: exampleId("adkar-incidents-oncall"),
              name: "On-call engineers",
              scores: { awareness: 5, desire: 4, knowledge: 2 },
              assessedAt: day(3),
            },
          ],
        },
        {
          id: exampleId("adkar-design"),
          name: "Shared design system",
          owner: "Alex",
          startDate: day(150),
          currentStage: "reinforcement",
          stageHistory: [
            { stage: "awareness", enteredAt: day(150) },
            { stage: "desire", enteredAt: day(130) },
            { stage: "knowledge", enteredAt: day(100) },
            { stage: "ability", enteredAt: day(70) },
            { stage: "reinforcement", enteredAt: day(35) },
          ],
          groups: [
            {
              id: exampleId("adkar-design-web"),
              name: "Web team",
              scores: { awareness: 5, desire: 5, knowledge: 4, ability: 4, reinforcement: 4 },
              assessedAt: day(20),
            },
          ],
        },
      ],
    },
  };
}
