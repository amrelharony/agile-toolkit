/**
 * Persona Library — tool-local actions.
 *
 * Category: Design Thinking & UX
 *
 * Agent surface: tool.persona_library.*
 *   1. list_state  — the personas as the page shows them, where each is used
 *                    (the impact maps whose actors name it), the interviews
 *                    it links, and counts by tier and evidence.
 *   2. add_persona — add a persona; a name already in the library is refused.
 *   3. add_points  — add goals, frustrations or habits to a persona, within
 *                    the list's cap.
 * Backing CRUD: workspace.persona.* (rename, edit and delete personas).
 *
 * Every rule comes from lib/personas/model, the module the page and the
 * next step read, so an agent reports what the page shows. Over MCP the
 * personas, the maps and the interview log are the user's rows on the
 * server.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PERSONA_EVIDENCE,
  PERSONA_KIND,
  PERSONA_TIERS,
  STRATEGY_MAP_KIND,
  TOOL_TEXT_MAX,
  type Interview,
  type Persona,
  type StrategyMap,
  type UserInterviewLog,
} from "@/lib/stores/workspace-types";
import { UI_ID } from "@/lib/interviews/model";
import { isExampleId } from "@/lib/utils/example-id";
import {
  PERSONA_CONTEXT_MAX,
  PERSONA_ID_PREFIX,
  PERSONA_LISTS,
  PERSONA_NAME_MAX,
  PERSONA_POINTS_MAX,
  PERSONA_POINT_MAX,
  PERSONA_QUOTE_MAX,
  PERSONA_ROLE_MAX,
  PERSONA_SUMMARY_MAX,
  PERSONA_TAGS_MAX,
  PERSONA_TAG_MAX,
  cleanList,
  defaultTier,
  duplicateOf,
  linkedInterviews,
  personaCounts,
  readPersona,
  readPersonas,
  usedOnMaps,
  withPoints,
} from "@/lib/personas/model";

/** MUST match registerCollection("userInterviewLog", …) in workspace-store.ts. */
const KIND_INTERVIEW_LOG = "workspace:userInterviewLog";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/** Where the personas (and the maps and interviews they're read with) live: the browser, or the server. */
interface PersonaStore {
  personas(): Promise<Persona[]>;
  put(persona: Persona): Promise<void>;
  maps(): Promise<StrategyMap[]>;
  interviews(): Promise<Interview[]>;
}

const browserStore: PersonaStore = {
  personas: async () => ws().personas ?? [],
  put: async (p) => ws().upsertPersona(p),
  maps: async () => ws().strategyMaps ?? [],
  interviews: async () =>
    (ws().userInterviewLogs ?? []).find((d) => d.id === UI_ID)?.interviews ?? [],
};

function serverStore(userId: string): PersonaStore {
  return {
    personas: () => serverListEntities<Persona>(userId, PERSONA_KIND),
    put: async (p) => {
      await serverUpsertEntity<Persona>(userId, PERSONA_KIND, p);
    },
    maps: () => serverListEntities<StrategyMap>(userId, STRATEGY_MAP_KIND),
    interviews: async () =>
      (await serverGetEntity<UserInterviewLog>(userId, KIND_INTERVIEW_LOG, UI_ID))?.interviews ??
      [],
  };
}

const NOT_FOUND = {
  reason: "not_found",
  message: "No persona with that id (see list_state).",
};

/* ── tool.persona_library.list_state ─────────────────────────────────── */

async function listState(store: PersonaStore): Promise<Out> {
  const [rows, maps, interviews] = await Promise.all([
    store.personas(),
    store.maps(),
    store.interviews(),
  ]);
  const personas = readPersonas(rows);
  return {
    personas: personas.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      summary: p.summary ?? null,
      tier: p.tier,
      evidence: p.evidence,
      goals: p.goals,
      pains: p.pains,
      behaviours: p.behaviours,
      quote: p.quote ?? null,
      context: p.context ?? null,
      tags: p.tags,
      example: isExampleId(p.id),
      usedOn: usedOnMaps(p, maps).map((m) => ({ id: m.id, title: m.title })),
      interviews: {
        linked: linkedInterviews(p, interviews).length,
        missing: (p.interviewIds ?? []).length - linkedInterviews(p, interviews).length,
      },
    })),
    counts: personaCounts(personas),
    interviewsLogged: interviews.filter((i) => !isExampleId(i.id)).length,
  };
}

registry.register({
  id: "tool.persona_library.list_state",
  toolId: "tool.persona_library",
  name: "list_state",
  category: "read",
  description:
    "List the personas as the Persona Library shows them: main ones first (tier 'primary'), then 'secondary' (also served), then 'anti' (who the product is not for); evidence is 'assumed' (a guess), 'some' or 'researched'. pains are frustrations, behaviours habits. usedOn names the impact maps whose actors are the persona; interviews counts the User Interview Log interviews it links that still exist (missing: linked but deleted). Returns {personas: {id, name, role, summary, tier, evidence, goals, pains, behaviours, quote, context, tags, example, usedOn: {id, title}[], interviews: {linked, missing}}[], counts: {tiers, evidence}, interviewsLogged}. Rename, edit or delete a persona with workspace.persona.*.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── tool.persona_library.add_persona ────────────────────────────────── */

const Points = z
  .array(z.string().max(PERSONA_POINT_MAX))
  .max(PERSONA_POINTS_MAX)
  .optional()
  .describe(`At most ${PERSONA_POINTS_MAX} short points.`);

const AddPersonaParams = z.object({
  name: z.string().trim().min(1).max(PERSONA_NAME_MAX).describe("A made-up first name."),
  role: z.string().trim().min(1).max(PERSONA_ROLE_MAX),
  tier: z
    .enum(PERSONA_TIERS)
    .optional()
    .describe("Left out: 'primary' while the library has no main persona, else 'secondary'."),
  evidence: z.enum(PERSONA_EVIDENCE).optional().describe("Left out: 'assumed'."),
  summary: z.string().max(PERSONA_SUMMARY_MAX).optional(),
  goals: Points,
  pains: Points.describe("Frustrations."),
  behaviours: Points.describe("Habits."),
  quote: z.string().max(PERSONA_QUOTE_MAX).optional(),
  context: z.string().max(PERSONA_CONTEXT_MAX).optional(),
  tags: z.array(z.string().max(PERSONA_TAG_MAX)).max(PERSONA_TAGS_MAX).optional(),
});

/** The persona add_persona writes, or the refusal. */
function plannedPersona(
  params: z.infer<typeof AddPersonaParams>,
  existing: readonly Persona[],
  id: string,
  at: string
): { persona: Persona } | { refused: Out } {
  const all = readPersonas(existing);
  const dup = duplicateOf(params.name, all);
  if (dup) {
    return {
      refused: {
        added: false,
        reason: "duplicate_name",
        message: `A persona named “${dup.name}” is already in the library (${dup.id}). Pick another made-up name, or add points to it with add_points.`,
      },
    };
  }
  const persona = readPersona({
    id,
    name: params.name,
    role: params.role,
    tier: params.tier ?? defaultTier(all),
    evidence: params.evidence ?? "assumed",
    summary: params.summary,
    goals: params.goals ?? [],
    pains: params.pains ?? [],
    behaviours: params.behaviours ?? [],
    quote: params.quote,
    context: params.context,
    tags: params.tags ?? [],
    createdAt: at,
    updatedAt: at,
  }) as Persona;
  return { persona };
}

async function addPersona(
  store: PersonaStore,
  params: z.infer<typeof AddPersonaParams>
): Promise<Out> {
  const planned = plannedPersona(
    params,
    await store.personas(),
    `${PERSONA_ID_PREFIX}${nanoid(8)}`,
    new Date().toISOString()
  );
  if ("refused" in planned) return planned.refused;
  await store.put(planned.persona);
  return { added: true, id: planned.persona.id, tier: planned.persona.tier };
}

registry.register({
  id: "tool.persona_library.add_persona",
  toolId: "tool.persona_library",
  name: "add_persona",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a persona to the Persona Library: a made-up name (never a real person's), a role, and optionally its tier, evidence, summary, goals, pains (frustrations), behaviours (habits), quote, context and tags. Each list holds at most 8 short points; blanks and repeats are dropped. A name already in the library (any case) is refused with reason 'duplicate_name'. Returns {added: true, id, tier} or {added: false, reason, message}.",
  paramsSchema: AddPersonaParams,
  handler: async (params) => addPersona(browserStore, params),
  mcpHandler: async (params, ctx) => addPersona(serverStore(ctx.userId), params),
});

/* ── tool.persona_library.add_points ─────────────────────────────────── */

const AddPointsParams = z.object({
  personaId: z.string().min(1).max(TOOL_TEXT_MAX.short),
  list: z.enum(PERSONA_LISTS).describe("'goals', 'pains' (frustrations) or 'behaviours' (habits)."),
  items: z.array(z.string().trim().min(1).max(PERSONA_POINT_MAX)).min(1).max(PERSONA_POINTS_MAX),
});

async function addPoints(
  store: PersonaStore,
  params: z.infer<typeof AddPointsParams>
): Promise<Out> {
  const raw = (await store.personas()).find((p) => p && p.id === params.personaId);
  const persona = raw ? readPersona(raw) : null;
  if (!persona) return { updated: false, ...NOT_FOUND };
  const items = cleanList(params.items, PERSONA_POINTS_MAX, PERSONA_POINT_MAX);
  const result = withPoints(persona, params.list, items);
  if (result.added === 0) {
    const full = persona[params.list].length >= PERSONA_POINTS_MAX;
    return {
      updated: false,
      reason: full ? "full" : "unchanged",
      message: full
        ? `This list already holds ${PERSONA_POINTS_MAX} points, its most. Remove one in the page first.`
        : "Every point is already on the list.",
    };
  }
  await store.put({ ...result.persona, updatedAt: new Date().toISOString() });
  return { updated: true, added: result.added, skipped: result.skipped };
}

registry.register({
  id: "tool.persona_library.add_points",
  toolId: "tool.persona_library",
  name: "add_points",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add points to one of a persona's lists: 'goals', 'pains' (frustrations) or 'behaviours' (habits). A list holds at most 8 short points; a point already on it (any case) is skipped. Returns {updated: true, added, skipped}, or {updated: false, reason: 'not_found' | 'full' | 'unchanged', message}.",
  paramsSchema: AddPointsParams,
  handler: async (params) => addPoints(browserStore, params),
  mcpHandler: async (params, ctx) => addPoints(serverStore(ctx.userId), params),
});
