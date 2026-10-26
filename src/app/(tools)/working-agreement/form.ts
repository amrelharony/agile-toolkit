import type {
  CharterConsentVote,
  CharterRule,
  CharterRuleCategory,
} from "@/lib/stores/workspace-types";
import {
  CONSENT_NOTE_MAX,
  RULE_DESCRIPTION_MAX,
  RULE_TEXT_MAX,
} from "@/lib/working-agreement/model";
import type { Validation } from "@/lib/utils/form";
import { ruleKey } from "./catalog";

/** A day as a date input gives it. */
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Add a rule ─────────────────────────────────────────────────────── */

export interface RuleDraft {
  category: CharterRuleCategory;
  text: string;
  description: string;
}

export type RuleField = keyof RuleDraft;

export interface RuleValues {
  category: CharterRuleCategory;
  text: string;
  description?: string;
}

export const EMPTY_RULE: RuleDraft = { category: "communication", text: "", description: "" };

/**
 * Check a new rule: it needs words, and the charter can't hold the same
 * rule twice (case, spacing and a closing full stop aside). The category
 * is a visible choice, so it needs no message.
 */
export function validateRule(
  d: RuleDraft,
  existing: readonly Pick<CharterRule, "text">[]
): Validation<RuleValues, RuleField> {
  const errors: Partial<Record<RuleField, string>> = {};
  const text = d.text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const description = d.description.trim();
  if (!text) errors.text = "Say what the team agrees to.";
  else if (text.length > RULE_TEXT_MAX) errors.text = `Keep it to ${RULE_TEXT_MAX} characters.`;
  else if (existing.some((r) => ruleKey(r.text) === ruleKey(text))) {
    errors.text = "That rule is already in the charter.";
  }
  if (description.length > RULE_DESCRIPTION_MAX) {
    errors.description = `Keep it to ${RULE_DESCRIPTION_MAX} characters.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { category: d.category, text, ...(description ? { description } : {}) },
  };
}

/* ── Save a check-in round ──────────────────────────────────────────── */

export interface CheckInDraft {
  /** YYYY-MM-DD. */
  date: string;
  /** "" for no sprint. */
  sprintId: string;
  note: string;
}

export type CheckInField = keyof CheckInDraft | "rules";

export interface CheckInValues {
  date: string;
  sprintId?: string;
  note?: string;
}

/**
 * Check a round before it is saved: a real day, not after today (a round
 * held last week can be logged now), and at least one rule marked, since
 * an empty round would read as 0% adherence.
 */
export function validateCheckIn(
  d: CheckInDraft,
  marked: number,
  today: string
): Validation<CheckInValues, CheckInField> {
  const errors: Partial<Record<CheckInField, string>> = {};
  const date = d.date.trim();
  if (!date) errors.date = "Pick the day the team checked in.";
  else if (!ISO_DAY.test(date)) errors.date = "Use a date like 2026-10-24.";
  else if (date > today) errors.date = "Pick today or an earlier day.";
  if (marked === 0) {
    errors.rules = "Mark at least one rule Working, Partly or Not working first.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const note = d.note.trim();
  return {
    ok: true,
    values: { date, ...(d.sprintId ? { sprintId: d.sprintId } : {}), ...(note ? { note } : {}) },
  };
}

/* ── Record someone's answer (a person off the roster) ──────────────── */

export interface ConsentDraft {
  name: string;
  /** "" until picked: no answer is assumed. */
  vote: CharterConsentVote | "";
  note: string;
}

export type ConsentField = keyof ConsentDraft;

export interface ConsentValues {
  name: string;
  vote: CharterConsentVote;
  note?: string;
}

export const EMPTY_CONSENT: ConsentDraft = { name: "", vote: "", note: "" };

export function validateConsent(d: ConsentDraft): Validation<ConsentValues, ConsentField> {
  const errors: Partial<Record<ConsentField, string>> = {};
  const name = d.name.trim();
  const note = d.note.trim();
  if (!name) errors.name = "Who is answering?";
  else if (name.length > 60) errors.name = "Keep the name to 60 characters.";
  if (!d.vote) errors.vote = "Pick their answer.";
  if (note.length > CONSENT_NOTE_MAX) errors.note = `Keep it to ${CONSENT_NOTE_MAX} characters.`;
  if (Object.keys(errors).length > 0 || !d.vote) return { ok: false, errors };
  return {
    ok: true,
    values: { name, vote: d.vote, ...(note && d.vote !== "consent" ? { note } : {}) },
  };
}
