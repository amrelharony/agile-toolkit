/**
 * The Persona Library's model: reading a stored persona back, the labels the
 * page and Markdown use, the duplicate-name check, where a persona is used
 * (the impact maps whose actors name it) and the interviews it comes from.
 *
 * Shared by the page, tool.persona_library and the next steps. Pure and
 * server-safe: nothing here imports the store, React or a "use client"
 * module, so the MCP route can call it.
 */

import {
  PERSONA_EVIDENCE,
  PERSONA_TIERS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type Interview,
  type Persona,
  type PersonaEvidence,
  type PersonaTier,
  type StrategyMap,
} from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";

/** Persona ids, as the workspace.persona CRUD mints them. */
export const PERSONA_ID_PREFIX = "persona_";

/** The three lists a persona keeps. */
export const PERSONA_LISTS = ["goals", "pains", "behaviours"] as const;
export type PersonaList = (typeof PERSONA_LISTS)[number];

export const LIST_LABEL: Record<PersonaList, string> = {
  goals: "Goals",
  pains: "Frustrations",
  behaviours: "Habits",
};

/** One point of a list, for "Remove goal …". */
export const LIST_ONE: Record<PersonaList, string> = {
  goals: "goal",
  pains: "frustration",
  behaviours: "habit",
};

export const TIER_LABEL: Record<PersonaTier, string> = {
  primary: "Main",
  secondary: "Also served",
  anti: "Not for us",
};

export const EVIDENCE_LABEL: Record<PersonaEvidence, string> = {
  assumed: "Our guess",
  some: "Some evidence",
  researched: "Researched",
};

/** The caps the workspace.persona CRUD holds a persona to (forms enforce the same). */
export const PERSONA_NAME_MAX = TOOL_TEXT_MAX.short;
export const PERSONA_ROLE_MAX = TOOL_TEXT_MAX.short;
export const PERSONA_SUMMARY_MAX = TOOL_TEXT_MAX.text;
export const PERSONA_QUOTE_MAX = TOOL_TEXT_MAX.short;
export const PERSONA_CONTEXT_MAX = TOOL_TEXT_MAX.text;
export const PERSONA_POINT_MAX = TOOL_TEXT_MAX.short;
export const PERSONA_POINTS_MAX = TOOL_LIST_MAX.personaPoints;
export const PERSONA_TAG_MAX = TOOL_TEXT_MAX.short;
export const PERSONA_TAGS_MAX = TOOL_LIST_MAX.tags;
export const PERSONA_INTERVIEWS_MAX = TOOL_LIST_MAX.personaInterviews;

const isTier = (v: unknown): v is PersonaTier =>
  typeof v === "string" && (PERSONA_TIERS as readonly string[]).includes(v);
const isEvidence = (v: unknown): v is PersonaEvidence =>
  typeof v === "string" && (PERSONA_EVIDENCE as readonly string[]).includes(v);

/** `v` as one trimmed line of text cut to `max`, or "" when it isn't text. */
function line(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
}

/** `v` as text cut to `max` (line breaks kept), or "" when it isn't text. */
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max).trim() : "";
}

/**
 * A list as stored: each item one trimmed line of at most `itemMax`, blanks
 * dropped, each once (ignoring case), at most `max`, in the order given.
 */
export function cleanList(raw: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = line(item, itemMax);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Tags typed as one line: split on commas, each cleaned, at most PERSONA_TAGS_MAX. */
export function tagsFromText(raw: string): string[] {
  return cleanList(raw.split(","), PERSONA_TAGS_MAX, PERSONA_TAG_MAX);
}

/**
 * A stored persona as the page reads it, or null with no id. Text is cut to
 * the CRUD's caps; an unknown tier reads as "secondary" and unknown
 * evidence as "assumed"; a blank name reads as "Unnamed persona", so the
 * card still says something (the edit form asks for a real one).
 */
export function readPersona(raw: unknown): Persona | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const out: Persona = {
    id: r.id,
    name: line(r.name, PERSONA_NAME_MAX) || "Unnamed persona",
    role: line(r.role, PERSONA_ROLE_MAX),
    tier: isTier(r.tier) ? r.tier : "secondary",
    evidence: isEvidence(r.evidence) ? r.evidence : "assumed",
    goals: cleanList(r.goals, PERSONA_POINTS_MAX, PERSONA_POINT_MAX),
    pains: cleanList(r.pains, PERSONA_POINTS_MAX, PERSONA_POINT_MAX),
    behaviours: cleanList(r.behaviours, PERSONA_POINTS_MAX, PERSONA_POINT_MAX),
    tags: cleanList(r.tags, PERSONA_TAGS_MAX, PERSONA_TAG_MAX),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
  const summary = text(r.summary, PERSONA_SUMMARY_MAX);
  if (summary) out.summary = summary;
  const quote = line(r.quote, PERSONA_QUOTE_MAX);
  if (quote) out.quote = quote;
  const context = text(r.context, PERSONA_CONTEXT_MAX);
  if (context) out.context = context;
  const interviews = cleanList(r.interviewIds, PERSONA_INTERVIEWS_MAX, TOOL_TEXT_MAX.short);
  if (interviews.length > 0) out.interviewIds = interviews;
  return out;
}

const TIER_ORDER: Record<PersonaTier, number> = { primary: 0, secondary: 1, anti: 2 };

/** Every readable persona: main ones first, then also served, then not for us; by name within. */
export function readPersonas(raw: readonly unknown[] | undefined): Persona[] {
  return (raw ?? [])
    .map(readPersona)
    .filter((p): p is Persona => p !== null)
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
}

/** The persona already called `name` (trimmed, any case), other than `exceptId`. */
export function duplicateOf(
  name: string,
  personas: readonly Pick<Persona, "id" | "name">[],
  exceptId?: string
): Pick<Persona, "id" | "name"> | undefined {
  const key = nameKey(name.replace(/\s+/g, " "));
  if (!key) return undefined;
  return personas.find(
    (p) => p.id !== exceptId && nameKey((p.name ?? "").replace(/\s+/g, " ")) === key
  );
}

/** The tier a new persona starts with: main while the library has no main one, else also served. */
export function defaultTier(personas: readonly Pick<Persona, "id" | "tier">[]): PersonaTier {
  return personas.some((p) => p.tier === "primary" && !isExampleId(p.id)) ? "secondary" : "primary";
}

/**
 * The impact maps that use the persona: an impact map (not a strategy
 * tree) with an actor (level 1) whose `personaId` is the persona's. In the
 * maps' order.
 */
export function usedOnMaps(
  persona: Pick<Persona, "id">,
  maps: readonly StrategyMap[] | undefined
): StrategyMap[] {
  return (maps ?? []).filter(
    (m) =>
      m.format === "impact-map" &&
      Array.isArray(m.nodes) &&
      m.nodes.some((n) => n.level === 1 && n.personaId === persona.id)
  );
}

/** The interviews a persona links that are still in the log, in the log's order. */
export function linkedInterviews(
  persona: Pick<Persona, "interviewIds">,
  interviews: readonly Interview[]
): Interview[] {
  const ids = new Set(persona.interviewIds ?? []);
  return ids.size === 0 ? [] : interviews.filter((i) => ids.has(i.id));
}

/**
 * `items` added to one of a persona's lists: trimmed, cut to a point's cap,
 * each once (a point it already has, in any case, is skipped), while the
 * list has room. Returns the persona unchanged (the same object) when
 * nothing was added.
 */
export function withPoints(
  persona: Persona,
  list: PersonaList,
  items: readonly string[]
): { persona: Persona; added: number; skipped: number } {
  const current = persona[list] ?? [];
  const seen = new Set(current.map((p) => p.toLowerCase()));
  const next = [...current];
  let skipped = 0;
  for (const raw of items) {
    const t = line(raw, PERSONA_POINT_MAX);
    if (!t || seen.has(t.toLowerCase()) || next.length >= PERSONA_POINTS_MAX) {
      skipped++;
      continue;
    }
    seen.add(t.toLowerCase());
    next.push(t);
  }
  const added = next.length - current.length;
  return added === 0
    ? { persona, added, skipped }
    : { persona: { ...persona, [list]: next }, added, skipped };
}

/** How many personas sit in each tier and at each level of evidence. */
export function personaCounts(personas: readonly Pick<Persona, "tier" | "evidence">[]): {
  tiers: Record<PersonaTier, number>;
  evidence: Record<PersonaEvidence, number>;
} {
  const tiers: Record<PersonaTier, number> = { primary: 0, secondary: 0, anti: 0 };
  const evidence: Record<PersonaEvidence, number> = { assumed: 0, some: 0, researched: 0 };
  for (const p of personas) {
    if (isTier(p.tier)) tiers[p.tier]++;
    if (isEvidence(p.evidence)) evidence[p.evidence]++;
  }
  return { tiers, evidence };
}

/** Every tag the personas use, each once (ignoring case), sorted. */
export function allTags(personas: readonly Pick<Persona, "tags">[]): string[] {
  const byKey = new Map<string, string>();
  for (const p of personas) for (const t of p.tags ?? []) byKey.set(t.toLowerCase(), t);
  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
}

/** The library's filters; "" means any. */
export interface PersonaFilters {
  tier: PersonaTier | "";
  evidence: PersonaEvidence | "";
  tag: string;
}

export const NO_FILTERS: PersonaFilters = { tier: "", evidence: "", tag: "" };

/** Whether a persona passes the filters. */
export function matchesFilters(p: Persona, f: PersonaFilters): boolean {
  if (f.tier && p.tier !== f.tier) return false;
  if (f.evidence && p.evidence !== f.evidence) return false;
  if (f.tag && !(p.tags ?? []).some((t) => t.toLowerCase() === f.tag.toLowerCase())) return false;
  return true;
}

/** The letter on a persona's badge: the name's first letter, upper case. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase("en") : "?";
}
