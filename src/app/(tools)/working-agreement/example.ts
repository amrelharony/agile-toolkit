import { exampleId } from "@/components/tool-frame/example-data";
import type {
  CharterCheckIn,
  CharterConsent,
  CharterRule,
  TeamMember,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import { WA_ID, agreedByOf, snapshotOf } from "@/lib/working-agreement/model";

/** What the example shows: its own charter, team and sprints. Nothing is saved. */
export interface WorkingAgreementExample {
  doc: WorkingAgreement;
  /** The example team: consent is asked of these people, not of the workspace roster. */
  roster: TeamMember[];
  /** Names for the example check-ins' sprints. */
  sprintNames: Readonly<Record<string, string>>;
}

const PEOPLE = ["Amira", "Sam", "Priya", "Dev", "Alex"];

/** Everyone consents, except the answers given. */
function consent(at: string, except: Record<string, Omit<CharterConsent, "name" | "at">> = {}) {
  return PEOPLE.map(
    (name): CharterConsent => ({ name, at, ...(except[name] ?? { vote: "consent" }) })
  );
}

function rule(
  key: string,
  category: CharterRule["category"],
  text: string,
  answers: CharterConsent[],
  extra: Partial<CharterRule> = {}
): CharterRule {
  return {
    id: exampleId(`wa-${key}`),
    category,
    text,
    consent: answers,
    agreedBy: agreedByOf(answers),
    ...extra,
  };
}

/**
 * A checkout team's charter, two versions in: v1 nine weeks ago, v2 five
 * weeks ago (the review rule reworded, a deep-work rule added), and a rule
 * on incidents added since, not yet published. Sam objects to cameras on
 * and Priya has a concern about Friday afternoons; Alex hasn't answered
 * the new rule. Four check-ins two weeks apart find the review rule
 * slipping and coming back, and the draft of the next round has two rules
 * marked.
 *
 * Every id is an `example-` id, and it all stays in the page's memory.
 */
export function buildExample(today: string = todayIso()): WorkingAgreementExample {
  const day = (n: number) => addDays(today, -n) as string;
  const at = (n: number) => new Date(`${day(n)}T10:00:00`).toISOString();

  const async = rule(
    "async",
    "communication",
    "Default to async comms; use sync only when alignment is needed",
    consent(at(63))
  );
  const reviews = rule(
    "reviews",
    "work",
    "PRs are reviewed within one working day",
    consent(at(35)),
    { stillWorking: true }
  );
  const cameras = rule(
    "cameras",
    "meetings",
    "Cameras on for retros and 1:1s, optional otherwise",
    consent(at(63), {
      Sam: { vote: "object", note: "I join from a shared room; audio only works better." },
    })
  );
  const agenda = rule(
    "agenda",
    "meetings",
    "Every meeting has a written agenda 24h before",
    consent(at(63)),
    { stillWorking: false }
  );
  const deepWork = rule(
    "deep-work",
    "work",
    "Friday afternoons are protected for deep work",
    consent(at(35), {
      Priya: { vote: "concern", note: "Release Fridays will need an exception." },
    })
  );
  const incidents = rule(
    "incidents",
    "conflict",
    "Blameless write-up within two days of an incident",
    consent(at(6)).filter((c) => c.name !== "Alex")
  );

  // v1: the review rule read "two days", and there was no deep-work rule.
  const v1 = snapshotOf(
    {
      rules: [
        async,
        { ...reviews, text: "PRs are reviewed within two working days" },
        cameras,
        agenda,
      ],
      meta: { version: 0, teamName: "Checkout squad" },
    },
    at(63)
  );
  const v2 = snapshotOf(
    {
      rules: [async, reviews, cameras, agenda, deepWork],
      meta: { version: 1, teamName: "Checkout squad" },
    },
    at(35)
  );

  const sprint = (n: number) => exampleId(`wa-sprint-${n}`);
  const round = (
    n: number,
    daysAgo: number,
    version: number,
    results: CharterCheckIn["results"],
    sprintNumber: number
  ): CharterCheckIn => ({
    id: exampleId(`wa-check-${n}`),
    date: day(daysAgo),
    version,
    sprintId: sprint(sprintNumber),
    results,
  });
  const ids = {
    async: async.id,
    reviews: reviews.id,
    cameras: cameras.id,
    agenda: agenda.id,
    deep: deepWork.id,
  };

  const checkIns: CharterCheckIn[] = [
    round(
      1,
      49,
      1,
      {
        [ids.async]: "working",
        [ids.reviews]: "not_working",
        [ids.cameras]: "working",
        [ids.agenda]: "not_working",
      },
      11
    ),
    round(
      2,
      35,
      1,
      {
        [ids.async]: "working",
        [ids.reviews]: "not_working",
        [ids.cameras]: "working",
        [ids.agenda]: "working",
      },
      12
    ),
    round(
      3,
      21,
      2,
      {
        [ids.async]: "working",
        [ids.reviews]: "working",
        [ids.cameras]: "working",
        [ids.agenda]: "not_working",
        [ids.deep]: "working",
      },
      13
    ),
    round(
      4,
      7,
      2,
      {
        [ids.async]: "working",
        [ids.reviews]: "working",
        [ids.cameras]: "not_working",
        [ids.agenda]: "working",
        [ids.deep]: "working",
      },
      14
    ),
  ];

  return {
    doc: {
      id: WA_ID,
      rules: [async, reviews, cameras, agenda, deepWork, incidents],
      meta: { version: 2, publishedAt: at(35), teamName: "Checkout squad" },
      checkIns,
      versions: [v1, v2],
    },
    roster: PEOPLE.map((name) => ({ id: exampleId(`wa-member-${name.toLowerCase()}`), name })),
    sprintNames: {
      [sprint(11)]: "Sprint 11",
      [sprint(12)]: "Sprint 12",
      [sprint(13)]: "Sprint 13",
      [sprint(14)]: "Sprint 14",
    },
  };
}
