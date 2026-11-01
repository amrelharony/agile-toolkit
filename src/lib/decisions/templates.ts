/**
 * The three forms a decision record can be raised with, and what each one
 * names. ADR (the Decision Log's form) records the context, the options and
 * the outcome; DACI and RAPID add named roles around the one person with
 * the final say. All three share the ADR lifecycle (lib/decisions/model).
 *
 * Read by the Decision Log page on all three routes (/decision-log, /daci,
 * /rapid-decision), its agent actions and the next steps, so the labels,
 * the roles and the "who must be named before Decide" rule are the same
 * everywhere. Pure and server-safe.
 */

import type { DecisionRole, DecisionStatus, DecisionTemplate } from "@/lib/stores/workspace-types";

/** One named role a template asks for, besides the decider. */
export interface DecisionRoleSpec {
  role: DecisionRole;
  /** As the form labels it: "Driver", "Agree (A)". */
  label: string;
  /** Held by one person at most (DACI Driver, RAPID Recommend); a list otherwise. */
  single?: boolean;
  /** What the role does, for the field's hint. */
  hint: string;
}

export interface DecisionTemplateSpec {
  /** The template badge and filter chip: "ADR", "DACI", "RAPID". */
  label: string;
  /** The route's tool id, for history and the page wrapper. */
  toolId: "decision-log" | "daci" | "rapid-decision";
  /** The route that opens this template by default. */
  href: string;
  /** What the form calls `Decision.decider`. */
  deciderLabel: string;
  /** Whether Decide needs the decider named first (DACI and RAPID: the role is the point). */
  deciderRequiredToDecide: boolean;
  /** The named roles besides the decider, in the order the form shows them. */
  roles: readonly DecisionRoleSpec[];
}

export const TEMPLATES: Readonly<Record<DecisionTemplate, DecisionTemplateSpec>> = {
  adr: {
    label: "ADR",
    toolId: "decision-log",
    href: "/decision-log",
    deciderLabel: "Decider",
    deciderRequiredToDecide: false,
    roles: [],
  },
  daci: {
    label: "DACI",
    toolId: "daci",
    href: "/daci",
    deciderLabel: "Approver",
    deciderRequiredToDecide: true,
    roles: [
      {
        role: "driver",
        label: "Driver",
        single: true,
        hint: "Runs the process: gathers input, sets the deadline, writes the recommendation.",
      },
      {
        role: "contributor",
        label: "Contributors",
        hint: "Have the knowledge and are consulted; no vote.",
      },
      { role: "informed", label: "Informed", hint: "Told once it's decided." },
    ],
  },
  rapid: {
    label: "RAPID",
    toolId: "rapid-decision",
    href: "/rapid-decision",
    deciderLabel: "Decide (D)",
    deciderRequiredToDecide: true,
    roles: [
      {
        role: "recommend",
        label: "Recommend (R)",
        single: true,
        hint: "Owns the proposal: gathers the input and recommends.",
      },
      {
        role: "agree",
        label: "Agree (A)",
        hint: "Must agree: each one is a veto, so keep the list short.",
      },
      { role: "perform", label: "Perform (P)", hint: "Carries the decision out." },
      { role: "input", label: "Input (I)", hint: "Consulted for facts and views; no vote." },
    ],
  },
};

/** The roles that hold one person at most, from the template specs. */
export const SINGLE_ROLES: ReadonlySet<DecisionRole> = new Set(
  Object.values(TEMPLATES).flatMap((t) => t.roles.filter((r) => r.single).map((r) => r.role))
);

export const DECISION_STATUS_LABEL: Readonly<Record<DecisionStatus, string>> = {
  proposed: "Proposed",
  accepted: "Accepted",
  deprecated: "Deprecated",
  superseded: "Superseded",
};
