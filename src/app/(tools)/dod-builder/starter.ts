import type { DodCriterion } from "@/lib/stores/workspace-types";

/**
 * Criteria many teams start from. Written into the team's DoD only when
 * someone picks "Start from common criteria" (with Undo), never as a
 * default: the page used to show these as the team's DoD on a first visit
 * and save them on the first tick.
 */
export const COMMON_CRITERIA: Omit<DodCriterion, "id">[] = [
  { label: "Code reviewed by a peer", category: "code", required: true },
  { label: "Unit tests added or updated", category: "testing", required: true },
  { label: "Integration tests pass in CI", category: "testing", required: true },
  { label: "Acceptance criteria met", category: "other", required: true },
  { label: "README or inline docs updated", category: "docs", required: false },
  { label: "Security review for sensitive changes", category: "security", required: false },
];
