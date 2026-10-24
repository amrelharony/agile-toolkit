/**
 * Feature Flag Tracker — tool-local actions.
 *
 * Category: Flow & Delivery
 * Tool:     The team's feature flags until they leave the code: purpose
 *           (which decides when a flag goes stale: rollouts after 30 days,
 *           experiments after 60, kill switches never, permission flags
 *           only past a removal date), owner, created and planned-removal
 *           days, the release it ships behind, On / Off / Retired.
 *
 * Agent surface: tool.feature_flag_tracker.*
 * Backing CRUD : workspace.feature_flag.* (auto-generated). A collection:
 *                one workspace row per flag.
 *
 *   1. list_state  — every flag with its staleness, and the page's summary.
 *   2. add_flag    — add a live flag (name and purpose required).
 *   3. update_flag — edit a flag in place; null clears an optional field.
 *   4. set_status  — turn a flag on or off (a retired one comes back).
 *   5. retire_flag — retire a flag on a day (today unless given).
 *   6. remove_flag — delete a flag by id.
 *
 * Staleness and the summary come from lib/flags/model, the functions the
 * page uses, so an agent calls the same flags stale on the same day. Entity
 * kind "workspace:featureFlag" matches the page's collection, so writes
 * round-trip into the UI (and into Release Readiness's flag gate).
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  serverDeleteEntity,
  serverGetEntity,
  serverListEntities,
  serverUpsertEntity,
} from "../server-store";
import type { FeatureFlag, ReleaseReadiness } from "@/lib/stores/workspace-types";
import {
  FLAG_DESCRIPTION_MAX,
  FLAG_ENVIRONMENTS,
  FLAG_NAME_MAX,
  FLAG_OWNER_MAX,
  FLAG_PURPOSES,
  compareFlags,
  flagDateErrors,
  flagStaleness,
  flagSummary,
  normalizeFlag,
  normalizeFlags,
  withLiveStatus,
  withRetired,
} from "@/lib/flags/model";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { isIsoDate } from "@/lib/sprints/calendar";
import { todayIso } from "@/lib/sprints/series";

/** MUST match registerCollection("featureFlag", …) in workspace-store.ts. */
const KIND_FLAG = "workspace:featureFlag";
const KIND_RR = "workspace:releaseReadiness";

const ws = () => useWorkspaceStore.getState();

/** Where the flags live: the browser's workspace, or the user's rows on the server. */
interface FlagStore {
  list(): Promise<FeatureFlag[]>;
  get(id: string): Promise<FeatureFlag | null>;
  put(flag: FeatureFlag): Promise<void>;
  remove(id: string): Promise<void>;
  /** Release Readiness's releases, by id, for "ships with". */
  releases(): Promise<Map<string, string>>;
}

const releaseNames = (doc: ReleaseReadiness | null | undefined) =>
  new Map((doc?.releases ?? []).map((r) => [r.id, r.name]));

const browserStore: FlagStore = {
  list: async () => normalizeFlags(ws().featureFlags ?? []),
  get: async (id) => normalizeFlag((ws().featureFlags ?? []).find((f) => f.id === id)),
  put: async (flag) => ws().upsertFeatureFlag(flag),
  remove: async (id) => ws().removeFeatureFlag(id),
  releases: async () =>
    releaseNames((ws().releaseReadinesses ?? []).find((d) => d.id === RELEASE_DOC_ID)),
};

function serverStore(userId: string): FlagStore {
  return {
    list: async () => normalizeFlags(await serverListEntities<FeatureFlag>(userId, KIND_FLAG)),
    get: async (id) => normalizeFlag(await serverGetEntity<FeatureFlag>(userId, KIND_FLAG, id)),
    put: async (flag) => {
      await serverUpsertEntity<FeatureFlag>(userId, KIND_FLAG, flag);
    },
    remove: async (id) => serverDeleteEntity(userId, KIND_FLAG, id),
    releases: async () =>
      releaseNames(await serverGetEntity<ReleaseReadiness>(userId, KIND_RR, RELEASE_DOC_ID)),
  };
}

const IsoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .refine(isIsoDate, "Not a real date");

const firstError = (errors: Partial<Record<string, string>>) =>
  Object.values(errors).find(Boolean) ?? null;

/* ── list_state ─────────────────────────────────────────────────────── */

async function listState(store: FlagStore) {
  const today = todayIso();
  const [flags, releases] = await Promise.all([store.list(), store.releases()]);
  return {
    total: flags.length,
    today,
    summary: flagSummary(flags, today),
    flags: [...flags]
      .sort((a, b) => compareFlags(a, b, today))
      .map((f) => ({
        ...f,
        ...(f.releaseId ? { releaseName: releases.get(f.releaseId) ?? null } : {}),
        staleness: flagStaleness(f, today),
      })),
  };
}

registry.register({
  id: "tool.feature_flag_tracker.list_state",
  toolId: "tool.feature_flag_tracker",
  name: "list_state",
  category: "read",
  description:
    "Every feature flag, the most overdue first, with the page's numbers. Returns {total, today, summary:{total,live,on,off,retired,stale,pastRemoval,overLifetime,exempt,noOwner,retiredThisQuarter,byPurpose}, flags:{id,name,owner?,status ('on'|'off'|'retired'),purpose ('rollout'|'experiment'|'kill_switch'|'permission'),environment?,createdAt,removeBy?,retiredAt?,releaseId?,releaseName?,description?,staleness:{stale,exempt,reason ('past-removal-date'|'over-typical-lifetime'|null),dueOn,daysOver,ageDays}}[]}. Stale: past removeBy, or without one older than its purpose's lifetime (rollout 30 days, experiment 60); kill switches are always exempt, permission flags unless they have a removeBy.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── add_flag ───────────────────────────────────────────────────────── */

const addParams = z.object({
  name: z.string().trim().min(1).max(FLAG_NAME_MAX),
  purpose: z.enum(FLAG_PURPOSES as [string, ...string[]]).describe("Decides when it goes stale."),
  createdAt: IsoDay.optional().describe(
    "YYYY-MM-DD, not after today; default today. Backdate an older flag."
  ),
  removeBy: IsoDay.optional().describe("Planned removal day (YYYY-MM-DD), not before createdAt."),
  owner: z.string().trim().max(FLAG_OWNER_MAX).optional(),
  environment: z.enum(FLAG_ENVIRONMENTS as [string, ...string[]]).optional(),
  releaseId: z.string().optional().describe("A Release Readiness release id it ships behind."),
  description: z.string().max(FLAG_DESCRIPTION_MAX).optional(),
});

type AddParams = z.infer<typeof addParams>;

async function addFlag(store: FlagStore, params: AddParams) {
  const today = todayIso();
  const name = typeof params.name === "string" ? params.name.trim() : "";
  if (!name) return { added: false as const, reason: "A flag needs a name." };
  if (!(FLAG_PURPOSES as readonly string[]).includes(params.purpose))
    return {
      added: false as const,
      reason: "purpose is required: rollout, experiment, kill_switch or permission.",
    };
  const createdAt = params.createdAt ?? today;
  const error = firstError(flagDateErrors({ createdAt, removeBy: params.removeBy }, today));
  if (error) return { added: false as const, reason: error };
  if (params.releaseId && !(await store.releases()).has(params.releaseId))
    return { added: false as const, reason: "No Release Readiness release with that id." };
  const owner = params.owner?.trim();
  const description = params.description?.trim();
  const flag: FeatureFlag = {
    id: `featureFlag_${nanoid(8)}`,
    name,
    status: "on",
    purpose: params.purpose as FeatureFlag["purpose"],
    createdAt,
    ...(owner ? { owner } : {}),
    ...(params.environment
      ? { environment: params.environment as FeatureFlag["environment"] }
      : {}),
    ...(params.removeBy ? { removeBy: params.removeBy } : {}),
    ...(params.releaseId ? { releaseId: params.releaseId } : {}),
    ...(description ? { description } : {}),
  };
  await store.put(flag);
  return { added: true as const, id: flag.id, staleness: flagStaleness(flag, today) };
}

registry.register({
  id: "tool.feature_flag_tracker.add_flag",
  toolId: "tool.feature_flag_tracker",
  name: "add_flag",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a live flag (status 'on'). Params: name (required), purpose (required: rollout | experiment | kill_switch | permission), createdAt? (YYYY-MM-DD, not after today, default today), removeBy? (YYYY-MM-DD, not before createdAt), owner?, environment? (dev | staging | prod | all), releaseId? (a Release Readiness release), description?. Returns {added: true, id, staleness} or {added: false, reason}.",
  paramsSchema: addParams,
  handler: async (params) => addFlag(browserStore, params),
  mcpHandler: async (params, ctx) => addFlag(serverStore(ctx.userId), params),
});

/* ── update_flag ────────────────────────────────────────────────────── */

const updateParams = z.object({
  flagId: z.string(),
  name: z.string().trim().min(1).max(FLAG_NAME_MAX).optional(),
  purpose: z.enum(FLAG_PURPOSES as [string, ...string[]]).optional(),
  createdAt: IsoDay.optional(),
  removeBy: IsoDay.nullable().optional().describe("null clears it."),
  retiredAt: IsoDay.optional().describe("Re-date a retired flag's retirement."),
  owner: z.string().trim().max(FLAG_OWNER_MAX).nullable().optional().describe("null clears it."),
  environment: z
    .enum(FLAG_ENVIRONMENTS as [string, ...string[]])
    .nullable()
    .optional()
    .describe("null clears it."),
  releaseId: z.string().nullable().optional().describe("null unlinks it."),
  description: z
    .string()
    .max(FLAG_DESCRIPTION_MAX)
    .nullable()
    .optional()
    .describe("null clears it."),
});

async function updateFlag(store: FlagStore, params: z.infer<typeof updateParams>) {
  const f = await store.get(params.flagId);
  if (!f) return { updated: false as const, reason: "No flag with that id." };
  const today = todayIso();
  const next: FeatureFlag = { ...f };
  if (params.name !== undefined) next.name = params.name.trim();
  if (!next.name) return { updated: false as const, reason: "A flag needs a name." };
  if (params.purpose !== undefined) next.purpose = params.purpose as FeatureFlag["purpose"];
  if (params.createdAt !== undefined) next.createdAt = params.createdAt;
  if (params.retiredAt !== undefined) {
    if (f.status !== "retired")
      return {
        updated: false as const,
        reason: "Only a retired flag has a retired day: use retire_flag.",
      };
    next.retiredAt = params.retiredAt;
  }
  const optional = ["removeBy", "owner", "environment", "releaseId", "description"] as const;
  for (const key of optional) {
    const value = params[key];
    if (value === undefined) continue;
    const v = typeof value === "string" ? value.trim() : value;
    if (v === null || v === "") delete next[key];
    else (next as unknown as Record<string, string>)[key] = v;
  }
  const error = firstError(
    flagDateErrors(
      {
        createdAt: next.createdAt,
        removeBy: next.removeBy,
        ...(params.retiredAt !== undefined ? { retiredAt: next.retiredAt } : {}),
      },
      today
    )
  );
  if (error) return { updated: false as const, reason: error };
  if (params.releaseId && !(await store.releases()).has(params.releaseId))
    return { updated: false as const, reason: "No Release Readiness release with that id." };
  await store.put(next);
  return { updated: true as const, staleness: flagStaleness(next, today) };
}

registry.register({
  id: "tool.feature_flag_tracker.update_flag",
  toolId: "tool.feature_flag_tracker",
  name: "update_flag",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit a flag in place. Params: flagId, and any of name, purpose, createdAt (YYYY-MM-DD, not after today), removeBy (null clears), retiredAt (a retired flag only), owner (null clears), environment (null clears), releaseId (null unlinks), description (null clears). Status changes go through set_status / retire_flag. Returns {updated: true, staleness} or {updated: false, reason}.",
  paramsSchema: updateParams,
  handler: async (params) => updateFlag(browserStore, params),
  mcpHandler: async (params, ctx) => updateFlag(serverStore(ctx.userId), params),
});

/* ── set_status / retire_flag ───────────────────────────────────────── */

const statusParams = z.object({ flagId: z.string(), status: z.enum(["on", "off"]) });

async function setStatus(store: FlagStore, params: z.infer<typeof statusParams>) {
  const f = await store.get(params.flagId);
  if (!f) return { updated: false as const, reason: "No flag with that id." };
  const next = withLiveStatus(f, params.status);
  if (next === f) return { updated: false as const, reason: `It is ${params.status} already.` };
  await store.put(next);
  return { updated: true as const, broughtBack: f.status === "retired" };
}

registry.register({
  id: "tool.feature_flag_tracker.set_status",
  toolId: "tool.feature_flag_tracker",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Turn a flag 'on' or 'off'. A retired flag set on or off comes back (its retired day is cleared). Use retire_flag to retire. Returns {updated: true, broughtBack} or {updated: false, reason}.",
  paramsSchema: statusParams,
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

const retireParams = z.object({
  flagId: z.string(),
  retiredAt: IsoDay.optional().describe(
    "The day it left the code (YYYY-MM-DD), from createdAt to today; default today."
  ),
});

async function retireFlag(store: FlagStore, params: z.infer<typeof retireParams>) {
  const f = await store.get(params.flagId);
  if (!f) return { retired: false as const, reason: "No flag with that id." };
  if (f.status === "retired")
    return {
      retired: false as const,
      reason: "It is retired already: update_flag retiredAt re-dates it.",
    };
  const today = todayIso();
  const day = params.retiredAt ?? today;
  const error = flagDateErrors({ createdAt: f.createdAt, retiredAt: day }, today, {
    retiring: true,
  }).retiredAt;
  if (error) return { retired: false as const, reason: error };
  await store.put(withRetired(f, day));
  return { retired: true as const, retiredAt: day };
}

registry.register({
  id: "tool.feature_flag_tracker.retire_flag",
  toolId: "tool.feature_flag_tracker",
  name: "retire_flag",
  category: "write",
  requiresConfirmation: false,
  description:
    "Retire a live flag (it has left the code) on retiredAt (YYYY-MM-DD, from its created day to today; default today). It counts toward 'retired this quarter' by that day. Returns {retired: true, retiredAt} or {retired: false, reason}.",
  paramsSchema: retireParams,
  handler: async (params) => retireFlag(browserStore, params),
  mcpHandler: async (params, ctx) => retireFlag(serverStore(ctx.userId), params),
});

/* ── remove_flag ────────────────────────────────────────────────────── */

async function removeFlag(store: FlagStore, flagId: string) {
  if (!(await store.get(flagId))) return { removed: false as const };
  await store.remove(flagId);
  return { removed: true as const };
}

registry.register({
  id: "tool.feature_flag_tracker.remove_flag",
  toolId: "tool.feature_flag_tracker",
  name: "remove_flag",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete a flag by id (to record that it left the code, use retire_flag instead). Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ flagId: z.string() }),
  handler: async (params) => removeFlag(browserStore, params.flagId),
  mcpHandler: async (params, ctx) => removeFlag(serverStore(ctx.userId), params.flagId),
});
