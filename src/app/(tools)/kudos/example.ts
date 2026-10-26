import { exampleId } from "@/components/tool-frame/example-data";
import type { Kudos, TeamMember } from "@/lib/stores/workspace-types";

const DAY_MS = 86_400_000;

/**
 * The example's team. It stays in the page's memory: the Recognition
 * section reads it while the example is shown, and the Team page never
 * sees it.
 */
export const EXAMPLE_ROSTER: readonly TeamMember[] = [
  { id: exampleId("member-sam"), name: "Sam" },
  { id: exampleId("member-priya"), name: "Priya" },
  { id: exampleId("member-dev"), name: "Dev" },
  { id: exampleId("member-alex"), name: "Alex" },
  { id: exampleId("member-omar"), name: "Omar" },
];

const member = (name: string) => EXAMPLE_ROSTER.find((m) => m.name === name)?.id;

/**
 * Three weeks of a checkout team's kudos: nine for four of its five
 * people (one picked from the roster, so it carries the member id; the
 * rest by name), and a reply that thanks the sender, which counts for
 * nobody. Omar has none yet, so the page shows its fairness hint.
 *
 * Every row has an `example-` id. The page loads them with upsertKudos,
 * never the room, and the signal bridge, cloud sync and backfill skip
 * them: nothing is posted, broadcast or awarded XP, and Clear example
 * removes exactly these.
 */
export function buildExample(now: Date = new Date()): Kudos[] {
  const at = (daysAgo: number, hour = 11) => {
    const d = new Date(now.getTime() - daysAgo * DAY_MS);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const kudos = (
    key: string,
    daysAgo: number,
    toName: string,
    fromName: string,
    theme: Kudos["theme"],
    message: string,
    extra: Partial<Kudos> = {}
  ): Kudos => ({
    id: exampleId(`kudos-${key}`),
    theme,
    toName,
    fromName,
    message,
    sentAt: at(daysAgo),
    ...extra,
  });

  return [
    kudos("1", 19, "Priya", "Sam", "thank-you", "Untangled the payment retries before the demo.", {
      toMemberId: member("Priya"),
    }),
    kudos("2", 17, "Sam", "Dev", "great-job", "Paired with me on the flaky checkout tests."),
    kudos("3", 15, "Dev", "Alex", "awesome", "The new release checklist saved us an hour."),
    kudos("4", 12, "Priya", "Alex", "you-rock", "Calm and clear in the incident call."),
    kudos("5", 10, "Alex", "Priya", "well-done", "Turned vague feedback into three good stories."),
    kudos("6", 8, "Sam", "Priya", "thank-you", "Reviewed my PR within the hour, twice."),
    kudos("7", 6, "Dev", "Sam", "congratulations", "First production deploy, no rollback!"),
    kudos("8", 4, "Priya", "Dev", "great-job", "The on-call guide is finally readable."),
    kudos("9", 2, "Alex", "Sam", "very-happy", "Kept refinement to the timebox."),
    // A reply copies its parent's recipient; it is a thank-you back, not a kudos.
    kudos("9-reply", 1, "Alex", "Alex", "very-happy", "Thanks Sam, team effort!", {
      replyTo: exampleId("kudos-9"),
    }),
  ];
}
