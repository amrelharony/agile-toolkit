/**
 * Definition of Done Builder — tool-local actions.
 *
 * Category: Risk & Governance
 * Tool:     The team's Definition of Done (criteria, Required or optional)
 *           and how many done stories meet it, from the ticks on each
 *           story's Sprint board card.
 *
 * Agent surface: tool.dod_builder.*
 * Backing CRUD : workspace.definition_of_done.* (auto-generated). Singleton:
 *                one DefinitionOfDone document under DOD_DOC_ID.
 *
 *   1. list_state       — criteria, adherence in a sprint and by sprint, the verdict.
 *   2. add_criterion    — add a criterion (Required unless said otherwise).
 *   3. update_criterion — reword, recategorise, require or describe one.
 *   4. remove_criterion — remove one (stories keep their ticks).
 *   5. set_story_check  — tick or untick a criterion on a story.
 *
 * Every number comes from lib/dod/model, as on the page. Until the DoD
 * builder's old blob ("agile-toolkit:dod-builder") has moved into the
 * workspace, reads fall back to it and the first write moves it (a copy:
 * the blob stays as the backup).
 */

import { z } from "zod";
import { nanoid } from "nanoid";
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
  DodCategory,
  DodCriterion,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";
import { pickDefaultSprint } from "@/lib/sprints/series";
import {
  CRITERION_DESCRIPTION_MAX,
  CRITERION_LABEL_MAX,
  DOD_CATEGORIES,
  DOD_DOC_ID,
  DOD_KIND,
  DOD_LEGACY_KEY,
  DOD_MOVED_KEY,
  adherenceBySprint,
  dodAdherence,
  dodVerdict,
  emptyDefinitionOfDone,
  isMovedMarker,
  meetsDod,
  normalizeDefinitionOfDone,
  openCriteria,
  requiredCriteria,
  withStoryDodCheck,
} from "@/lib/dod/model";

/** MUST match registerCollection("story", …) in workspace-store.ts. */
const KIND_STORY = "workspace:story";
/** MUST match registerCollection("sprint", …) in workspace-store.ts. */
const KIND_SPRINT = "workspace:sprint";

const CategorySchema = z.enum(DOD_CATEGORIES as [DodCategory, ...DodCategory[]]);

const ws = () => useWorkspaceStore.getState();

/** Where the DoD and the stories live: the browser's workspace, or the user's rows on the server. */
interface DodStore {
  /** The workspace document, else the old blob (any shape), else null. */
  getDoc(): Promise<{ doc: unknown; source: "workspace" | "legacy" } | null>;
  putDoc(doc: DefinitionOfDone): Promise<void>;
  stories(): Promise<Story[]>;
  sprints(): Promise<Sprint[]>;
  getStory(id: string): Promise<Story | null>;
  putStory(story: Story): Promise<void>;
}

/** A blob as the page's usePersisted hydrates it, or null. */
function browserBlob(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Once the old blob has moved (DOD_MOVED_KEY), it is only the backup: a
// DoD deleted from the workspace stays deleted, as on the page.
const browserStore: DodStore = {
  getDoc: async () => {
    const doc = (ws().definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID);
    if (doc) return { doc, source: "workspace" };
    if (isMovedMarker(browserBlob(DOD_MOVED_KEY))) return null;
    const blob = browserBlob(DOD_LEGACY_KEY);
    return blob ? { doc: blob, source: "legacy" } : null;
  },
  putDoc: async (doc) => ws().upsertDefinitionOfDone(doc),
  stories: async () => ws().stories ?? [],
  sprints: async () => ws().sprints ?? [],
  getStory: async (id) => (ws().stories ?? []).find((s) => s.id === id) ?? null,
  putStory: async (story) => ws().upsertStory(story),
};

function serverStore(userId: string): DodStore {
  return {
    getDoc: async () => {
      const doc = await serverGetEntity<DefinitionOfDone>(userId, DOD_KIND, DOD_DOC_ID);
      if (doc) return { doc, source: "workspace" };
      if (isMovedMarker(await serverGetUserStateBlob(userId, DOD_MOVED_KEY))) return null;
      const blob = await serverGetUserStateBlob(userId, DOD_LEGACY_KEY);
      return blob ? { doc: blob, source: "legacy" } : null;
    },
    putDoc: async (doc) => {
      await serverUpsertEntity<DefinitionOfDone>(userId, DOD_KIND, doc);
    },
    stories: async () => serverListEntities<Story>(userId, KIND_STORY),
    sprints: async () => serverListEntities<Sprint>(userId, KIND_SPRINT),
    getStory: async (id) => (await serverGetEntity<Story>(userId, KIND_STORY, id)) ?? null,
    putStory: async (story) => {
      await serverUpsertEntity<Story>(userId, KIND_STORY, story);
    },
  };
}

/** The DoD as the page reads it. */
async function readDoc(store: DodStore): Promise<DefinitionOfDone> {
  const found = await store.getDoc();
  return found ? normalizeDefinitionOfDone(found.doc) : emptyDefinitionOfDone();
}

/**
 * Change the DoD with `fn`, which gets it as the page reads it and returns
 * the new document and the result, or a refusal to write nothing.
 */
async function change<T extends Record<string, unknown>>(
  store: DodStore,
  fn: (doc: DefinitionOfDone) => { doc: DefinitionOfDone; result: T } | { refuse: T }
): Promise<T> {
  const out = fn(await readDoc(store));
  if ("refuse" in out) return out.refuse;
  await store.putDoc({ ...out.doc, id: DOD_DOC_ID });
  return out.result;
}

const labelKey = (label: string) =>
  label.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();

/* ── list_state ─────────────────────────────────────────────────────── */

async function listState(store: DodStore, sprintId: string | undefined) {
  const [found, stories, sprints] = await Promise.all([
    store.getDoc(),
    store.stories(),
    store.sprints(),
  ]);
  const doc = found ? normalizeDefinitionOfDone(found.doc) : emptyDefinitionOfDone();
  const sprint = sprintId
    ? sprints.find((s) => s.id === sprintId)
    : pickDefaultSprint(sprints, null);
  if (sprintId && !sprint) return { exists: found !== null, error: "unknown_sprint" as const };
  const adherence = dodAdherence(stories, doc, sprint?.id);
  const byCategory = Object.fromEntries(DOD_CATEGORIES.map((c) => [c, 0])) as Record<
    DodCategory,
    number
  >;
  for (const c of doc.items) byCategory[c.category] += 1;
  return {
    exists: found !== null,
    source: found?.source ?? null,
    criteria: doc.items.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      required: c.required,
      ...(c.description ? { description: c.description } : {}),
    })),
    requiredCount: requiredCriteria(doc).length,
    byCategory,
    sprint: sprint ? { id: sprint.id, name: sprint.name, status: sprint.status } : null,
    adherence,
    bySprint: adherenceBySprint(stories, sprints, doc),
    legacyHistory: doc.history,
    verdict: dodVerdict(doc, adherence, sprint?.name),
  };
}

registry.register({
  id: "tool.dod_builder.list_state",
  toolId: "tool.dod_builder",
  name: "list_state",
  category: "read",
  description:
    "The Definition of Done and how many done stories meet it, with the page's numbers. Params: sprintId? (defaults to the active sprint, else the newest). A story meets the DoD when every required criterion is ticked on it (Story.dodChecks), against the criteria as they are today; example rows never count. Returns {exists, source: 'workspace' | 'legacy' (the DoD builder's old copy, not moved into the workspace yet) | null, criteria: {id, label, category, required, description?}[], requiredCount, byCategory, sprint: null | {id, name, status}, adherence: {required, done (done stories in the sprint), meeting, pct (null with no done stories or nothing required), missing: {id, title, sprintId?, open: string[]}[]}, bySprint: {sprintId, name, startDate, endDate, done, meeting, pct}[] (oldest first, sprints with done stories), legacyHistory (team-level tallies from before per-story ticks, read-only), verdict}, or {exists, error: 'unknown_sprint'}.",
  paramsSchema: z.object({ sprintId: z.string().min(1).optional() }),
  handler: async (params) => listState(browserStore, params.sprintId),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params.sprintId),
});

/* ── Criteria ───────────────────────────────────────────────────────── */

const AddParams = z.object({
  label: z.string().trim().min(1).max(CRITERION_LABEL_MAX),
  category: CategorySchema,
  required: z.boolean().default(true).describe("Defaults to true: every done story must meet it."),
  description: z.string().trim().max(CRITERION_DESCRIPTION_MAX).optional(),
});

async function addCriterion(store: DodStore, params: z.infer<typeof AddParams>) {
  return change(store, (doc) => {
    const dup = doc.items.find((c) => labelKey(c.label) === labelKey(params.label));
    if (dup) return { refuse: { added: false, reason: "duplicate", id: dup.id } };
    const criterion: DodCriterion = {
      id: `dod_${nanoid(8)}`,
      label: params.label,
      category: params.category,
      required: params.required,
      ...(params.description ? { description: params.description } : {}),
    };
    return {
      doc: { ...doc, items: [...doc.items, criterion] },
      result: { added: true, id: criterion.id, required: criterion.required },
    };
  });
}

registry.register({
  id: "tool.dod_builder.add_criterion",
  toolId: "tool.dod_builder",
  name: "add_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a Definition-of-Done criterion. Params: label, category (code | testing | docs | performance | security | other), required? (default true), description?. Creates the DoD if absent (moving the DoD builder's old copy in first, when there is one). Returns {added: true, id, required}, or {added: false, reason: 'duplicate', id} when the DoD already holds it (case, spacing and a closing full stop aside).",
  paramsSchema: AddParams,
  handler: async (params) => addCriterion(browserStore, params),
  mcpHandler: async (params, ctx) => addCriterion(serverStore(ctx.userId), params),
});

const UpdateParams = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(CRITERION_LABEL_MAX).optional(),
  category: CategorySchema.optional(),
  required: z.boolean().optional(),
  description: z
    .string()
    .trim()
    .max(CRITERION_DESCRIPTION_MAX)
    .optional()
    .describe("An empty string removes the description."),
});

async function updateCriterion(store: DodStore, params: z.infer<typeof UpdateParams>) {
  return change(store, (doc) => {
    const current = doc.items.find((c) => c.id === params.id);
    if (!current) return { refuse: { updated: false, reason: "not_found" } };
    if (
      params.label &&
      doc.items.some(
        (c) => c.id !== current.id && labelKey(c.label) === labelKey(params.label ?? "")
      )
    ) {
      return { refuse: { updated: false, reason: "duplicate" } };
    }
    const next: DodCriterion = { ...current };
    if (params.label) next.label = params.label;
    if (params.category) next.category = params.category;
    if (params.required !== undefined) next.required = params.required;
    if (params.description !== undefined) {
      if (params.description) next.description = params.description;
      else delete next.description;
    }
    return {
      doc: { ...doc, items: doc.items.map((c) => (c.id === current.id ? next : c)) },
      result: { updated: true },
    };
  });
}

registry.register({
  id: "tool.dod_builder.update_criterion",
  toolId: "tool.dod_builder",
  name: "update_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Change a criterion by id (ids are in list_state). Params: id, label?, category?, required?, description? ('' removes it). Making it required counts it against every done story from now on. Returns {updated: true}, or {updated: false, reason: 'not_found' | 'duplicate'}.",
  paramsSchema: UpdateParams,
  handler: async (params) => updateCriterion(browserStore, params),
  mcpHandler: async (params, ctx) => updateCriterion(serverStore(ctx.userId), params),
});

async function removeCriterion(store: DodStore, id: string) {
  return change(store, (doc) =>
    doc.items.some((c) => c.id === id)
      ? { doc: { ...doc, items: doc.items.filter((c) => c.id !== id) }, result: { removed: true } }
      : { refuse: { removed: false, reason: "not_found" } }
  );
}

registry.register({
  id: "tool.dod_builder.remove_criterion",
  toolId: "tool.dod_builder",
  name: "remove_criterion",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a criterion by id. Stories keep their ticks of it (ignored while it is gone). Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => removeCriterion(browserStore, params.id),
  mcpHandler: async (params, ctx) => removeCriterion(serverStore(ctx.userId), params.id),
});

/* ── Ticks on a story ───────────────────────────────────────────────── */

const CheckParams = z.object({
  storyId: z.string().min(1),
  criterionId: z.string().min(1),
  checked: z.boolean(),
});

async function setStoryCheck(store: DodStore, params: z.infer<typeof CheckParams>) {
  const doc = await readDoc(store);
  if (!doc.items.some((c) => c.id === params.criterionId)) {
    return { updated: false, reason: "unknown_criterion" };
  }
  const story = await store.getStory(params.storyId);
  if (!story) return { updated: false, reason: "unknown_story" };
  const next = withStoryDodCheck(
    story,
    params.criterionId,
    params.checked,
    new Date().toISOString()
  );
  if (next !== story) await store.putStory(next);
  return {
    updated: true,
    meetsDod: meetsDod(next, doc),
    open: openCriteria(next, doc).map((c) => ({ id: c.id, label: c.label })),
  };
}

registry.register({
  id: "tool.dod_builder.set_story_check",
  toolId: "tool.dod_builder",
  name: "set_story_check",
  category: "write",
  requiresConfirmation: false,
  description:
    "Tick (checked: true) or untick a Definition-of-Done criterion on a story, as its Sprint board card does. Params: storyId, criterionId (from list_state criteria), checked. Returns {updated: true, meetsDod (null when nothing is required), open: {id, label}[] (the required criteria still open)}, or {updated: false, reason: 'unknown_criterion' | 'unknown_story'}.",
  paramsSchema: CheckParams,
  handler: async (params) => setStoryCheck(browserStore, params),
  mcpHandler: async (params, ctx) => setStoryCheck(serverStore(ctx.userId), params),
});
