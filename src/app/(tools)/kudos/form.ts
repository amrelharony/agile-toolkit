import type { Validation } from "@/lib/utils/form";
import { MESSAGE_CHAR_MAX } from "@/lib/kudos/parse";
import { KUDOS_WORD_LIMITS, countWords } from "./types";

/** The longest recipient name the form takes (as the parser's id-free fields allow). */
export const RECIPIENT_MAX = 64;

export interface KudosDraft {
  /** The recipient's name: the picked option's, or the one typed. */
  to: string;
  message: string;
  team: string;
}

export type KudosField = keyof KudosDraft;

export interface KudosValues {
  to: string;
  message: string;
  team?: string;
}

/**
 * Check a kudos before it is sent. A recipient and a message are required,
 * and nobody is picked on the sender's behalf (the first teammate used to be
 * selected on load, so a quick Send went to whoever was first in the list).
 * The word limits are the card's (KUDOS_WORD_LIMITS); the team is optional.
 */
export function validateKudosDraft(d: KudosDraft): Validation<KudosValues, KudosField> {
  const errors: Partial<Record<KudosField, string>> = {};
  const to = d.to.replace(/\s+/g, " ").trim();
  const message = d.message.trim();
  const team = d.team.replace(/\s+/g, " ").trim();
  if (!to) errors.to = "Pick who the kudos is for.";
  else if (countWords(to) > KUDOS_WORD_LIMITS.to || to.length > RECIPIENT_MAX)
    errors.to = `Keep the name to ${KUDOS_WORD_LIMITS.to} words.`;
  if (!message) errors.message = "Write what you're thanking them for.";
  // Fifty words can still be a very long string (no spaces, a pasted token),
  // which the parser, the wall and a card's link would all refuse.
  else if (countWords(message) > KUDOS_WORD_LIMITS.message || message.length > MESSAGE_CHAR_MAX)
    errors.message = `Keep it to ${KUDOS_WORD_LIMITS.message} words.`;
  if (countWords(team) > KUDOS_WORD_LIMITS.team)
    errors.team = `Keep the team to ${KUDOS_WORD_LIMITS.team} words.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { to, message, ...(team ? { team } : {}) } };
}
