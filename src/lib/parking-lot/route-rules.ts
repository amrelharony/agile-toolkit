/**
 * Where a parked point could go, without AI: keyword rules over its words.
 * The AI task's fallback (lib/ai/tasks/parking-lot) and the agent's
 * suggest_routes verb both use them, so the page works fully with AI off.
 * It only suggests: the person accepts each one.
 *
 * The rules run in order, the first match wins:
 *   1. drop       — the point says it is settled or no longer matters;
 *   2. impediment — something outside the team blocks or slows it;
 *   3. action     — it is about how the team works together;
 *   4. backlog    — it is work on the product;
 * and anything else goes to the backlog, where refinement decides.
 */

import type { ParkingDestination } from "./model";

/** Longest reason a suggestion carries (the AI task's cap too). */
export const ROUTE_REASON_MAX = 160;

interface RouteRule {
  destination: ParkingDestination;
  test: RegExp;
  reason: string;
}

const RULES: readonly RouteRule[] = [
  {
    destination: "drop",
    test: /\b(never ?mind|no longer|not (?:an issue|needed|relevant|important)|already (?:done|fixed|sorted|decided|settled|resolved|answered|covered)|out of date|obsolete|duplicate|answered|settled)\b/i,
    reason: "It sounds settled already: drop it, or say what is still open.",
  },
  {
    destination: "impediment",
    test: /\b(block(?:ed|er|ers|ing|s)?|stuck|waiting (?:on|for)|can(?:'|’)?t|cannot|unable|no access|access to|permissions?|outage|is down|went down|depends? on|dependency|another team|other team|approval|licen[cs]es?|vpn|budget|security review|legal)\b/i,
    reason: "Something outside the team is in the way: raise it as an impediment.",
  },
  {
    destination: "action",
    test: /\b(we should|let(?:'|’)?s|how we|our (?:process|way of working|standups?|meetings?|retros?|reviews?)|working agreement|definition of done|agree (?:on|how|when)|pair(?:ing)?|code reviews?|review process|on-?call|hand-?overs?|ceremon(?:y|ies)|communicat\w*|too (?:long|many|late)|start doing|stop doing|keep doing|improve)\b/i,
    reason: "It is about how the team works: make it a retro action the team owns.",
  },
  {
    destination: "backlog",
    test: /\b(add|build|feature|bug|fix|story|users?|customers?|page|screen|button|api|endpoint|report|export|import|refactor|tests?|testing|tech(?:nical)? debt|implement\w*|integrat\w*|migrat\w*|upgrade|design|performance)\b/i,
    reason: "It is work on the product: put it on the backlog to refine and size.",
  },
];

const DEFAULT_RULE: RouteRule = {
  destination: "backlog",
  test: /.*/,
  reason: "It reads like work to do: put it on the backlog, where refinement can decide.",
};

/** The destination the rules pick for a point's words, with the reason in plain words. */
export function routeByRules(text: string): { destination: ParkingDestination; reason: string } {
  const rule = RULES.find((r) => r.test.test(text)) ?? DEFAULT_RULE;
  return { destination: rule.destination, reason: rule.reason };
}
