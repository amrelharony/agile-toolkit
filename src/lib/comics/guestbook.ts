/**
 * The guestbook's rules, shared by its form and its route so a note the page
 * accepts is one the server accepts too. Pure.
 *
 * Every note waits for the owner: nothing anyone writes is shown until it's
 * approved in the portal (/settings/comics, Guestbook).
 */

import { requiredErrors, type Validation } from "@/lib/utils/form";

export const GUESTBOOK_ROUTE = "/comics/guestbook";

/**
 * The readers' WhatsApp community. Null until Amr has one to share: the page
 * offers no link before then.
 */
export const COMMUNITY_URL: string | null = null;

/** Mirrors the length checks in migration 0033. */
export const GUESTBOOK_LIMITS = {
  name: 60,
  message: 500,
} as const;

export type GuestbookField = keyof typeof GUESTBOOK_LIMITS;
export type GuestbookDraft = Record<GuestbookField, string>;

export const EMPTY_GUESTBOOK_DRAFT: GuestbookDraft = { name: "", message: "" };

const REQUIRED: GuestbookDraft = {
  name: "Enter your name, or how you'd like to be known.",
  message: "Write a note.",
};

/** A note the public page shows: never when it was written, never who wrote it beyond their name. */
export interface GuestbookNote {
  id: string;
  name: string;
  message: string;
}

/**
 * Control characters go first: Postgres refuses a NUL in text. Line breaks
 * stay for the message.
 */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/** Check a draft, from the form or from a request body of unknown shape. */
export function validateGuestbookDraft(
  draft: Partial<Record<GuestbookField, unknown>>
): Validation<GuestbookDraft, GuestbookField> {
  const values: GuestbookDraft = { name: clean(draft.name), message: clean(draft.message) };
  const errors = requiredErrors<GuestbookField>(values, REQUIRED);
  for (const field of Object.keys(GUESTBOOK_LIMITS) as GuestbookField[]) {
    const limit = GUESTBOOK_LIMITS[field];
    if (values[field].length > limit) errors[field] = `Keep this under ${limit} characters.`;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}
