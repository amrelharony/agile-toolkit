import { exampleId } from "@/components/tool-frame/example-data";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";

type Row = Omit<FeatureFlag, "id" | "createdAt" | "removeBy" | "retiredAt"> & {
  key: string;
  /** Days before today it was created. */
  created: number;
  /** Days from today it's planned to go (negative: already past). */
  remove?: number;
  /** Days before today it was retired. */
  retired?: number;
};

/**
 * A shop's flags. A rollout is twelve days past its removal date and an
 * experiment has run past 60 days, so they lead the verdict; a 400-day
 * kill switch is exempt, as is a permission flag with no removal date; an
 * off flag waits for its cleanup; seven retired flags with their days let
 * the survival curve under Advanced analysis open. Dates are relative to
 * today, so the staleness always reads the same.
 */
const ROWS: Row[] = [
  {
    key: "checkout-v2",
    name: "checkout_v2_rollout",
    owner: "Priya",
    status: "on",
    purpose: "rollout",
    environment: "prod",
    created: 45,
    remove: -12,
    description: "One-page checkout, now at 100%.",
  },
  {
    key: "search-rank",
    name: "search_ranking_ab",
    owner: "Alex",
    status: "on",
    purpose: "experiment",
    environment: "prod",
    created: 75,
    description: "Ranking by margin against relevance.",
  },
  {
    key: "payments-kill",
    name: "payments_kill_switch",
    owner: "Sam",
    status: "on",
    purpose: "kill_switch",
    environment: "all",
    created: 400,
  },
  {
    key: "beta-reports",
    name: "beta_reports_access",
    status: "on",
    purpose: "permission",
    environment: "prod",
    created: 120,
  },
  {
    key: "dark-mode",
    name: "dark_mode_rollout",
    owner: "Morgan",
    status: "off",
    purpose: "rollout",
    environment: "staging",
    created: 9,
    remove: 21,
  },
  {
    key: "r1",
    name: "new_basket_rollout",
    owner: "Priya",
    status: "retired",
    purpose: "rollout",
    created: 160,
    retired: 130,
  },
  {
    key: "r2",
    name: "free_shipping_ab",
    owner: "Alex",
    status: "retired",
    purpose: "experiment",
    created: 150,
    retired: 95,
  },
  {
    key: "r3",
    name: "address_lookup",
    owner: "Sam",
    status: "retired",
    purpose: "rollout",
    created: 120,
    retired: 102,
  },
  {
    key: "r4",
    name: "promo_banner_ab",
    owner: "Alex",
    status: "retired",
    purpose: "experiment",
    created: 100,
    retired: 52,
  },
  {
    key: "r5",
    name: "saved_cards_rollout",
    owner: "Morgan",
    status: "retired",
    purpose: "rollout",
    created: 80,
    retired: 61,
  },
  {
    key: "r6",
    name: "gift_wrap",
    owner: "Priya",
    status: "retired",
    purpose: "rollout",
    created: 60,
    retired: 35,
  },
  {
    key: "r7",
    name: "reviews_v2_rollout",
    owner: "Sam",
    status: "retired",
    purpose: "rollout",
    created: 40,
    retired: 6,
  },
];

export function buildExample(today: string): FeatureFlag[] {
  const on = (n: number) => addDays(today, n) as string;
  return ROWS.map(({ key, created, remove, retired, ...rest }) => ({
    id: exampleId(`flag-${key}`),
    ...rest,
    createdAt: on(-created),
    ...(remove !== undefined ? { removeBy: on(remove) } : {}),
    ...(retired !== undefined ? { retiredAt: on(-retired) } : {}),
  }));
}
