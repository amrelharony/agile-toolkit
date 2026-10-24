import { exampleId } from "@/components/tool-frame/example-data";
import type {
  FeatureFlag,
  Release,
  ReleaseGateDef,
  ReleaseReadiness,
} from "@/lib/stores/workspace-types";
import { RELEASE_GATE_IDS } from "@/lib/stores/workspace-types";
import { BUILT_IN_GATES, DOD_GATE, RELEASE_DOC_ID } from "@/lib/releases/gates";
import { addDays } from "@/lib/flow/days";

/** What the example shows: its own releases, flags and Definition of Done. Nothing is saved. */
export interface ReleaseReadinessExample {
  doc: ReleaseReadiness;
  flags: FeatureFlag[];
  /** A DoD Builder checklist, as its blob stores it. */
  dod: {
    items: { id: string; label: string; category: string; required: boolean; done?: boolean }[];
  };
}

const SMOKE_TEST: ReleaseGateDef = {
  id: "smoke_test",
  label: "Smoke test in staging",
  description: "The checkout journey passes end to end",
};

/** Every gate passed except `open`. */
const passing = (ids: readonly string[], open: readonly string[] = []) =>
  Object.fromEntries(ids.map((id) => [id, !open.includes(id)]));

/**
 * A shop's checkout team over two months. Two releases went out on time
 * and one late; Guest checkout shipped without its rollback test and was
 * rolled back the next day; Payments retry, also untested for rollback,
 * was rolled back, reopened and shipped again. So Rollback tested is the
 * gate skipped most. Checkout redesign is three days out with two gates open,
 * its rollout flag ready; Loyalty points has an experiment flag with no
 * removal date, so its flag gate fails. The team added a smoke-test gate
 * and the Definition of Done gate to the built-ins. Dates are relative to
 * today, so "planned in 3 days" always reads the same.
 */
export function buildExample(today: string): ReleaseReadinessExample {
  const on = (n: number) => addDays(today, n) as string;
  const builtIns = [...RELEASE_GATE_IDS];
  const withSmoke = [...builtIns, SMOKE_TEST.id];
  const teamGates = [...BUILT_IN_GATES.map((g) => ({ ...g })), SMOKE_TEST, DOD_GATE];

  const releases: Release[] = [
    {
      id: exampleId("release-loyalty"),
      name: "v3.5 Loyalty points",
      plannedDate: on(17),
      status: "planning",
      description: "Points on every order, shown in the basket.",
      gates: passing(["a11y_audit", "perf_baseline"]),
    },
    {
      id: exampleId("release-checkout"),
      name: "v3.4 Checkout redesign",
      plannedDate: on(3),
      status: "planning",
      description: "One-page checkout, rolled out to 10% first behind checkout_v2.",
      gates: passing(withSmoke, ["rollback_tested", "sre_review", "feature_flag_ready"]),
    },
    {
      id: exampleId("release-payments"),
      name: "v3.3 Payments retry",
      plannedDate: on(-14),
      status: "shipped",
      shippedDate: on(-10),
      gateIds: withSmoke,
      gates: passing(withSmoke),
      gatesOpenAtShip: 0,
      previousShips: [
        {
          shippedDate: on(-18),
          rolledBackAt: on(-17),
          gateIds: withSmoke,
          gates: passing(withSmoke, ["rollback_tested", "runbook_linked"]),
          gatesOpenAtShip: 2,
        },
      ],
    },
    {
      id: exampleId("release-guest"),
      name: "v3.2 Guest checkout",
      plannedDate: on(-30),
      status: "rolled_back",
      shippedDate: on(-30),
      rolledBackAt: on(-29),
      gateIds: withSmoke,
      gates: passing(withSmoke, ["rollback_tested", "alerts_tuned", "perf_baseline"]),
      gatesOpenAtShip: 3,
    },
    {
      // Shipped before gates were frozen on a release: it reads against the built-ins.
      id: exampleId("release-carts"),
      name: "v3.1 Saved carts",
      plannedDate: on(-45),
      status: "shipped",
      shippedDate: on(-42),
      gates: passing(builtIns, ["sre_review", "rollback_tested"]),
      gatesOpenAtShip: 2,
    },
    {
      id: exampleId("release-search"),
      name: "v3.0 Search filters",
      plannedDate: on(-60),
      status: "shipped",
      shippedDate: on(-61),
      gates: passing(builtIns),
      gatesOpenAtShip: 0,
    },
  ];

  const flags: FeatureFlag[] = [
    {
      id: exampleId("flag-checkout-v2"),
      name: "checkout_v2",
      owner: "Priya",
      status: "on",
      purpose: "rollout",
      environment: "prod",
      createdAt: on(-12),
      removeBy: on(30),
      releaseId: exampleId("release-checkout"),
    },
    {
      id: exampleId("flag-checkout-kill"),
      name: "checkout_kill_switch",
      owner: "Sam",
      status: "on",
      purpose: "kill_switch",
      environment: "prod",
      createdAt: on(-200),
      releaseId: exampleId("release-checkout"),
    },
    {
      id: exampleId("flag-loyalty"),
      name: "loyalty_points_ab",
      owner: "Alex",
      status: "off",
      purpose: "experiment",
      environment: "staging",
      createdAt: on(-5),
      releaseId: exampleId("release-loyalty"),
    },
  ];

  return {
    doc: { id: RELEASE_DOC_ID, releases, gates: teamGates },
    flags,
    dod: {
      items: [
        {
          id: "ex-dod-review",
          label: "Code reviewed",
          category: "code",
          required: true,
          done: true,
        },
        {
          id: "ex-dod-tests",
          label: "Tests pass in CI",
          category: "testing",
          required: true,
          done: true,
        },
        { id: "ex-dod-docs", label: "Docs updated", category: "docs", required: false },
      ],
    },
  };
}
