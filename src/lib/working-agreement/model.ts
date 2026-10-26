/**
 * The working agreement: the team's rules, each person's consent to them,
 * saved adoption check-ins and the published versions. One document
 * (WORKING_AGREEMENT_ID) that the Working Agreement page, the Team charter
 * and tool.working_agreement.* read and write through these functions, so
 * a person and an agent count consent, adherence and changes the same way.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it).
 *
 *   - Consent is one answer per person per rule (consent, a concern they
 *     can live with, or an objection), matched by name. `agreedBy` stays on
 *     each rule, derived from it (the names voting consent), so the charter
 *     and older readers keep working.
 *   - A check-in is the round the team runs every few sprints: each rule
 *     working or not, dated (backdatable) and kept, so adherence has a
 *     history. The round in progress is the rules' `stillWorking` draft.
 *   - Publish keeps a snapshot of the rules as a numbered version, so any
 *     two versions (or a version and the draft) can be compared.
 */

import type {
  CharterCheckIn,
  CharterCheckInResult,
  CharterConsent,
  CharterConsentVote,
  CharterMeta,
  CharterRule,
  CharterRuleCategory,
  CharterVersion,
  CharterVersionRule,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { WORKING_AGREEMENT_ID } from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { enoughData } from "@/lib/analytics/min-sample";

/** The agreement's one document id. */
export const WA_ID = WORKING_AGREEMENT_ID;

/** The kind it syncs under (registerCollection("workingAgreement", …)). */
export const WA_KIND = "workspace:workingAgreement";

/** Saved check-ins kept (the oldest go first): a year of fortnightly rounds. */
export const CHECK_IN_CAP = 52;
/** Published versions kept (the oldest go first). */
export const VERSION_CAP = 20;

export const RULE_TEXT_MAX = 1000;
export const RULE_DESCRIPTION_MAX = 2000;
export const CONSENT_NOTE_MAX = 500;
export const CHECK_IN_NOTE_MAX = 1000;

/** Saved rounds before the adherence chart shows: one round has no direction. */
export const TREND_MIN_ROUNDS = 2;

export const CHARTER_CATEGORIES: readonly CharterRuleCategory[] = [
  "communication",
  "meetings",
  "decisions",
  "work",
  "conflict",
  "other",
];

export const CONSENT_VOTES: readonly CharterConsentVote[] = ["consent", "concern", "object"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A trimmed, non-empty string, else undefined. */
const text = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};

const isCategory = (v: unknown): v is CharterRuleCategory =>
  typeof v === "string" && (CHARTER_CATEGORIES as readonly string[]).includes(v);

const isVote = (v: unknown): v is CharterConsentVote =>
  typeof v === "string" && (CONSENT_VOTES as readonly string[]).includes(v);

const isResult = (v: unknown): v is CharterCheckInResult => v === "working" || v === "not_working";

/** An agreement with nothing in it yet: version 0, unpublished. */
export function emptyAgreement(): WorkingAgreement {
  return { id: WA_ID, rules: [], meta: { version: 0 } };
}

/* ── Reading a stored document ──────────────────────────────────────── */

function normalizeConsent(raw: unknown): CharterConsent[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CharterConsent[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const name = text(c.name);
    if (!name || !isVote(c.vote) || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    const note = text(c.note);
    out.push({ name, vote: c.vote, at: str(c.at) ?? "", ...(note ? { note } : {}) });
  }
  return out;
}

/** The names voting consent, in answer order: what `agreedBy` holds once consent is recorded. */
export function agreedByOf(consent: readonly CharterConsent[]): string[] {
  return consent.filter((c) => c.vote === "consent").map((c) => c.name);
}

function normalizeRule(raw: unknown): CharterRule | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const ruleText = str(raw.text);
  if (!id || ruleText === undefined) return null;
  // Older rules have only `agreedBy`: each name reads as consent (undated:
  // the answer was given before votes were kept), so nobody who agreed is
  // asked again. A rule with `consent` derives `agreedBy` from it.
  const consent = Array.isArray(raw.consent)
    ? normalizeConsent(raw.consent)
    : normalizeConsent(
        (Array.isArray(raw.agreedBy) ? raw.agreedBy : []).map((name) => ({
          name,
          vote: "consent",
          at: "",
        }))
      );
  const description = text(raw.description);
  const rule: CharterRule = {
    ...(raw as Partial<CharterRule>),
    id,
    category: isCategory(raw.category) ? raw.category : "other",
    text: ruleText,
    agreedBy: agreedByOf(consent),
    consent,
  };
  if (description) rule.description = description;
  else delete rule.description;
  if (typeof raw.stillWorking === "boolean") rule.stillWorking = raw.stillWorking;
  else delete rule.stillWorking;
  return rule;
}

function normalizeMeta(raw: unknown): CharterMeta {
  const r = isRecord(raw) ? raw : {};
  const version =
    typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 0 ? r.version : 0;
  const meta: CharterMeta = { version };
  const teamName = text(r.teamName);
  const description = text(r.description);
  const publishedAt = text(r.publishedAt);
  if (teamName) meta.teamName = teamName;
  if (description) meta.description = description;
  if (publishedAt) meta.publishedAt = publishedAt;
  return meta;
}

function normalizeCheckIn(raw: unknown): CharterCheckIn | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const date = str(raw.date)?.slice(0, 10);
  if (!id || !date || !ISO_DAY.test(date)) return null;
  const results: Record<string, CharterCheckInResult> = {};
  if (isRecord(raw.results)) {
    for (const [ruleId, v] of Object.entries(raw.results)) if (isResult(v)) results[ruleId] = v;
  }
  const ruleTexts: Record<string, string> = {};
  if (isRecord(raw.ruleTexts)) {
    for (const [ruleId, v] of Object.entries(raw.ruleTexts)) {
      if (typeof v === "string") ruleTexts[ruleId] = v;
    }
  }
  const version =
    typeof raw.version === "number" && Number.isInteger(raw.version) && raw.version >= 0
      ? raw.version
      : 0;
  const sprintId = text(raw.sprintId);
  const note = text(raw.note);
  return {
    id,
    date,
    version,
    results,
    ...(Object.keys(ruleTexts).length > 0 ? { ruleTexts } : {}),
    ...(sprintId ? { sprintId } : {}),
    ...(note ? { note } : {}),
  };
}

function normalizeVersionRule(raw: unknown): CharterVersionRule | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const ruleText = str(raw.text);
  if (!id || ruleText === undefined) return null;
  const description = text(raw.description);
  return {
    id,
    category: isCategory(raw.category) ? raw.category : "other",
    text: ruleText,
    ...(description ? { description } : {}),
  };
}

function normalizeVersion(raw: unknown): CharterVersion | null {
  if (!isRecord(raw)) return null;
  const version = raw.version;
  const publishedAt = text(raw.publishedAt);
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || !publishedAt) {
    return null;
  }
  const teamName = text(raw.teamName);
  const description = text(raw.description);
  return {
    version,
    publishedAt,
    ...(teamName ? { teamName } : {}),
    ...(description ? { description } : {}),
    rules: (Array.isArray(raw.rules) ? raw.rules : [])
      .map(normalizeVersionRule)
      .filter((r): r is CharterVersionRule => r !== null),
  };
}

/** By day, then in the order saved: a backdated round sits where it happened. */
const byDate = (a: CharterCheckIn, b: CharterCheckIn) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * A stored agreement in a usable shape, whatever it was written as: the
 * page's, an agent's through the CRUD, or one from before consent, rounds
 * and versions. Missing pieces read as empty; nothing is invented.
 */
export function normalizeAgreement(raw: unknown): WorkingAgreement {
  if (!isRecord(raw)) return emptyAgreement();
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .map(normalizeRule)
    .filter((r): r is CharterRule => r !== null);
  const checkIns = (Array.isArray(raw.checkIns) ? raw.checkIns : [])
    .map(normalizeCheckIn)
    .filter((c): c is CharterCheckIn => c !== null)
    .sort(byDate);
  const versions = (Array.isArray(raw.versions) ? raw.versions : [])
    .map(normalizeVersion)
    .filter((v): v is CharterVersion => v !== null)
    .sort((a, b) => a.version - b.version);
  const meta = normalizeMeta(raw.meta);
  // The old agent created agreements at version 1 with nothing published;
  // the page always stamped publishedAt when it published. Read such a
  // document as never published, so the first Publish makes it v1.
  if (meta.version > 0 && !meta.publishedAt && versions.length === 0) meta.version = 0;
  return {
    ...(raw as Partial<WorkingAgreement>),
    id: WA_ID,
    rules,
    meta,
    checkIns,
    versions,
  };
}

/* ── Consent ────────────────────────────────────────────────────────── */

/**
 * `rule` with `name`'s answer set (or cleared, with a null vote). One
 * answer per person, matched by name key: answering again replaces the
 * answer in place. `agreedBy` follows. A note is kept only with a concern
 * or an objection, where it says what would change the person's mind.
 */
export function withConsent(
  rule: CharterRule,
  name: string,
  vote: CharterConsentVote | null,
  at: string,
  note?: string
): CharterRule {
  const who = name.trim();
  if (!who) return rule;
  const current = normalizeConsent(rule.consent ?? []);
  const key = nameKey(who);
  const index = current.findIndex((c) => nameKey(c.name) === key);
  const cleanNote = vote && vote !== "consent" ? text(note)?.slice(0, CONSENT_NOTE_MAX) : undefined;
  let consent: CharterConsent[];
  if (vote === null) {
    if (index < 0) return rule;
    consent = current.filter((_, i) => i !== index);
  } else {
    const entry: CharterConsent = {
      name: who,
      vote,
      at,
      ...(cleanNote ? { note: cleanNote } : {}),
    };
    consent = index < 0 ? [...current, entry] : current.map((c, i) => (i === index ? entry : c));
  }
  return { ...rule, consent, agreedBy: agreedByOf(consent) };
}

/** The rule's answers: its consent, or for an older rule its `agreedBy` names as consent. */
export function consentEntries(rule: Pick<CharterRule, "consent" | "agreedBy">): CharterConsent[] {
  if (Array.isArray(rule.consent)) return normalizeConsent(rule.consent);
  return normalizeConsent((rule.agreedBy ?? []).map((name) => ({ name, vote: "consent", at: "" })));
}

export interface RuleConsent {
  /** Names (roster spelling where they're on the team) per answer. */
  consented: string[];
  concerns: string[];
  objections: string[];
  /** Roster members who haven't answered. */
  missing: string[];
  /** Answers given, roster or not. */
  answered: number;
  /** Who the rule needs an answer from: the roster plus anyone else who answered. */
  of: number;
  /** Everyone on the roster answered and nobody objects (a concern still consents). */
  full: boolean;
}

/**
 * Where one rule stands with the team. With a roster, consent is full when
 * every member has answered and nobody objects: a concern is consent with
 * a reservation, an objection blocks. Without a roster there is nobody to
 * be missing, so it is full once someone answered and nobody objects.
 */
export function consentOf(
  rule: Pick<CharterRule, "consent" | "agreedBy">,
  roster: readonly { name: string }[]
): RuleConsent {
  const entries = consentEntries(rule);
  const spell = (name: string) => findRosterMember(roster, name)?.name ?? name;
  const answeredKeys = new Set(entries.map((e) => nameKey(e.name)));
  const missing = roster.filter((m) => !answeredKeys.has(nameKey(m.name))).map((m) => m.name);
  const offRoster = entries.filter((e) => !findRosterMember(roster, e.name)).length;
  const objections = entries.filter((e) => e.vote === "object").map((e) => spell(e.name));
  return {
    consented: entries.filter((e) => e.vote === "consent").map((e) => spell(e.name)),
    concerns: entries.filter((e) => e.vote === "concern").map((e) => spell(e.name)),
    objections,
    missing,
    answered: entries.length,
    of: roster.length + offRoster,
    full: objections.length === 0 && missing.length === 0 && entries.length > 0,
  };
}

export interface AgreementConsent {
  rules: number;
  /** Rules with everyone's consent (consentOf().full). */
  fullyConsented: number;
  /** Rules someone objects to. */
  withObjection: number;
  /** Roster members who haven't answered at least one rule, in roster order. */
  missingPeople: string[];
  /** Each rule someone objects to, and who. */
  objections: { ruleId: string; text: string; names: string[] }[];
}

/** The whole charter's consent, as the verdict, the KPIs and list_state read it. */
export function agreementConsent(
  doc: Pick<WorkingAgreement, "rules">,
  roster: readonly { name: string }[]
): AgreementConsent {
  let fullyConsented = 0;
  const missing = new Set<string>();
  const objections: AgreementConsent["objections"] = [];
  for (const rule of doc.rules) {
    const c = consentOf(rule, roster);
    if (c.full) fullyConsented += 1;
    for (const name of c.missing) missing.add(nameKey(name));
    if (c.objections.length > 0) {
      objections.push({ ruleId: rule.id, text: rule.text, names: c.objections });
    }
  }
  return {
    rules: doc.rules.length,
    fullyConsented,
    withObjection: objections.length,
    missingPeople: roster.filter((m) => missing.has(nameKey(m.name))).map((m) => m.name),
    objections,
  };
}

/** "5 of 6 consented · Sam objects": one rule's consent in a line. */
export function consentLine(c: RuleConsent): string {
  if (c.answered === 0) return c.of > 0 ? `No answers yet (${c.of} to ask)` : "No answers yet";
  const agreed = c.consented.length + c.concerns.length;
  const parts = [c.of > 0 ? `${agreed} of ${c.of} consented` : `${agreed} consented`];
  if (c.concerns.length > 0) {
    parts.push(
      `${listAnd(c.concerns)} ${c.concerns.length === 1 ? "has a concern" : "have concerns"}`
    );
  }
  if (c.objections.length > 0) {
    parts.push(`${listAnd(c.objections)} ${c.objections.length === 1 ? "objects" : "object"}`);
  }
  return parts.join(" · ");
}

/* ── Check-ins ──────────────────────────────────────────────────────── */

/** Rules checked in the round in progress (their `stillWorking` draft). */
export function draftCount(doc: Pick<WorkingAgreement, "rules">): number {
  return doc.rules.filter((r) => typeof r.stillWorking === "boolean").length;
}

/**
 * The round in progress as a saved check-in: each rule the team marked,
 * with its text as it reads today. Null when nothing is marked: an empty
 * round would read as 0% adherence.
 */
export function draftCheckIn(
  doc: Pick<WorkingAgreement, "rules" | "meta">,
  { id, date, sprintId, note }: { id: string; date: string; sprintId?: string; note?: string }
): CharterCheckIn | null {
  const results: Record<string, CharterCheckInResult> = {};
  const ruleTexts: Record<string, string> = {};
  for (const r of doc.rules) {
    if (typeof r.stillWorking !== "boolean") continue;
    results[r.id] = r.stillWorking ? "working" : "not_working";
    ruleTexts[r.id] = r.text;
  }
  if (Object.keys(results).length === 0) return null;
  const cleanNote = text(note)?.slice(0, CHECK_IN_NOTE_MAX);
  return {
    id,
    date: date.slice(0, 10),
    version: doc.meta.version,
    results,
    ruleTexts,
    ...(sprintId ? { sprintId } : {}),
    ...(cleanNote ? { note: cleanNote } : {}),
  };
}

/**
 * `doc` with `checkIn` saved, or replaced when one has its id (in date
 * order, the latest CHECK_IN_CAP kept), and the marks it saved cleared from
 * the draft. `clearDraft: false` leaves the marks (an Undo putting a
 * deleted round back, an edited day).
 */
export function withCheckIn(
  doc: WorkingAgreement,
  checkIn: CharterCheckIn,
  { clearDraft = true }: { clearDraft?: boolean } = {}
): WorkingAgreement {
  const checkIns = [...(doc.checkIns ?? []).filter((c) => c.id !== checkIn.id), checkIn]
    .sort(byDate)
    .slice(-CHECK_IN_CAP);
  if (!clearDraft) return { ...doc, checkIns };
  return {
    ...doc,
    checkIns,
    rules: doc.rules.map((r) => {
      if (!(r.id in checkIn.results)) return r;
      const { stillWorking, ...rest } = r;
      void stillWorking;
      return rest;
    }),
  };
}

/** `doc` with every rule's draft mark cleared. */
export function withoutDraft(doc: WorkingAgreement): WorkingAgreement {
  return {
    ...doc,
    rules: doc.rules.map((r) => {
      if (typeof r.stillWorking !== "boolean") return r;
      const { stillWorking, ...rest } = r;
      void stillWorking;
      return rest;
    }),
  };
}

export interface CheckInAdherence {
  checked: number;
  working: number;
  /** Working as a whole percentage of the rules checked; null when none were. */
  pct: number | null;
}

/** How one round went. */
export function checkInAdherence(c: Pick<CharterCheckIn, "results">): CheckInAdherence {
  const values = Object.values(c.results ?? {});
  const checked = values.length;
  const working = values.filter((v) => v === "working").length;
  return { checked, working, pct: checked > 0 ? Math.round((working / checked) * 100) : null };
}

export interface CheckInTrendRow extends CheckInAdherence {
  id: string;
  date: string;
  version: number;
  sprintId?: string;
}

/** Every saved round's adherence, oldest first: the trend's points. */
export function checkInTrend(doc: Pick<WorkingAgreement, "checkIns">): CheckInTrendRow[] {
  return [...(doc.checkIns ?? [])].sort(byDate).map((c) => ({
    id: c.id,
    date: c.date,
    version: c.version,
    ...(c.sprintId ? { sprintId: c.sprintId } : {}),
    ...checkInAdherence(c),
  }));
}

/** The latest saved round, or undefined. */
export function lastCheckIn(doc: Pick<WorkingAgreement, "checkIns">): CharterCheckIn | undefined {
  const sorted = [...(doc.checkIns ?? [])].sort(byDate);
  return sorted[sorted.length - 1];
}

/**
 * How many of the latest rounds in a row found the rule not working
 * (rounds that skipped it don't break the run). Two in a row is worth a
 * retro topic.
 */
export function notWorkingStreak(doc: Pick<WorkingAgreement, "checkIns">, ruleId: string): number {
  const sorted = [...(doc.checkIns ?? [])].sort(byDate);
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const result = sorted[i].results[ruleId];
    if (result === undefined) continue;
    if (result === "working") break;
    streak += 1;
  }
  return streak;
}

/* ── Versions ───────────────────────────────────────────────────────── */

const versionRule = (r: CharterRule): CharterVersionRule => ({
  id: r.id,
  category: r.category,
  text: r.text,
  ...(r.description ? { description: r.description } : {}),
});

/** The latest published version kept, or undefined. */
export function latestVersion(doc: Pick<WorkingAgreement, "versions">): CharterVersion | undefined {
  const versions = doc.versions ?? [];
  return versions[versions.length - 1];
}

/** The draft as the next version would publish it. */
export function snapshotOf(
  doc: Pick<WorkingAgreement, "rules" | "meta">,
  publishedAt: string
): CharterVersion {
  return {
    version: doc.meta.version + 1,
    publishedAt,
    ...(doc.meta.teamName ? { teamName: doc.meta.teamName } : {}),
    ...(doc.meta.description ? { description: doc.meta.description } : {}),
    rules: doc.rules.map(versionRule),
  };
}

export interface VersionDiff {
  added: CharterVersionRule[];
  removed: CharterVersionRule[];
  reworded: { before: CharterVersionRule; after: CharterVersionRule }[];
  recategorised: { before: CharterVersionRule; after: CharterVersionRule }[];
  /** Same text and category, a different description. */
  redescribed: { before: CharterVersionRule; after: CharterVersionRule }[];
}

/** Whether a diff found anything. */
export const diffIsEmpty = (d: VersionDiff): boolean =>
  d.added.length +
    d.removed.length +
    d.reworded.length +
    d.recategorised.length +
    d.redescribed.length ===
  0;

/**
 * What changed between two lists of rules, matched by rule id: `before`
 * is a version's rules (undefined: nothing was published), `after` another
 * version's or the draft's. A rule both reworded and moved counts in both.
 */
export function diffVersions(
  before: readonly CharterVersionRule[] | undefined,
  after: readonly CharterVersionRule[]
): VersionDiff {
  const was = new Map((before ?? []).map((r) => [r.id, r]));
  const now = new Map(after.map((r) => [r.id, r]));
  const diff: VersionDiff = {
    added: [],
    removed: [],
    reworded: [],
    recategorised: [],
    redescribed: [],
  };
  for (const r of after) {
    const old = was.get(r.id);
    if (!old) {
      diff.added.push(r);
      continue;
    }
    const reworded = old.text.trim() !== r.text.trim();
    if (reworded) diff.reworded.push({ before: old, after: r });
    if (old.category !== r.category) diff.recategorised.push({ before: old, after: r });
    if (!reworded && (old.description ?? "").trim() !== (r.description ?? "").trim()) {
      diff.redescribed.push({ before: old, after: r });
    }
  }
  for (const r of before ?? []) if (!now.has(r.id)) diff.removed.push(r);
  return diff;
}

/** The draft's rules as a version's. */
export const draftRules = (doc: Pick<WorkingAgreement, "rules">): CharterVersionRule[] =>
  doc.rules.map(versionRule);

/**
 * Published before versions were kept: the charter is at v3, but there is
 * no snapshot of v3, so whether the draft changed since can't be told.
 * Publishing once keeps one; until then nothing claims there are changes.
 */
export function needsSnapshot(doc: Pick<WorkingAgreement, "rules" | "meta" | "versions">): boolean {
  return doc.meta.version > 0 && !latestVersion(doc) && doc.rules.length > 0;
}

/**
 * Whether the draft has changes not yet published: it differs from the
 * latest version (its rules, team name or description), or it was never
 * published and has rules. False when it was published before versions
 * were kept (needsSnapshot): there is nothing to compare it with.
 */
export function hasUnpublishedChanges(doc: WorkingAgreement): boolean {
  const latest = latestVersion(doc);
  if (!latest) return doc.meta.version === 0 && doc.rules.length > 0;
  if ((latest.teamName ?? "") !== (doc.meta.teamName ?? "")) return true;
  if ((latest.description ?? "") !== (doc.meta.description ?? "")) return true;
  const diff = diffVersions(latest.rules, draftRules(doc));
  if (!diffIsEmpty(diff)) return true;
  // Same rules, another order.
  return latest.rules.map((r) => r.id).join("\u0000") !== doc.rules.map((r) => r.id).join("\u0000");
}

/** Whether Publish has something to do: changes to publish, or a first snapshot to keep. */
export const canPublish = (doc: WorkingAgreement): boolean =>
  hasUnpublishedChanges(doc) || needsSnapshot(doc);

/** `doc` published at `publishedAt`: the snapshot kept (the latest VERSION_CAP), the version bumped. */
export function published(doc: WorkingAgreement, publishedAt: string): WorkingAgreement {
  const snapshot = snapshotOf(doc, publishedAt);
  return {
    ...doc,
    meta: { ...doc.meta, version: snapshot.version, publishedAt },
    versions: [...(doc.versions ?? []), snapshot].slice(-VERSION_CAP),
  };
}

/* ── Words ──────────────────────────────────────────────────────────── */

/** "a, b and c". */
export function listAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "12 Sep" (or with the year), from a day or a timestamp; "" when it isn't one. */
export function dayLabel(value: string | undefined | null, withYear = false): string {
  if (!value) return "";
  let d: Date;
  if (ISO_DAY.test(value)) {
    const [y, m, day] = value.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

const rulesWord = (n: number) => `${n} ${n === 1 ? "rule" : "rules"}`;

/** “text”, cut to a readable length for a sentence. */
function quoted(t: string, max = 60): string {
  const s = t.trim().replace(/\s+/g, " ");
  return `“${s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s}”`;
}

/**
 * The one-sentence answer above the charter: how many rules in which
 * version, how much of the team consents (and who objects to what), and
 * what the last check-in found.
 *
 *   "6 rules in v3 (published 12 Sep); 5 have everyone's consent, Sam
 *    objects to “Cameras on”; the last check-in found 4 of 6 working."
 */
export function agreementVerdict(
  doc: WorkingAgreement,
  roster: readonly { name: string }[]
): string {
  if (doc.rules.length === 0) return "No rules agreed yet.";
  const { meta } = doc;
  const isPublished = meta.version > 0 && Boolean(meta.publishedAt);
  const head = isPublished
    ? `${rulesWord(doc.rules.length)} in v${meta.version} (published ${dayLabel(meta.publishedAt)}${
        needsSnapshot(doc) ? ", before versions were kept: publish once to keep a snapshot" : ""
      })${hasUnpublishedChanges(doc) ? ", with changes not yet published" : ""}`
    : `${rulesWord(doc.rules.length)}, not published yet`;
  const c = agreementConsent(doc, roster);
  const answered = doc.rules.some((r) => consentEntries(r).length > 0);
  let consent: string;
  if (!answered) {
    consent = "nobody has given consent yet";
  } else {
    consent =
      c.fullyConsented === doc.rules.length
        ? doc.rules.length === 1
          ? "it has everyone's consent"
          : "all have everyone's consent"
        : `${c.fullyConsented} ${c.fullyConsented === 1 ? "has" : "have"} everyone's consent`;
    const first = c.objections[0];
    if (first) {
      const more = c.objections.length - 1;
      consent += `, ${listAnd(first.names)} ${first.names.length === 1 ? "objects" : "object"} to ${quoted(first.text)}${
        more > 0 ? ` (and ${more} more ${more === 1 ? "rule has" : "rules have"} an objection)` : ""
      }`;
    }
  }
  const last = lastCheckIn(doc);
  let round = "";
  if (last) {
    const a = checkInAdherence(last);
    round = `; the last check-in (${dayLabel(last.date)}) found ${a.working} of ${a.checked} working`;
  } else if (isPublished) {
    round = "; no check-in yet";
  }
  return `${head}; ${consent}${round}.`;
}

/**
 * A plain sentence on how adherence moved across the saved rounds, for
 * the chart's summary: "Adherence rose from 50% to 83% over 4 check-ins
 * (3 Sep to 1 Oct)." Null below TREND_MIN_ROUNDS.
 */
export function trendSentence(rows: readonly CheckInTrendRow[]): string | null {
  const rated = rows.filter((r) => r.pct !== null);
  if (rated.length < TREND_MIN_ROUNDS) return null;
  const first = rated[0];
  const last = rated[rated.length - 1];
  const a = first.pct as number;
  const b = last.pct as number;
  const moved = a === b ? `stayed at ${b}%` : `${b > a ? "rose" : "fell"} from ${a}% to ${b}%`;
  return `Adherence ${moved} over ${rated.length} check-ins (${dayLabel(first.date)} to ${dayLabel(
    last.date
  )}).`;
}

/** The latest round's adherence is quotable as a percentage only from MIN_SAMPLE.average rules. */
export const quotablePct = (a: CheckInAdherence): boolean =>
  a.pct !== null && enoughData(a.checked, "average");
