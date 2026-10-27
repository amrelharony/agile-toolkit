/**
 * The User Interviews page's checks: an interview needs who it was with
 * (a pseudonym is fine) and a day that has happened; a quote needs its
 * words. Nothing is saved until these pass, and an interview's day can be
 * moved back to when the session took place. The caps and the tag rule
 * are lib/interviews', which tool.user_interviews applies too.
 */

import type { Interview, InterviewQuote } from "@/lib/stores/workspace-types";
import { isDay } from "@/lib/hypotheses/model";
import { CONTEXT_MAX, PARTICIPANT_MAX, QUOTE_TEXT_MAX, normTags } from "@/lib/interviews/model";
import type { FormErrors, Validation } from "@/lib/utils/form";

export interface InterviewDraft {
  participant: string;
  /** YYYY-MM-DD; can be backdated. */
  date: string;
  context: string;
}

export type InterviewField = keyof InterviewDraft;

export interface InterviewValues {
  participant: string;
  date: string;
  /** Undefined when blank: the key is removed. */
  context: string | undefined;
}

export const emptyInterviewDraft = (today: string): InterviewDraft => ({
  participant: "",
  date: today,
  context: "",
});

export const interviewDraftFrom = (i: Interview): InterviewDraft => ({
  participant: i.participant ?? "",
  date: (i.date ?? "").slice(0, 10),
  context: i.context ?? "",
});

/** Why a typed day can't be the interview's, or null. A saved day left as it is stays valid. */
export function interviewDayError(day: string, today: string, kept?: string): string | null {
  if (kept !== undefined && day === kept) return null;
  if (!day.trim()) return "Pick the day of the interview.";
  if (!isDay(day)) return "Pick a date from the calendar.";
  if (day > today) return "It can't be on a day that hasn't happened yet.";
  return null;
}

export const PARTICIPANT_REQUIRED = "Say who it was with: a pseudonym like “Customer 3” is fine.";

/**
 * Check an interview's details. `stored` is the saved interview when
 * editing: a context longer than the cap that is left as it is stays, and
 * so does its day (an agent over MCP may have stamped the user's today,
 * the server's tomorrow). A saved interview with no participant (the old
 * page's "New Interview" saved them blank) keeps that blank while another
 * field is edited, so its context and day can still be saved; the page's
 * participant field asks for a name whenever it is itself edited.
 */
export function validateInterview(
  d: InterviewDraft,
  today: string,
  stored?: Interview
): Validation<InterviewValues, InterviewField> {
  const errors: FormErrors<InterviewField> = {};
  const participant = d.participant.trim();
  const context = d.context.trim();
  const blankKept = stored !== undefined && !(stored.participant ?? "").trim();
  if (!participant) {
    if (!blankKept) errors.participant = PARTICIPANT_REQUIRED;
  } else if (participant.length > PARTICIPANT_MAX && participant !== stored?.participant?.trim()) {
    errors.participant = `Keep it to ${PARTICIPANT_MAX} characters or fewer.`;
  }
  const dayError = interviewDayError(
    d.date,
    today,
    stored ? (stored.date ?? "").slice(0, 10) : undefined
  );
  if (dayError) errors.date = dayError;
  if (context.length > CONTEXT_MAX && context !== (stored?.context ?? "").trim()) {
    errors.context = `Keep it to ${CONTEXT_MAX} characters or fewer.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { participant, date: d.date, context: context || undefined } };
}

/** The interview saved with checked values; other keys (its quotes) are kept. */
export function applyInterviewValues(i: Interview, v: InterviewValues): Interview {
  const next: Interview = { ...i, participant: v.participant, date: v.date };
  if (v.context === undefined) delete next.context;
  else next.context = v.context;
  return next;
}

/* ── Quotes ──────────────────────────────────────────────────────────── */

export interface QuoteDraft {
  text: string;
  /** "pricing, onboarding", as typed. */
  tags: string;
}

export type QuoteField = keyof QuoteDraft;

export interface QuoteValues {
  text: string;
  tags: string[];
}

export const emptyQuoteDraft = (): QuoteDraft => ({ text: "", tags: "" });

export const quoteDraftFrom = (q: InterviewQuote): QuoteDraft => ({
  text: q.text ?? "",
  tags: (q.tags ?? []).join(", "),
});

/** "Pricing,  UX , pricing" → ["pricing", "ux"]: lower-case, each once, as an agent's tags are stored. */
export const parseTags = (input: string): string[] => normTags(input.split(","));

/** Check a quote. A longer text saved before is kept while it is unchanged. */
export function validateQuote(
  d: QuoteDraft,
  stored?: InterviewQuote
): Validation<QuoteValues, QuoteField> {
  const text = d.text.trim();
  if (!text) return { ok: false, errors: { text: "Type what they said." } };
  if (text.length > QUOTE_TEXT_MAX && text !== (stored?.text ?? "").trim()) {
    return { ok: false, errors: { text: `Keep it to ${QUOTE_TEXT_MAX} characters or fewer.` } };
  }
  return { ok: true, values: { text, tags: parseTags(d.tags) } };
}
