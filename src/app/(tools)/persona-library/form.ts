/**
 * The Persona Library's add and edit form: its draft, the checks before a
 * save (the workspace.persona CRUD's caps, so an agent's later update of
 * the same persona isn't refused), the persona a save writes, and how a
 * draft from notes or interviews fills the form. Pure.
 */

import type { Persona, PersonaEvidence, PersonaTier } from "@/lib/stores/workspace-types";
import type { Validation, FormErrors } from "@/lib/utils/form";
import {
  PERSONA_CONTEXT_MAX,
  PERSONA_INTERVIEWS_MAX,
  PERSONA_LISTS,
  PERSONA_NAME_MAX,
  PERSONA_POINTS_MAX,
  PERSONA_POINT_MAX,
  PERSONA_QUOTE_MAX,
  PERSONA_ROLE_MAX,
  PERSONA_SUMMARY_MAX,
  PERSONA_TAGS_MAX,
  PERSONA_TAG_MAX,
  LIST_LABEL,
  cleanList,
  type PersonaList,
} from "@/lib/personas/model";
import type { PersonaFromNotesOutput } from "@/lib/ai/tasks/persona-library.lite";

/** What the form holds while it is being filled in. */
export interface PersonaFields {
  name: string;
  role: string;
  tier: PersonaTier;
  evidence: PersonaEvidence;
  summary: string;
  goals: string[];
  pains: string[];
  behaviours: string[];
  quote: string;
  context: string;
  /** Typed as one line, split on commas. */
  tags: string;
  interviewIds: string[];
}

export type PersonaField =
  | "name"
  | "role"
  | "summary"
  | "goals"
  | "pains"
  | "behaviours"
  | "quote"
  | "context"
  | "tags"
  | "interviewIds";

/** A checked form: what a save writes. */
export interface PersonaValues {
  name: string;
  role: string;
  tier: PersonaTier;
  evidence: PersonaEvidence;
  summary?: string;
  goals: string[];
  pains: string[];
  behaviours: string[];
  quote?: string;
  context?: string;
  tags: string[];
  interviewIds: string[];
}

/** An empty form for a new persona. */
export function emptyFields(tier: PersonaTier): PersonaFields {
  return {
    name: "",
    role: "",
    tier,
    evidence: "assumed",
    summary: "",
    goals: [],
    pains: [],
    behaviours: [],
    quote: "",
    context: "",
    tags: "",
    interviewIds: [],
  };
}

/** The form for editing a saved persona. */
export function fieldsOf(p: Persona): PersonaFields {
  return {
    name: p.name,
    role: p.role,
    tier: p.tier,
    evidence: p.evidence,
    summary: p.summary ?? "",
    goals: [...p.goals],
    pains: [...p.pains],
    behaviours: [...p.behaviours],
    quote: p.quote ?? "",
    context: p.context ?? "",
    tags: p.tags.join(", "),
    interviewIds: [...(p.interviewIds ?? [])],
  };
}

const n = (x: number) => x.toLocaleString("en-GB");

/** Tags as typed: each comma-separated part, trimmed, blanks dropped. */
const typedTags = (raw: string) =>
  raw
    .split(",")
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * Checks a form: a name and a role are required, and every field keeps to
 * the CRUD's caps. Nothing is cut silently: a field over its cap is an
 * error to fix. A duplicate name is only a warning (the page shows it).
 */
export function validatePersona(d: PersonaFields): Validation<PersonaValues, PersonaField> {
  const errors: FormErrors<PersonaField> = {};
  const name = d.name.replace(/\s+/g, " ").trim();
  const role = d.role.replace(/\s+/g, " ").trim();
  if (!name) errors.name = "Give the persona a made-up name.";
  else if (name.length > PERSONA_NAME_MAX)
    errors.name = `Keep the name to ${n(PERSONA_NAME_MAX)} characters.`;
  if (!role) errors.role = "Say what they do: their role.";
  else if (role.length > PERSONA_ROLE_MAX)
    errors.role = `Keep the role to ${n(PERSONA_ROLE_MAX)} characters.`;
  if (d.summary.trim().length > PERSONA_SUMMARY_MAX)
    errors.summary = `Keep the summary to ${n(PERSONA_SUMMARY_MAX)} characters.`;
  if (d.quote.trim().length > PERSONA_QUOTE_MAX)
    errors.quote = `Keep the quote to ${n(PERSONA_QUOTE_MAX)} characters.`;
  if (d.context.trim().length > PERSONA_CONTEXT_MAX)
    errors.context = `Keep the context to ${n(PERSONA_CONTEXT_MAX)} characters.`;
  for (const list of PERSONA_LISTS) {
    const items = d[list].map((p) => p.trim()).filter(Boolean);
    if (items.length > PERSONA_POINTS_MAX)
      errors[list] = `${LIST_LABEL[list]} hold ${PERSONA_POINTS_MAX} points at most. Remove some.`;
    else if (items.some((p) => p.length > PERSONA_POINT_MAX))
      errors[list] = `Keep each point to ${n(PERSONA_POINT_MAX)} characters.`;
  }
  const tags = typedTags(d.tags);
  if (tags.length > PERSONA_TAGS_MAX) errors.tags = `Use ${PERSONA_TAGS_MAX} tags at most.`;
  else if (tags.some((t) => t.length > PERSONA_TAG_MAX))
    errors.tags = `Keep each tag to ${n(PERSONA_TAG_MAX)} characters.`;
  if (d.interviewIds.length > PERSONA_INTERVIEWS_MAX)
    errors.interviewIds = `Link ${PERSONA_INTERVIEWS_MAX} interviews at most.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const list = (l: PersonaList) => cleanList(d[l], PERSONA_POINTS_MAX, PERSONA_POINT_MAX);
  const summary = d.summary.trim();
  const quote = d.quote.replace(/\s+/g, " ").trim();
  const context = d.context.trim();
  return {
    ok: true,
    values: {
      name,
      role,
      tier: d.tier,
      evidence: d.evidence,
      ...(summary ? { summary } : {}),
      goals: list("goals"),
      pains: list("pains"),
      behaviours: list("behaviours"),
      ...(quote ? { quote } : {}),
      ...(context ? { context } : {}),
      tags: cleanList(tags, PERSONA_TAGS_MAX, PERSONA_TAG_MAX),
      interviewIds: Array.from(new Set(d.interviewIds)),
    },
  };
}

/**
 * The persona a save writes: `prev`'s id and createdAt on an edit (with
 * any fields the form doesn't hold kept), a new one otherwise; updatedAt
 * is `at`.
 */
export function personaFromValues(
  v: PersonaValues,
  prev: Persona | null,
  id: string,
  at: string
): Persona {
  const next: Persona = {
    ...(prev ?? {}),
    id: prev?.id ?? id,
    name: v.name,
    role: v.role,
    tier: v.tier,
    evidence: v.evidence,
    goals: v.goals,
    pains: v.pains,
    behaviours: v.behaviours,
    tags: v.tags,
    createdAt: prev?.createdAt || at,
    updatedAt: at,
  };
  if (v.summary) next.summary = v.summary;
  else delete next.summary;
  if (v.quote) next.quote = v.quote;
  else delete next.quote;
  if (v.context) next.context = v.context;
  else delete next.context;
  if (v.interviewIds.length > 0) next.interviewIds = v.interviewIds;
  else delete next.interviewIds;
  return next;
}

/**
 * A draft from notes or interviews put into the form, losing nothing typed:
 * the name, role, summary, quote and context fill only blank fields; the
 * goals, frustrations, habits and tags are added to what is there (each
 * once, within the caps); interviews drafted from are linked. The tier and
 * the evidence stay as the person set them: how researched a persona is
 * is their call, and a draft may use only some of the interviews picked.
 * `added` counts the points it added.
 */
export function withDraft(
  fields: PersonaFields,
  draft: PersonaFromNotesOutput,
  opts: { interviewIds?: readonly string[] } = {}
): { fields: PersonaFields; added: number } {
  const next: PersonaFields = { ...fields };
  const fill = (key: "name" | "role" | "summary" | "quote" | "context", value?: string) => {
    if (!next[key].trim() && value?.trim()) next[key] = value.trim();
  };
  fill("name", draft.name);
  fill("role", draft.role);
  fill("summary", draft.summary);
  fill("quote", draft.quote);
  fill("context", draft.context);
  let added = 0;
  for (const list of PERSONA_LISTS) {
    const merged = cleanList(
      [...next[list], ...draft[list]],
      PERSONA_POINTS_MAX,
      PERSONA_POINT_MAX
    );
    added += merged.length - cleanList(next[list], PERSONA_POINTS_MAX, PERSONA_POINT_MAX).length;
    next[list] = merged;
  }
  next.tags = cleanList(
    [...typedTags(next.tags), ...draft.tags],
    PERSONA_TAGS_MAX,
    PERSONA_TAG_MAX
  ).join(", ");
  const ids = opts.interviewIds ?? [];
  if (ids.length > 0) {
    next.interviewIds = Array.from(new Set([...next.interviewIds, ...ids])).slice(
      0,
      PERSONA_INTERVIEWS_MAX
    );
  }
  return { fields: next, added };
}
