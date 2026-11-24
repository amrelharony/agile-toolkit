/**
 * Kickoff's data-aware next steps (lib/tools/next-steps.ts calls
 * `kickoffNextSteps`). Example kickoffs never count, and neither do example
 * team members. In order:
 *   1. rules a kickoff sent to the Working Agreement that the whole team
 *      hasn't consented to yet: ask for that consent;
 *   2. no active Product Goal, but an agreed Inception deck, Project Poster
 *      or Team Alignment Map: turn it into one;
 *   3. an agreed kickoff and no sprint yet: plan the first one.
 *
 * Pure: no store, no React, no "use client" module.
 */

import { activeGoal } from "@/lib/product-goal/model";
import type {
  Kickoff,
  KickoffFormat,
  ProductGoal,
  Sprint,
  TeamMember,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { WA_ID, consentOf, normalizeAgreement } from "@/lib/working-agreement/model";
import { formatOf, itemsOf, readKickoffs } from "./model";

/** What the rule reads from the workspace. */
export interface KickoffStepsInput {
  kickoffs: readonly Kickoff[] | undefined;
  goals: readonly ProductGoal[] | undefined;
  agreements: readonly WorkingAgreement[] | undefined;
  members: readonly TeamMember[];
  sprints: readonly Sprint[];
}

/** The formats that describe a product's work, so a Product Goal can grow from them. */
const GOAL_FORMATS: ReadonlySet<KickoffFormat> = new Set<KickoffFormat>([
  "inception",
  "project-poster",
  "alignment-map",
]);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The agreement-rule links a kickoff's lines hold, as rule ids. */
function sentRuleIds(k: Kickoff): string[] {
  return formatOf(k).sections.flatMap((def) =>
    itemsOf(k, def.id).flatMap((item) =>
      (item.sentTo ?? []).filter((l) => l.route === "agreement-rule").map((l) => l.targetId)
    )
  );
}

/** Kickoff's next steps, given today (YYYY-MM-DD). */
export function kickoffNextSteps(s: KickoffStepsInput, today: string): NextStep[] {
  void today;
  const kickoffs = readKickoffs(s.kickoffs).filter((k) => !isExampleId(k.id));
  if (kickoffs.length === 0) return [];
  const steps: NextStep[] = [];

  // 1. Rules sent on that still wait for everyone's consent.
  const raw = (s.agreements ?? []).find((d) => d?.id === WA_ID);
  if (raw) {
    const agreement = normalizeAgreement(raw);
    const members = (s.members ?? []).filter((m) => !isExampleId(m.id));
    const ids = new Set(kickoffs.flatMap(sentRuleIds));
    const waiting = agreement.rules.filter(
      (r) => ids.has(r.id) && !consentOf(r, members).full
    ).length;
    if (waiting > 0) {
      steps.push({
        id: "kickoff-rules-consent",
        label: "Ask the team to consent to the kickoff's rules",
        detail: `${plural(waiting, "rule")} from a kickoff still ${waiting === 1 ? "waits" : "wait"} for everyone's consent in the Working Agreement.`,
        href: "/working-agreement",
      });
    }
  }

  const agreed = kickoffs.filter((k) => k.status === "agreed");

  // 2. An agreed product kickoff, and no Product Goal to aim the sprints at.
  const product = agreed.find((k) => GOAL_FORMATS.has(k.format));
  if (product && !activeGoal(s.goals)) {
    steps.push({
      id: "kickoff-product-goal",
      label: "Turn the kickoff into a Product Goal",
      detail: `“${product.title.trim() || formatOf(product).name}” is agreed, and there's no active Product Goal yet.`,
      href: "/product-goal",
    });
  }

  // 3. An agreed kickoff, and no sprint of the team's own yet.
  if (agreed.length > 0 && !(s.sprints ?? []).some((sp) => !isExampleId(sp.id))) {
    steps.push({
      id: "kickoff-first-sprint",
      label: "Plan the first sprint",
      detail: "The kickoff is agreed. Turn it into the first sprint's goal and stories.",
      href: "/sprint-planning",
    });
  }

  return steps;
}
