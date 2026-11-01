/**
 * The licence request form's rules, shared by the form and its route so a
 * message the page accepts is one the server accepts too. Pure.
 */

import { isBlank, requiredErrors, type Validation } from "@/lib/utils/form";

/** Mirrors the length checks in migration 0029. */
export const LICENCE_LIMITS = {
  name: 120,
  company: 160,
  email: 254,
  intendedUse: 1000,
  teamSize: 40,
  message: 2000,
} as const;

export type LicenceField = keyof typeof LICENCE_LIMITS;
export type LicenceDraft = Record<LicenceField, string>;

export const EMPTY_LICENCE_DRAFT: LicenceDraft = {
  name: "",
  company: "",
  email: "",
  intendedUse: "",
  teamSize: "",
  message: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED: Partial<LicenceDraft> = {
  name: "Enter your name.",
  company: "Enter your company.",
  email: "Enter your work email.",
  intendedUse: "Tell us how you'd like to use the comic.",
  teamSize: "Enter how many people would see it.",
};

/**
 * Control characters go first: Postgres refuses a NUL in text, and nothing
 * typed into this form needs one. Tabs and line breaks stay for the message.
 */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/** Check a draft, from the form or from a request body of unknown shape. */
export function validateLicenceDraft(
  draft: Partial<Record<LicenceField, unknown>>
): Validation<LicenceDraft, LicenceField> {
  const values: LicenceDraft = {
    name: clean(draft.name),
    company: clean(draft.company),
    email: clean(draft.email),
    intendedUse: clean(draft.intendedUse),
    teamSize: clean(draft.teamSize),
    message: clean(draft.message),
  };
  const errors = requiredErrors<LicenceField>(values, REQUIRED);
  if (!isBlank(values.email) && !EMAIL_PATTERN.test(values.email)) {
    errors.email = "Enter a valid email address.";
  }
  for (const field of Object.keys(LICENCE_LIMITS) as LicenceField[]) {
    const limit = LICENCE_LIMITS[field];
    if (values[field].length > limit) errors[field] = `Keep this under ${limit} characters.`;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}
