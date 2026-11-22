/**
 * Hand-off target: a rule proposed in the Working Agreement.
 *
 * A send appends a rule to the agreement's document (WA_ID) with nobody's
 * consent yet, under "Other", keeping where it came from (`sourceRef`: a
 * kickoff's rule). The team then consents to it on the page. A rule the
 * agreement already has (case, spacing and a closing full stop don't
 * count: `ruleKey`) isn't sent again. It is done once everyone on the team
 * has consented and nobody objects. P2.8 owns it after the base, keeping
 * its exports.
 */

import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CharterRule, WorkingAgreement } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
  WA_ID,
  consentOf,
  emptyAgreement,
  normalizeAgreement,
  ruleKey,
} from "@/lib/working-agreement/model";
import type { HandoffRoute, HandoffSource } from "../types";

/** Why a send can't go: the same rule is already there. */
export const RULE_ALREADY_THERE = "The Working Agreement already has this rule.";

const stored = (): WorkingAgreement | undefined =>
  (useWorkspaceStore.getState().workingAgreements ?? []).find((d) => d.id === WA_ID);

/** The agreement as the page reads it (an empty one when there is none). */
const agreement = (): WorkingAgreement => {
  const raw = stored();
  return raw ? normalizeAgreement(raw) : emptyAgreement();
};

const find = (id: string) => agreement().rules.find((r) => r.id === id);

/** The rule a send proposes: the title as its text, nobody's consent yet. */
export function buildAgreementRule(
  src: HandoffSource,
  id: string = crypto.randomUUID()
): CharterRule {
  const description = (src.description ?? "").trim().slice(0, RULE_DESCRIPTION_MAX);
  return {
    id,
    category: "other",
    text: src.title.trim().slice(0, RULE_TEXT_MAX),
    ...(description ? { description } : {}),
    agreedBy: [],
    consent: [],
    sourceRef: src.sourceRef,
  };
}

export const agreementRuleRoute: HandoffRoute = {
  id: "agreement-rule",
  label: "Working agreement rule",
  doneLabel: "Proposed in the Working Agreement",
  targetToolId: "working-agreement",
  targetHref: () => "/working-agreement",
  problem: (src) =>
    agreement().rules.some((r) => ruleKey(r.text) === ruleKey(src.title))
      ? RULE_ALREADY_THERE
      : null,
  send: (src) => {
    const doc = agreement();
    const rule = buildAgreementRule(src);
    useWorkspaceStore.getState().upsertWorkingAgreement({ ...doc, rules: [...doc.rules, rule] });
    return rule.id;
  },
  remove: (id) => {
    // The stored document, less that rule: Undo leaves everything else as it was.
    const doc = stored();
    if (!doc || !Array.isArray(doc.rules) || !doc.rules.some((r) => r?.id === id)) return;
    useWorkspaceStore
      .getState()
      .upsertWorkingAgreement({ ...doc, rules: doc.rules.filter((r) => r?.id !== id) });
  },
  exists: (id) => Boolean(find(id)),
  isDone: (id) => {
    const rule = find(id);
    if (!rule) return false;
    const members = useWorkspaceStore.getState().teamMembers.filter((m) => !isExampleId(m.id));
    return consentOf(rule, members).full;
  },
};
