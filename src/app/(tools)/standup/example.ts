import { exampleId } from "@/components/tool-frame/example-data";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

type Row = Pick<StandupEntry, "member" | "yesterday" | "today" | "blockers">;

/**
 * Today's standup for a mobile checkout team: four updates, two blockers
 * (one waiting on another team, one waiting on a review).
 */
const ROWS: Row[] = [
  {
    member: "Priya (PM)",
    yesterday: "Wrote the acceptance criteria for saved cards and walked Ana through them.",
    today: "Confirm the holiday sale dates with marketing and update the release plan.",
    blockers: "",
  },
  {
    member: "Sam (QA)",
    yesterday: "Regression pass on the cart. Found a double charge when a payment retries.",
    today: "Retest the retry fix on staging, then pair with Lee on the flaky login test.",
    blockers: "",
  },
  {
    member: "Lee (iOS)",
    yesterday: "Added the wallet payments button to the cart, behind a feature flag.",
    today: "Connect the button to the payments sandbox.",
    blockers: "Still waiting on wallet payments sandbox keys from the payments team.",
  },
  {
    member: "Ana (Backend)",
    yesterday: "Found the double charge: retries don't reuse the idempotency key.",
    today: "Ship the fix to staging and add a test for a retry after a timeout.",
    blockers: "The migration that adds the idempotency key index needs a DBA review.",
  },
];

export function buildExample(now: Date = new Date()): StandupEntry[] {
  const date = todayLocalISO(now);
  // A few minutes apart, in speaking order.
  return ROWS.map((r, i) => ({
    ...r,
    id: exampleId(`standup-${i + 1}`),
    date,
    timestamp: now.getTime() - (ROWS.length - i) * 2 * 60_000,
  }));
}
