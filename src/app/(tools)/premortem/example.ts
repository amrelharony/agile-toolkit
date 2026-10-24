import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import { dropMerged, type Premortem, type PremortemCause, type PremortemState } from "./model";

export const EXAMPLE_PREMORTEM_ID = exampleId("premortem");

export const EXAMPLE_TITLE = "Mobile checkout launch";

export const EXAMPLE_SCENARIO =
  "It's April. The new mobile checkout launched two months late, conversion is down 8%, and support is flooded with failed-payment tickets.";

/**
 * A mobile checkout team's premortem, voted and rated. The late payment
 * integration is the obvious top cause; the surprise is the flaky test
 * suite, which nearly ties because everyone has learned to ignore red
 * builds (a duplicate about the CI pipeline was grouped into it). Two
 * causes score 12, and the votes decide between them. Every cause has a
 * preventive action and an owner.
 */
const ROWS: Omit<PremortemCause, "id">[] = [
  {
    text: "Payment provider integration took far longer than estimated",
    description: "Nobody on the team has built a wallet integration before.",
    likelihood: 4,
    impact: 4,
    votes: 5,
    preventiveAction: "Spike the wallet integration in sprint 1 and get sandbox access this week.",
    owner: "Diego (iOS)",
  },
  {
    text: "Flaky end-to-end tests taught everyone to ignore red builds",
    description: "The login test alone fails one run in five.",
    likelihood: 5,
    impact: 3,
    votes: 4,
    preventiveAction: "Quarantine a flaky test within a day; show the count on the team board.",
    owner: "Sam (Backend)",
    merged: [
      {
        id: exampleId("cause-7"),
        text: "Nobody trusted the CI pipeline",
        votes: 1,
      },
    ],
  },
  {
    text: "Nobody tested on older Android phones",
    likelihood: 3,
    impact: 4,
    votes: 2,
    preventiveAction: "Add three low-end devices to the test matrix.",
    owner: "Amara (QA)",
  },
  {
    text: "Launch date announced before the team estimated",
    description: "Marketing needs a date for the holiday campaign.",
    likelihood: 3,
    impact: 4,
    votes: 3,
    preventiveAction: "Share a forecast range, not a date, in the launch brief.",
    owner: "Priya (PM)",
  },
  {
    text: "Legal review of the new payment terms landed in release week",
    likelihood: 2,
    impact: 5,
    votes: 1,
    preventiveAction: "Book the legal review for sprint 3.",
    owner: "Priya (PM)",
  },
  {
    text: "Missing analytics hid the conversion drop for weeks",
    likelihood: 2,
    impact: 3,
    preventiveAction: "Ship the checkout funnel dashboard before launch.",
    owner: "Mei (Android)",
  },
];

/** The example premortem, in the Act phase: votes cast, causes rated. Not linked. */
export function buildExample(now: Date = new Date()): Premortem {
  return {
    id: EXAMPLE_PREMORTEM_ID,
    title: EXAMPLE_TITLE,
    scenario: EXAMPLE_SCENARIO,
    phase: "act",
    dotsPerPerson: 3,
    causes: ROWS.map((row, i) => ({ ...row, id: exampleId(`cause-${i + 1}`) })),
    createdAt: now.toISOString(),
  };
}

export interface ClearedExample {
  state: PremortemState;
  /** What the example premortem became when it held the user's own causes. */
  keptId?: string;
}

/**
 * The state without the example. The example premortem goes, unless the
 * user made some of it their own: causes they wrote into it, or a title or
 * scenario they rewrote. Those stay, in a premortem of their own under
 * `keptId`; an untouched example title or scenario goes with the example.
 */
export function withoutExample(state: PremortemState, keptId: string): ClearedExample {
  let kept: string | undefined;
  const premortems = state.premortems.flatMap((p): Premortem[] => {
    if (!isExampleId(p.id)) return [p];
    const own = p.causes
      .filter((c) => !isExampleId(c.id))
      .map((c) => dropMerged(c, (m) => isExampleId(m.id)));
    const title = p.title === EXAMPLE_TITLE ? "" : p.title;
    const scenario = p.scenario === EXAMPLE_SCENARIO ? "" : p.scenario;
    if (own.length === 0 && !title.trim() && !scenario.trim()) return [];
    kept = keptId;
    return [
      {
        ...p,
        id: keptId,
        title: title.trim() || "Premortem",
        scenario,
        // With none of the example's causes left, the session starts over.
        phase: own.length > 0 ? p.phase : "write",
        causes: own,
      },
    ];
  });
  return { state: { ...state, premortems }, keptId: kept };
}
