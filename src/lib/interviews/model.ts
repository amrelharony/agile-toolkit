/**
 * User interviews: tagged quotes, and the themes they add up to.
 *
 * A theme is counted per participant, not per quote: one person who tags
 * "pricing" on five quotes is one voice, and four people who mention it
 * once are four. A participant is matched by name across interviews
 * (ignoring case and spacing), so two sessions with the same person count
 * once. Anonymising gives each participant a stable pseudonym for the
 * export ("Participant 1" … in order of first appearance) and runs the
 * context and the quotes through redactPii. A quote can be raised as an
 * opportunity on the Opportunity Tree (the "opportunity" hand-off), with
 * its redacted text and never the participant's name.
 *
 * Shared by the User Interviews page (its exports, markdown and AI
 * prompt), tool.user_interviews and the next steps. Pure and server-safe:
 * nothing here imports a "use client" module, React or the store.
 */

import type { Interview, InterviewQuote, TreeNode } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { redactPii } from "@/lib/utils/redact-pii";
import { isDay } from "@/lib/hypotheses/model";

/** The log's one document id: the page, tool.user_interviews and the hand-off's back-link use it. */
export const UI_ID = "userInterviewLog:current";

/** A participant's name or label. */
export const PARTICIPANT_MAX = 200;
/** An interview's context notes. */
export const CONTEXT_MAX = 2000;
/** One quote. */
export const QUOTE_TEXT_MAX = 4000;

/** A tag as it is counted: trimmed and lower-case ("UX " and "ux" are one theme). */
export function normTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Tags as stored: normalised, blanks dropped, each once, in the order typed. */
export function normTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags.map(normTag).filter(Boolean)));
}

/**
 * Who an interview was with, as a key: the name ignoring case and spacing.
 * An interview with no name is its own participant ("#" + its id), so two
 * unnamed sessions never merge into one voice.
 */
export function participantKey(i: Pick<Interview, "id" | "participant">): string {
  const name = (i.participant ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return name || `#${i.id}`;
}

export interface ThemeCount {
  tag: string;
  /** How many participants raised it (in any of their interviews). */
  participants: number;
  /** How many quotes carry it. */
  quotes: number;
}

/**
 * Every theme with how many participants and quotes carry it: most
 * participants first, then most quotes, then by name. A quote that lists
 * a tag twice counts once.
 */
export function themeCounts(interviews: readonly Interview[]): ThemeCount[] {
  const people = new Map<string, Set<string>>();
  const quotes = new Map<string, number>();
  for (const i of interviews) {
    const who = participantKey(i);
    for (const q of i.quotes ?? []) {
      for (const tag of normTags(q.tags ?? [])) {
        if (!people.has(tag)) people.set(tag, new Set());
        people.get(tag)!.add(who);
        quotes.set(tag, (quotes.get(tag) ?? 0) + 1);
      }
    }
  }
  return Array.from(people.entries())
    .map(([tag, who]) => ({ tag, participants: who.size, quotes: quotes.get(tag) ?? 0 }))
    .sort(
      (a, b) =>
        b.participants - a.participants ||
        b.quotes - a.quotes ||
        (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)
    );
}

/** The distinct participants across the interviews. */
export function participantCount(interviews: readonly Interview[]): number {
  return new Set(interviews.map(participantKey)).size;
}

/** The quotes carrying `tag` (normalised), with their interview, in the log's order. */
export function quotesTagged(
  interviews: readonly Interview[],
  tag: string
): { interview: Interview; quote: InterviewQuote }[] {
  const want = normTag(tag);
  if (!want) return [];
  return interviews.flatMap((interview) =>
    (interview.quotes ?? [])
      .filter((quote) => (quote.tags ?? []).some((t) => normTag(t) === want))
      .map((quote) => ({ interview, quote }))
  );
}

/**
 * The interviews as an anonymised export or AI prompt shows them: each
 * participant becomes "Participant N", numbered by first appearance in
 * the given order (the same person keeps one number, so themes still
 * count per participant), and the context and every quote go through
 * redactPii. Names inside the text are not caught: redactPii says so.
 */
export function anonymiseInterviews(interviews: readonly Interview[]): Interview[] {
  const numbers = new Map<string, number>();
  return interviews.map((i) => {
    const key = participantKey(i);
    if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    const out: Interview = {
      ...i,
      participant: `Participant ${numbers.get(key)}`,
      quotes: (i.quotes ?? []).map((q) => ({ ...q, text: redactPii(q.text ?? "") })),
    };
    if (i.context !== undefined) out.context = redactPii(i.context);
    return out;
  });
}

/**
 * The opportunity a quote was raised as, while it is still on the tree
 * (`nodes`, the tree's nodes). A link whose node was deleted reads as
 * never sent, so the quote can be sent again, as the hand-off's liveLink
 * reads it in the browser.
 */
export function sentOpportunity(
  q: Pick<InterviewQuote, "sentTo">,
  nodes: readonly TreeNode[]
): TreeNode | undefined {
  const link = (q.sentTo ?? []).find((l) => l.route === "opportunity");
  return link ? nodes.find((n) => n.id === link.targetId) : undefined;
}

/**
 * What raising a quote as an opportunity hands over: its redacted text
 * (no participant name), the interview's day as the evidence, the node to
 * go under, and where it came from.
 */
export function quoteOpportunitySource(
  q: InterviewQuote,
  i: Pick<Interview, "id" | "date">,
  parentId?: string
): HandoffSource {
  const day = (i.date ?? "").slice(0, 10);
  return {
    title: redactPii(q.text ?? "").trim(),
    description: isDay(day) ? `From an interview on ${day}` : "From an interview",
    ...(parentId ? { parentId } : {}),
    sourceRef: { tool: "user-interviews", id: q.id, doc: i.id },
  };
}
