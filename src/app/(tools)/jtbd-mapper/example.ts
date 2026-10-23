import { exampleId } from "@/components/tool-frame/example-data";
import type { JobStory } from "@/lib/stores/workspace-types";

type Row = [key: string, situation: string, motivation: string, outcome: string, parent?: string];

/**
 * An expense tool's jobs, from the two people who use it: the traveller who
 * wants their money back, and the manager who approves claims. Each broad
 * job breaks into the concrete moments a team can build for.
 */
const ROWS: Row[] = [
  [
    "travel",
    "I get back from a work trip",
    "get my expenses paid back without chasing anyone",
    "keep my own money separate from the company’s costs",
  ],
  [
    "receipt",
    "I pay for something on the road",
    "capture the receipt in a few seconds",
    "stop losing paper receipts before I claim",
    "travel",
  ],
  [
    "status",
    "I have submitted a claim",
    "see who has to approve it and when it will be paid",
    "plan my month around the payout",
    "travel",
  ],
  [
    "approve",
    "I review my team’s claims at the end of the month",
    "spot the ones that break the policy at a glance",
    "approve the rest in one go",
  ],
  [
    "over-limit",
    "a claim is over the limit",
    "see the policy rule it breaks",
    "send it back with a reason the claimant understands",
    "approve",
  ],
];

export function buildExample(): JobStory[] {
  return ROWS.map(([key, situation, motivation, outcome, parent]) => ({
    id: exampleId(`job-${key}`),
    situation,
    motivation,
    outcome,
    ...(parent ? { parentJobId: exampleId(`job-${parent}`) } : {}),
  }));
}
