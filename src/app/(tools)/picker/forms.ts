/**
 * The Picker's form checks: a saved list, a role, a number of names. Blank
 * is an error, never a silent default, and a list that would lose names to a
 * cap says so instead of dropping them.
 */

import { nameKey } from "@/lib/team/names";
import type { Validation } from "@/lib/utils/form";
import { PICKER_LIMITS, type PickerList, type PickerRole } from "@/lib/picker/model";
import { parseNames } from "@/lib/picker/people";

export interface ListDraft {
  name: string;
  /** One name per line (or comma-separated on one line). */
  names: string;
}

export const EMPTY_LIST_DRAFT: ListDraft = { name: "", names: "" };

/** A saved list's name and names, checked against the caps and the other lists. */
export function validateListDraft(
  draft: ListDraft,
  lists: readonly PickerList[],
  editingId?: string
): Validation<{ name: string; names: string[] }, "name" | "names"> {
  const errors: { name?: string; names?: string } = {};
  const name = draft.name.replace(/\s+/g, " ").trim();
  if (!name) errors.name = "Give the list a name.";
  else if (name.length > PICKER_LIMITS.maxListNameChars) {
    errors.name = `Keep the name to ${PICKER_LIMITS.maxListNameChars} characters.`;
  } else if (
    nameKey(name) === "team" ||
    lists.some((l) => l.id !== editingId && nameKey(l.name) === nameKey(name))
  ) {
    errors.name = "Another list has that name. Pick a different one.";
  }
  const parsed = parseNames(draft.names, PICKER_LIMITS.maxNames);
  if (parsed.names.length < 2) errors.names = "Add at least two names, one per line.";
  else if (parsed.dropped > 0) {
    errors.names = `A wheel holds up to ${PICKER_LIMITS.maxNames} names. Take ${parsed.dropped} out.`;
  } else if (parsed.cut > 0) {
    errors.names = `Keep each name to ${PICKER_LIMITS.maxNameChars} characters.`;
  }
  if (errors.name || errors.names) return { ok: false, errors };
  return { ok: true, values: { name, names: parsed.names } };
}

/** A list's entries after an edit: names kept keep their weights, new ones weigh 1. */
export function editedEntries(
  before: readonly { name: string; weight: number }[],
  names: readonly string[]
): { name: string; weight: number }[] {
  const weights = new Map(before.map((e) => [nameKey(e.name), e.weight]));
  return names.map((name) => ({ name, weight: weights.get(nameKey(name)) ?? 1 }));
}

export interface RoleDraft {
  name: string;
}

/** A new role's name: not blank, not too long, not a role the team already has. */
export function validateRoleDraft(
  draft: RoleDraft,
  roles: readonly PickerRole[]
): Validation<{ name: string }, "name"> {
  const name = draft.name.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, errors: { name: "Name the role, such as Note taker." } };
  if (name.length > PICKER_LIMITS.maxRoleNameChars) {
    return {
      ok: false,
      errors: { name: `Keep it to ${PICKER_LIMITS.maxRoleNameChars} characters.` },
    };
  }
  if (roles.some((r) => nameKey(r.name) === nameKey(name))) {
    return { ok: false, errors: { name: "That role is already on the list." } };
  }
  if (roles.length >= PICKER_LIMITS.maxRoles) {
    return {
      ok: false,
      errors: { name: `The Picker keeps up to ${PICKER_LIMITS.maxRoles} roles. Remove one first.` },
    };
  }
  return { ok: true, values: { name } };
}

/** "How many names": a whole number from 1 to `max`. */
export function validateCount(raw: string, max: number): Validation<number, "count"> {
  const text = raw.trim();
  if (!text) return { ok: false, errors: { count: "Enter how many names you want." } };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { ok: false, errors: { count: `Pick a whole number from 1 to ${max}.` } };
  }
  return { ok: true, values: n };
}
