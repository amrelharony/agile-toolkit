/**
 * Release Readiness — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     Each release checked against the team's gates (the built-ins
 *           until the team changes the list; "Feature flag ready" checked
 *           from the Feature Flag Tracker, "Definition of Done met" from the
 *           DoD Builder), shipped on a day with its gates frozen, rolled
 *           back on a day, reopened with its earlier ship kept.
 *
 * Agent surface: tool.release_readiness.*
 * Backing CRUD : workspace.release_readiness.* (auto-generated). Singleton: one
 *                ReleaseReadiness document (releases[], gates[]) under a fixed id.
 *
 *   1. list_state     — releases with each gate's result, the team's gates and
 *                       the page's stats (on time, rolled back, skipped gates).
 *   2. add_release    — add a release in planning (name and planned date required).
 *   3. update_release — rename, re-plan or re-describe a release.
 *   4. toggle_gate    — tick or clear one gate on a release being planned.
 *   5. ship_release   — ship on a day (today unless given), freezing the gates.
 *   6. set_status     — roll a shipped release back (on a day), or reopen a
 *                       rolled-back one.
 *   7. set_gates      — replace the team's gate list (left-out gates are archived).
 *   8. remove_release — delete a release by id.
 *
 * Every number comes from lib/releases (gates, model, auto-gates), the same
 * functions the page uses, so an agent reports what the page shows. Entity
 * kind "workspace:releaseReadiness" + RELEASE_DOC_ID match the page, so
 * writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverGetEntity,
  serverGetUserStateBlob,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import type {
  DefinitionOfDone,
  FeatureFlag,
  Release,
  ReleaseGateDef,
  ReleaseReadiness,
  Story,
} from "@/lib/stores/workspace-types";
import { DOD_DOC_ID, DOD_KIND, DOD_LEGACY_KEY } from "@/lib/dod/model";
import { RELEASE_DOC_ID, gatesOf, teamGates } from "@/lib/releases/gates";
import { releaseStats } from "@/lib/releases/model";
import {
  describedGate,
  gateLabels,
  gateResults,
  newGateId,
  releaseChecks,
  reopenRelease,
  rollBackRelease,
  rollbackDateError,
  shipDateError,
  shipRelease,
  storedGates,
  withRelease,
  withShipPlans,
  withTeamGates,
  type GateChecks,
  type PlannedShip,
} from "@/lib/releases/auto-gates";
import { normalizeFlags } from "@/lib/flags/model";
import { enoughData, MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { isIsoDate } from "@/lib/sprints/calendar";
import { todayIso } from "@/lib/sprints/series";

const KIND_RR = "workspace:releaseReadiness";
/** MUST match registerCollection("featureFlag", …) in workspace-store.ts. */
const KIND_FLAG = "workspace:featureFlag";
/** MUST match registerCollection("story", …) in workspace-store.ts. */
const KIND_STORY = "workspace:story";

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

const ws = () => useWorkspaceStore.getState();

/** Where the document and what its auto gates read live: the browser, or the user's rows on the server. */
interface ReleaseStore {
  getDoc(): Promise<ReleaseReadiness | null>;
  putDoc(doc: ReleaseReadiness): Promise<void>;
  /** The Feature Flag Tracker's flags. */
  flags(): Promise<FeatureFlag[]>;
  /**
   * The Definition of Done: the workspace document, else the DoD builder's
   * old blob until it has moved in (any shape; lib/dod/model reads both).
   */
  dod(): Promise<unknown>;
  /** The stories, so the DoD gate checks the ones a release links. */
  stories(): Promise<Story[]>;
}

/** The DoD builder's old blob as the page's usePersisted hydrates it, or null. */
function browserBlob(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const browserStore: ReleaseStore = {
  getDoc: async () => (ws().releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID) ?? null,
  putDoc: async (doc) => ws().upsertReleaseReadiness(doc),
  flags: async () => normalizeFlags(ws().featureFlags ?? []),
  dod: async () =>
    (ws().definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID) ?? browserBlob(DOD_LEGACY_KEY),
  stories: async () => ws().stories ?? [],
};

function serverStore(userId: string): ReleaseStore {
  return {
    getDoc: async () =>
      (await serverGetEntity<ReleaseReadiness>(userId, KIND_RR, RELEASE_DOC_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<ReleaseReadiness>(userId, KIND_RR, doc);
    },
    flags: async () => normalizeFlags(await serverListEntities<FeatureFlag>(userId, KIND_FLAG)),
    dod: async () =>
      (await serverGetEntity<DefinitionOfDone>(userId, DOD_KIND, DOD_DOC_ID)) ??
      serverGetUserStateBlob(userId, DOD_LEGACY_KEY),
    stories: async () => serverListEntities<Story>(userId, KIND_STORY),
  };
}

const emptyDoc = (): ReleaseReadiness => ({ id: RELEASE_DOC_ID, releases: [] });

/** Each release's auto-gate checks, from the store's flags, DoD and stories. */
async function checker(store: ReleaseStore, today: string): Promise<(r: Release) => GateChecks> {
  const [flags, dod, stories] = await Promise.all([store.flags(), store.dod(), store.stories()]);
  return (r) => releaseChecks(r, flags, dod, today, stories);
}

/* ── list_state ─────────────────────────────────────────────────────── */

const gateDefRow = (def: ReleaseGateDef) => {
  const g = describedGate(def);
  return {
    id: g.id,
    label: g.label,
    ...(g.description ? { description: g.description } : {}),
    ...(g.auto ? { auto: g.auto } : {}),
  };
};

async function listState(store: ReleaseStore) {
  const doc = await store.getDoc();
  const today = todayIso();
  const checksOf = await checker(store, today);
  const releases = doc?.releases ?? [];
  const byStatus = { planning: 0, shipped: 0, rolled_back: 0 };
  for (const r of releases) byStatus[r.status]++;
  const labels = gateLabels(doc ?? undefined);
  // Each ship judged against the plan it went out against, as the page does.
  const stats = releaseStats(withShipPlans(doc ?? undefined));
  return {
    exists: doc !== null,
    total: releases.length,
    byStatus,
    today,
    gates: teamGates(doc ?? undefined).map(gateDefRow),
    archivedGates: storedGates(doc ?? undefined)
      .filter((g) => g.archived)
      .map(gateDefRow),
    releases: releases.map((r) => {
      const results = gateResults(r, doc ?? undefined, checksOf(r));
      const passed = results.filter((g) => g.passed).length;
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        plannedDate: r.plannedDate,
        shippedDate: r.shippedDate,
        rolledBackAt: r.rolledBackAt,
        description: r.description,
        gatesPassed: passed,
        gatesTotal: results.length,
        allGatesPassed: passed === results.length,
        gatesOpenAtShip: r.gatesOpenAtShip,
        openGates: results.filter((g) => !g.passed).map((g) => g.label),
        gates: results.map((g) => ({
          id: g.id,
          label: g.label,
          passed: g.passed,
          locked: g.locked,
          ...(g.auto ? { auto: g.auto } : {}),
          ...(g.check ? { check: { passed: g.check.passed, detail: g.check.detail } } : {}),
        })),
        previousShips: (r.previousShips ?? []).map((s: PlannedShip) => ({
          shippedDate: s.shippedDate,
          plannedDate: s.plannedDate ?? r.plannedDate,
          rolledBackAt: s.rolledBackAt,
          gatesOpenAtShip: s.gatesOpenAtShip,
        })),
      };
    }),
    stats: {
      ...stats,
      skippedByGate: stats.skippedByGate.map((g) => ({
        ...g,
        label: labels.get(g.gateId) ?? g.gateId,
      })),
      /** The page quotes % on time and the average only from this many ships. */
      minShipsForRates: MIN_SAMPLE.average,
      ratesQuotable: enoughData(stats.shipped, "average"),
    },
  };
}

registry.register({
  id: "tool.release_readiness.list_state",
  toolId: "tool.release_readiness",
  name: "list_state",
  category: "read",
  description:
    "Summarise release readiness, with the same numbers as the page. Returns {exists, total, byStatus:{planning,shipped,rolled_back}, today, gates:{id,label,description?,auto?}[] (the team's list in order; auto 'flags' is checked from the Feature Flag Tracker, 'dod' from the DoD Builder: every done story the release links (storyIds) meets the Definition of Done, or with no linked stories the DoD's team-level ticks), archivedGates, releases:{id,name,status,plannedDate,shippedDate,rolledBackAt,description,gatesPassed,gatesTotal,allGatesPassed,gatesOpenAtShip,openGates:string[],gates:{id,label,passed,locked,auto?,check?:{passed:boolean|null,detail}}[],previousShips:{shippedDate,plannedDate (the plan it went out against),rolledBackAt,gatesOpenAtShip}[]}[], stats:{shipped (every ship, rolled-back and earlier ships of reopened releases included),onTime (each ship against the plan it went out against),pct (null with no ships),rolledBack,avgGatesOpen,skippedByGate:{gateId,label,skipped,of}[],minShipsForRates,ratesQuotable}}. A planning release reads the team's gates (an auto gate whose check can tell is decided by it: locked); a shipped one reads the gates frozen when it shipped.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── add_release / update_release ───────────────────────────────────── */

const IsoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine(isIsoDate, "Not a real date");

const addParams = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  plannedDate: IsoDay.describe("The day it is planned to ship (YYYY-MM-DD); may be in the past."),
  description: z.string().max(DESCRIPTION_MAX).optional(),
});

type AddParams = z.infer<typeof addParams>;

/** Refusal reason for a bad name or planned date (the handler may be called without the schema). */
function addError(params: AddParams): string | null {
  if (typeof params.name !== "string" || !params.name.trim()) return "A release needs a name.";
  if (params.name.trim().length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters.`;
  if (typeof params.plannedDate !== "string" || !isIsoDate(params.plannedDate))
    return "plannedDate is required, as YYYY-MM-DD.";
  return null;
}

async function addRelease(store: ReleaseStore, params: AddParams) {
  const error = addError(params);
  if (error) return { added: false as const, reason: error };
  const base = (await store.getDoc()) ?? emptyDoc();
  const description = params.description?.trim();
  const release: Release = {
    id: crypto.randomUUID(),
    name: params.name.trim(),
    plannedDate: params.plannedDate,
    status: "planning",
    gates: {},
    ...(description ? { description } : {}),
  };
  await store.putDoc({ ...base, id: RELEASE_DOC_ID, releases: [release, ...base.releases] });
  return { added: true as const, id: release.id };
}

registry.register({
  id: "tool.release_readiness.add_release",
  toolId: "tool.release_readiness",
  name: "add_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a release in 'planning' with every gate open. Params: name (required), plannedDate (required, YYYY-MM-DD; may be in the past), description?. Returns {added: true, id} or {added: false, reason}.",
  paramsSchema: addParams,
  handler: async (params) => addRelease(browserStore, params),
  mcpHandler: async (params, ctx) => addRelease(serverStore(ctx.userId), params),
});

const updateParams = z.object({
  releaseId: z.string(),
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  plannedDate: IsoDay.optional(),
  description: z
    .string()
    .max(DESCRIPTION_MAX)
    .optional()
    .describe("Replaces the description; an empty string clears it."),
});

async function updateRelease(store: ReleaseStore, params: z.infer<typeof updateParams>) {
  const doc = await store.getDoc();
  const r = doc?.releases.find((x) => x.id === params.releaseId);
  if (!doc || !r) return { updated: false as const, reason: "No release with that id." };
  if (params.plannedDate !== undefined && !isIsoDate(params.plannedDate))
    return { updated: false as const, reason: "plannedDate must be YYYY-MM-DD." };
  if (params.name !== undefined && !params.name.trim())
    return { updated: false as const, reason: "A release needs a name." };
  const next: Release = { ...r };
  if (params.name !== undefined) next.name = params.name.trim();
  if (params.plannedDate !== undefined) next.plannedDate = params.plannedDate;
  if (params.description !== undefined) {
    const d = params.description.trim();
    if (d) next.description = d;
    else delete next.description;
  }
  await store.putDoc(withRelease(doc, next));
  return { updated: true as const };
}

registry.register({
  id: "tool.release_readiness.update_release",
  toolId: "tool.release_readiness",
  name: "update_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit a release in place, whatever its status. Params: releaseId, name?, plannedDate? (YYYY-MM-DD), description? ('' clears). The id stays, so a premortem linked to it still finds it. Returns {updated: true} or {updated: false, reason}.",
  paramsSchema: updateParams,
  handler: async (params) => updateRelease(browserStore, params),
  mcpHandler: async (params, ctx) => updateRelease(serverStore(ctx.userId), params),
});

/* ── toggle_gate ────────────────────────────────────────────────────── */

const toggleParams = z.object({
  releaseId: z.string(),
  gate: z.string().describe("A gate id from list_state's gates (or the release's gates)."),
  passed: z.boolean(),
});

async function toggleGate(store: ReleaseStore, params: z.infer<typeof toggleParams>) {
  const doc = await store.getDoc();
  const r = doc?.releases.find((x) => x.id === params.releaseId);
  if (!doc || !r) return { updated: false as const, reason: "No release with that id." };
  if (r.status !== "planning")
    return {
      updated: false as const,
      reason: "It went out: its gates are frozen as they shipped.",
    };
  const today = todayIso();
  const checksOf = await checker(store, today);
  const gate = gateResults(r, doc, checksOf(r)).find((g) => g.id === params.gate);
  if (!gate) {
    return {
      updated: false as const,
      reason: `Not one of this release's gates. Use one of: ${gatesOf(r, doc)
        .map((g) => g.id)
        .join(", ")}.`,
    };
  }
  if (gate.locked && gate.check) {
    return {
      updated: false as const,
      reason: `${gate.label} is checked automatically (${gate.check.detail}); fix it at ${gate.check.href}.`,
    };
  }
  await store.putDoc(withRelease(doc, { ...r, gates: { ...r.gates, [gate.id]: params.passed } }));
  return { updated: true as const };
}

registry.register({
  id: "tool.release_readiness.toggle_gate",
  toolId: "tool.release_readiness",
  name: "toggle_gate",
  category: "write",
  requiresConfirmation: false,
  description:
    "Tick (passed: true) or clear one gate on a release in planning. gate is a gate id from list_state (the team's list; the nine built-ins are a11y_audit, perf_baseline, monitoring_dashboards, alerts_tuned, rollback_tested, runbook_linked, sre_review, security_review, feature_flag_ready). Refused for a release that went out (gates frozen) and for an auto gate whose check can tell (Feature flag ready, Definition of Done met: fix the flags or the DoD instead). Returns {updated: true} or {updated: false, reason}.",
  paramsSchema: toggleParams,
  handler: async (params) => toggleGate(browserStore, params),
  mcpHandler: async (params, ctx) => toggleGate(serverStore(ctx.userId), params),
});

/* ── ship_release ───────────────────────────────────────────────────── */

const shipParams = z.object({
  releaseId: z.string(),
  shippedDate: IsoDay.optional().describe(
    "The day it went out (YYYY-MM-DD), not after today; default today."
  ),
});

async function ship(store: ReleaseStore, params: z.infer<typeof shipParams>) {
  const doc = await store.getDoc();
  const r = doc?.releases.find((x) => x.id === params.releaseId);
  if (!doc || !r) return { shipped: false as const, reason: "No release with that id." };
  if (r.status !== "planning") {
    return {
      shipped: false as const,
      reason:
        r.status === "shipped"
          ? "It has shipped already."
          : "It was rolled back: reopen it for planning (set_status planning) before shipping again.",
    };
  }
  const today = todayIso();
  const day = params.shippedDate ?? today;
  const dateError = shipDateError(day, today);
  if (dateError) return { shipped: false as const, reason: dateError };
  const checksOf = await checker(store, today);
  const next = shipRelease(r, doc, checksOf(r), day);
  await store.putDoc(withRelease(doc, next));
  const labels = gateLabels(doc);
  return {
    shipped: true as const,
    shippedDate: day,
    gatesOpenAtShip: next.gatesOpenAtShip ?? 0,
    openGates: (next.gateIds ?? [])
      .filter((id) => !next.gates[id])
      .map((id) => labels.get(id) ?? id),
  };
}

registry.register({
  id: "tool.release_readiness.ship_release",
  toolId: "tool.release_readiness",
  name: "ship_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Ship a release in planning on shippedDate (YYYY-MM-DD, not after today; default today). The gates that apply are frozen on it with their results (auto gates as their checks read now) and the open count is kept. Open gates do NOT block shipping. Refused for a release already shipped or rolled back. Returns {shipped: true, shippedDate, gatesOpenAtShip, openGates: string[]} or {shipped: false, reason}.",
  paramsSchema: shipParams,
  handler: async (params) => ship(browserStore, params),
  mcpHandler: async (params, ctx) => ship(serverStore(ctx.userId), params),
});

/* ── set_status ─────────────────────────────────────────────────────── */

const statusParams = z.object({
  releaseId: z.string(),
  status: z.enum(["planning", "rolled_back"]),
  rolledBackAt: IsoDay.optional().describe(
    "For rolled_back: the day (YYYY-MM-DD), from its ship day to today; default today."
  ),
});

async function setStatus(store: ReleaseStore, params: z.infer<typeof statusParams>) {
  const doc = await store.getDoc();
  const r = doc?.releases.find((x) => x.id === params.releaseId);
  if (!doc || !r) return { updated: false as const, reason: "No release with that id." };
  if (params.status === "rolled_back") {
    if (r.status !== "shipped")
      return { updated: false as const, reason: "Only a shipped release can be rolled back." };
    const today = todayIso();
    const day = params.rolledBackAt ?? today;
    const error = rollbackDateError(day, r.shippedDate, today);
    if (error) return { updated: false as const, reason: error };
    await store.putDoc(withRelease(doc, rollBackRelease(r, day)));
    return { updated: true as const };
  }
  if (r.status === "planning")
    return { updated: false as const, reason: "It is in planning already." };
  // As on the page: a release that went out and stayed out isn't planned again.
  if (r.status === "shipped")
    return {
      updated: false as const,
      reason:
        "Only a rolled-back release reopens for planning: roll it back first (status rolled_back), or add a new release for the next one.",
    };
  await store.putDoc(withRelease(doc, reopenRelease(r, doc)));
  return { updated: true as const };
}

registry.register({
  id: "tool.release_readiness.set_status",
  toolId: "tool.release_readiness",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Roll a shipped release back (status 'rolled_back', rolledBackAt? YYYY-MM-DD from its ship day to today, default today; it still counts as a ship), or reopen a rolled-back release for 'planning' (refused for one that shipped and stayed out, as on the page; its ship is kept on previousShips with the planned date it went out against, so % on time and the skipped gates still count it as it was; manual ticks carry over, auto gates are checked again). Use ship_release to ship. Returns {updated: true} or {updated: false, reason}.",
  paramsSchema: statusParams,
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

/* ── set_gates ──────────────────────────────────────────────────────── */

const gateParam = z.object({
  id: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe("Keep an existing gate's id; omit for a new gate."),
  label: z.string().trim().min(1).max(80),
  description: z.string().max(200).optional(),
  auto: z.enum(["flags", "dod"]).optional(),
  archived: z.boolean().optional(),
});

const gatesParams = z.object({ gates: z.array(gateParam).max(40) });

async function setGates(store: ReleaseStore, params: z.infer<typeof gatesParams>) {
  const doc = (await store.getDoc()) ?? emptyDoc();
  const seen = new Set<string>();
  const labels = new Set<string>();
  const next: ReleaseGateDef[] = [];
  for (const g of params.gates) {
    const label = typeof g.label === "string" ? g.label.trim() : "";
    if (!label) return { updated: false as const, reason: "Every gate needs a label." };
    const key = label.toLowerCase();
    if (!g.archived && labels.has(key))
      return { updated: false as const, reason: `Two gates are called “${label}”.` };
    const id =
      g.id ?? newGateId(label, [...Array.from(seen), ...storedGates(doc).map((x) => x.id)]);
    if (seen.has(id)) return { updated: false as const, reason: `The id ${id} is used twice.` };
    seen.add(id);
    if (!g.archived) labels.add(key);
    const description = g.description?.trim();
    next.push({
      id,
      label,
      ...(description ? { description } : {}),
      ...(g.auto ? { auto: g.auto } : {}),
      ...(g.archived ? { archived: true } : {}),
    });
  }
  const updated = withTeamGates({ ...doc, id: RELEASE_DOC_ID }, next);
  await store.putDoc(updated);
  return {
    updated: true as const,
    gates: teamGates(updated).map(gateDefRow),
    archivedGates: storedGates(updated)
      .filter((g) => g.archived)
      .map(gateDefRow),
  };
}

registry.register({
  id: "tool.release_readiness.set_gates",
  toolId: "tool.release_readiness",
  name: "set_gates",
  category: "write",
  requiresConfirmation: false,
  description:
    "Replace the team's gate list, in order. Params: gates: {id? (keep an existing gate's id; omit for a new one), label, description?, auto? ('flags' checked from the Feature Flag Tracker, 'dod' from the DoD Builder), archived?}[]. A gate left out is kept as archived, so shipped releases still name it. Releases in planning follow the new list; shipped ones keep their frozen gates. Add the Definition of Done gate with {id: 'dod_met', label: 'Definition of Done met', auto: 'dod'}. Returns {updated: true, gates, archivedGates} or {updated: false, reason}.",
  paramsSchema: gatesParams,
  handler: async (params) => setGates(browserStore, params),
  mcpHandler: async (params, ctx) => setGates(serverStore(ctx.userId), params),
});

/* ── remove_release ─────────────────────────────────────────────────── */

async function removeRelease(store: ReleaseStore, releaseId: string) {
  const doc = await store.getDoc();
  if (!doc || !doc.releases.some((r) => r.id === releaseId)) return { removed: false as const };
  await store.putDoc({ ...doc, releases: doc.releases.filter((r) => r.id !== releaseId) });
  return { removed: true as const };
}

registry.register({
  id: "tool.release_readiness.remove_release",
  toolId: "tool.release_readiness",
  name: "remove_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a release by id (its ships leave the stats with it). Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ releaseId: z.string() }),
  handler: async (params) => removeRelease(browserStore, params.releaseId),
  mcpHandler: async (params, ctx) => removeRelease(serverStore(ctx.userId), params.releaseId),
});
