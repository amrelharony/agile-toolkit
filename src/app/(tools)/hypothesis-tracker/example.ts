import type { Hypothesis } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { exampleId } from "@/lib/utils/example-id";

/**
 * A product team's tests in every state: a draft, one running with no
 * result yet, one running whose result is in (the card suggests a
 * verdict to apply), and one of each result, with targets and baselines
 * on the measured ones. Days count back from `today`. Ids start with
 * `example-`; "Clear example" removes exactly them, and no example row
 * comes from another tool (no sourceRef).
 */
export function buildExample(today: string): Hypothesis[] {
  const ago = (n: number) => addDays(today, -n) ?? today;
  return [
    {
      id: exampleId("hyp-digest"),
      believe: "team leads want a Monday digest of blocked work",
      willDo: "email a hand-made digest to five teams for two weeks",
      toLearn: "whether leads open it and act on it",
      successMetric: "at least three of five leads reply asking to keep it",
      status: "drafted",
      raisedAt: ago(2),
    },
    {
      id: exampleId("hyp-trial"),
      believe: "a 30-day trial converts better than a 14-day one",
      willDo: "offer half of new sign-ups a 30-day trial",
      toLearn: "whether the longer trial lifts paid conversion",
      successMetric: "trial-to-paid conversion rises",
      experiment: "A/B split on the sign-up page for four weeks",
      target: { direction: "increase", value: 12, unit: "%", baseline: 9 },
      status: "running",
      raisedAt: ago(20),
    },
    {
      id: exampleId("hyp-onboarding"),
      believe: "a checklist gets new teams to their first sprint sooner",
      willDo: "show a five-step checklist to new workspaces",
      toLearn: "how long teams take to plan their first sprint",
      successMetric: "median days to the first sprint falls",
      target: { direction: "decrease", value: 3, unit: "days", baseline: 6 },
      actual: 2.5,
      status: "running",
      raisedAt: ago(30),
    },
    {
      id: exampleId("hyp-export"),
      believe: "admins will use a CSV export of the backlog",
      willDo: "add an export button behind a flag for ten workspaces",
      toLearn: "whether exports are used more than once",
      successMetric: "most flagged workspaces export twice or more",
      target: { direction: "increase", value: 50, unit: "%", baseline: 0 },
      actual: 70,
      status: "validated",
      raisedAt: ago(60),
      resolvedAt: ago(40),
      outcome: "7 of 10 workspaces exported at least twice; it ships to everyone.",
    },
    {
      id: exampleId("hyp-darkmode"),
      believe: "a dark theme keeps evening users longer",
      willDo: "ship the dark theme to a tenth of users",
      toLearn: "whether evening sessions get longer",
      successMetric: "evening session length grows",
      target: { direction: "increase", value: 15, unit: "min", baseline: 12 },
      actual: 12.5,
      status: "invalidated",
      raisedAt: ago(75),
      resolvedAt: ago(50),
      outcome: "Sessions barely moved; people like it, but it doesn't change how long they stay.",
    },
    {
      id: exampleId("hyp-pricing"),
      believe: "a per-team price is easier to buy than a per-seat one",
      willDo: "show both prices to visitors of the pricing page",
      toLearn: "which one more visitors start a trial from",
      successMetric: "more trials start from the per-team price",
      status: "inconclusive",
      raisedAt: ago(90),
      resolvedAt: ago(62),
      outcome: "Too little traffic in four weeks to tell them apart; rerun at launch.",
    },
  ];
}
