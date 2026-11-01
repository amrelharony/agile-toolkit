/**
 * ADKAR Change Tracker — tool-local actions.
 *
 * Category: Outcomes & Pulse
 * Tool:     Move each change initiative through Awareness → Desire →
 *           Knowledge → Ability → Reinforcement on dated moves, and score
 *           each affected group 1-5 on the five elements to find its
 *           barrier point (the first element at 3 or lower).
 *
 * Agent surface: tool.adkar.*
 * Backing CRUD : workspace.adkar_doc.* (auto-generated). Singleton: one
 *                AdkarDoc ({initiatives}) under ADKAR_DOC_ID.
 *
 *   1. list_state        — every initiative with its stage, days in it,
 *                          stage history, groups, barriers; the counts and
 *                          the page's verdict.
 *   2. add_initiative    — a change at Awareness from its (backdatable) start.
 *   3. update_initiative — edit its name, owner, description or start date.
 *   4. set_group_scores  — add or update a group's element scores.
 *   5. advance           — move it a stage on, dated.
 *   6. step_back         — move it a stage back, dated (adoption slipped).
 *   7. remove_initiative — delete it.
 *
 * The tool's old blob ("agile-toolkit:adkar") moves into the doc the first
 * time the page opens (it stays as the backup). Until then the agent reads
 * what the page will show: the doc plus the initiatives still waiting in
 * the blob, planned the same way (lib/adkar/model planAdkarMove), and its
 * writes carry them into the doc, which the page's move then skips. The
 * moved-ids record is the page's (agents can't write the blob), so a
 * delete the move would undo is refused until the page has run once.
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
  AdkarDoc,
  AdkarInitiative,
  AdkarScore,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  ADKAR_DOC_ID,
  ADKAR_ELEMENTS,
  ADKAR_KIND,
  ADKAR_LEGACY_KEY,
  ADKAR_MOVED_KEY,
  DESCRIPTION_MAX,
  ELEMENT_LABEL,
  NAME_MAX,
  adkarVerdict,
  advance,
  assessedAtError,
  barrierPoint,
  completedStages,
  daysInStage,
  initiativeBarrier,
  longestInCurrentStage,
  medianDaysInStage,
  moveDateError,
  nameError,
  newGroup,
  newInitiative,
  normalizeAdkarDoc,
  pastBarrier,
  planAdkarMove,
  stageCounts,
  stageDurations,
  startDateError,
  stepBack,
  stuckInitiatives,
  unknownBarriers,
  withDetails,
  withGroupPatch,
  withGroupScore,
  withInitiative,
  withStartDate,
} from "@/lib/adkar/model";

const ws = () => useWorkspaceStore.getState();

/** Where the doc and the old blob live: the browser, or the user's rows on the server. */
interface AdkarStore {
  getDoc(): Promise<AdkarDoc | null>;
  putDoc(doc: AdkarDoc): Promise<void>;
  /** The old blob and its moved-ids record, as stored (any shape). */
  legacy(): Promise<{ blob: unknown; moved: unknown }>;
  /** The team roster, for owners' spelling. */
  roster(): Promise<TeamMember[]>;
}

/** MUST match registerCollection("teamMember", ...) in workspace-store.ts. */
const KIND_TEAM = "workspace:teamMember";

/** A usePersisted blob as the page hydrates it, or null. */
function browserBlob(key: string): unknown {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const browserStore: AdkarStore = {
  getDoc: async () => (ws().adkarDocs ?? []).find((d) => d.id === ADKAR_DOC_ID) ?? null,
  putDoc: async (doc) => ws().upsertAdkarDoc(doc),
  legacy: async () => ({
    blob: browserBlob(ADKAR_LEGACY_KEY),
    moved: browserBlob(ADKAR_MOVED_KEY),
  }),
  roster: async () => ws().teamMembers ?? [],
};

function serverStore(userId: string): AdkarStore {
  return {
    getDoc: async () => (await serverGetEntity<AdkarDoc>(userId, ADKAR_KIND, ADKAR_DOC_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<AdkarDoc>(userId, ADKAR_KIND, doc);
    },
    legacy: async () => ({
      blob: await serverGetUserStateBlob(userId, ADKAR_LEGACY_KEY),
      moved: await serverGetUserStateBlob(userId, ADKAR_MOVED_KEY),
    }),
    roster: async () => serverListEntities<TeamMember>(userId, KIND_TEAM),
  };
}

/** The doc as the page shows it: stored initiatives, then any still waiting in the old blob. */
async function load(store: AdkarStore, today: string) {
  const raw = await store.getDoc();
  const doc = normalizeAdkarDoc(raw, today);
  const legacy = await store.legacy();
  const pending = planAdkarMove(legacy.blob, doc.initiatives, legacy.moved, today).toMove;
  return {
    raw,
    legacy,
    pending: pending.length,
    doc: { ...doc, initiatives: [...doc.initiatives, ...pending] },
  };
}

type Result = Record<string, unknown>;

/** The old blob and its moved-ids record, as stored. */
type Legacy = { blob: unknown; moved: unknown };

/** Change the doc with `fn` (no `doc`: nothing written). */
async function update(
  store: AdkarStore,
  fn: (
    doc: AdkarDoc,
    today: string,
    roster: TeamMember[],
    legacy: Legacy
  ) => { doc?: AdkarDoc; result: Result }
): Promise<Result> {
  const today = todayLocalISO();
  const { doc, legacy } = await load(store, today);
  const out = fn(doc, today, await store.roster(), legacy);
  if (out.doc) await store.putDoc({ ...out.doc, id: ADKAR_DOC_ID });
  return out.result;
}

const find = (doc: AdkarDoc, id: string) => doc.initiatives.find((i) => i.id === id);

/* ── list_state ─────────────────────────────────────────────────────── */

function initiativeRow(i: AdkarInitiative, today: string) {
  return {
    id: i.id,
    name: i.name,
    owner: i.owner ?? null,
    startDate: i.startDate,
    description: i.description ?? null,
    currentStage: i.currentStage,
    stage: ELEMENT_LABEL[i.currentStage],
    completedStages: completedStages(i),
    daysInStage: daysInStage(i, today),
    stageDurations: stageDurations(i, today),
    groups: (i.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      scores: g.scores,
      assessedAt: g.assessedAt ?? null,
      note: g.note ?? null,
      barrier: barrierPoint(g.scores),
    })),
    barrier: initiativeBarrier(i),
    pastBarrier: pastBarrier(i).map((p) => ({
      groupId: p.group.id,
      groupName: p.group.name,
      barrier: p.barrier,
      score: p.score,
    })),
  };
}

async function listState(store: AdkarStore) {
  const today = todayLocalISO();
  const { raw, pending, doc } = await load(store, today);
  const median = medianDaysInStage(doc.initiatives, today);
  const longest = longestInCurrentStage(doc.initiatives, today);
  return {
    exists: raw !== null,
    pendingLegacy: pending,
    initiatives: doc.initiatives.map((i) => initiativeRow(i, today)),
    counts: stageCounts(doc.initiatives),
    held: doc.initiatives.filter((i) => initiativeBarrier(i) !== null).length,
    unknownBarriers: unknownBarriers(doc.initiatives),
    stuck: stuckInitiatives(doc.initiatives, today).map((i) => i.id),
    medianDaysInStage: { days: median.median, periods: median.periods },
    longestInCurrentStage: longest
      ? {
          id: longest.initiative.id,
          name: longest.initiative.name,
          stage: longest.initiative.currentStage,
          days: longest.days,
        }
      : null,
    verdict: adkarVerdict(doc.initiatives, today),
  };
}

registry.register({
  id: "tool.adkar.list_state",
  toolId: "tool.adkar",
  name: "list_state",
  category: "read",
  description:
    "Summarise the ADKAR change initiatives, as the page does. A group's barrier point is the first element (Awareness, Desire, Knowledge, Ability, Reinforcement) scored 3 or lower; an unscored element before it leaves it unknown (unscoredBefore). Returns {exists, pendingLegacy (initiatives still in the old blob, included below), initiatives: {id, name, owner, startDate, description, currentStage, stage, completedStages, daysInStage, stageDurations: {stage, from, to (null = current), days}[], groups: {id, name, scores (element -> 1-5; missing = not scored), assessedAt, note, barrier: {element, score?, unscoredBefore?}}[], barrier: null | {element, groupId, groupName, score} (the earliest across groups), pastBarrier: {groupId, groupName, barrier, score}[] (groups whose barrier is before the current stage)}[], counts (initiatives per current stage), held (initiatives with a barrier), unknownBarriers: {initiativeId, initiativeName, groupId, groupName, element (score it next)}[] (groups not scored far enough to tell; never read them as not held), stuck (ids in the same stage 30+ days; Reinforcement, which has no exit, left out), medianDaysInStage: {days (null below 3 finished stages), periods}, longestInCurrentStage: null | {id, name, stage, days} (Reinforcement left out), verdict}.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── add_initiative / update_initiative / remove_initiative ─────────── */

const IsoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

const AddParams = z.object({
  name: z.string().max(NAME_MAX).describe("The change, e.g. 'Adopt trunk-based development'."),
  owner: z
    .string()
    .max(120)
    .optional()
    .describe("A name; a roster name is stored with the roster's spelling."),
  startDate: IsoDay.optional().describe("Defaults to today; backdating is fine, the future isn't."),
  description: z.string().max(DESCRIPTION_MAX).optional(),
});

/** An owner with the roster's spelling when the name is on the team. */
function ownerName(
  name: string | undefined,
  roster: readonly { name: string }[]
): string | undefined {
  const clean = name?.trim();
  if (!clean) return undefined;
  return findRosterMember(roster, clean)?.name ?? clean;
}

async function addInitiative(store: AdkarStore, p: z.infer<typeof AddParams>) {
  return update(store, (doc, today, roster) => {
    const error = nameError(p.name);
    if (error) return { result: { added: false, reason: "invalid_name", message: error } };
    const startDate = p.startDate ?? today;
    const dateError = startDateError(null, startDate, today);
    if (dateError) return { result: { added: false, reason: "invalid_date", message: dateError } };
    const i = newInitiative(
      {
        name: p.name,
        owner: ownerName(p.owner, roster),
        startDate,
        description: p.description,
      },
      crypto.randomUUID()
    );
    return {
      doc: { ...doc, initiatives: [i, ...doc.initiatives] },
      result: { added: true, id: i.id },
    };
  });
}

registry.register({
  id: "tool.adkar.add_initiative",
  toolId: "tool.adkar",
  name: "add_initiative",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a change initiative at Awareness, entered on its start date (default today; never in the future). It goes first in the list, as on the page. Returns {added: false, reason: 'invalid_name' | 'invalid_date', message} or {added: true, id}.",
  paramsSchema: AddParams,
  handler: async (params) => addInitiative(browserStore, params),
  mcpHandler: async (params, ctx) => addInitiative(serverStore(ctx.userId), params),
});

const UpdateParams = z.object({
  id: z.string(),
  name: z.string().max(NAME_MAX).optional(),
  owner: z.string().max(120).nullable().optional().describe("null or empty clears it."),
  description: z
    .string()
    .max(DESCRIPTION_MAX)
    .nullable()
    .optional()
    .describe("null or empty clears it."),
  startDate: IsoDay.optional().describe("Not after today or the first stage move."),
});

async function updateInitiative(store: AdkarStore, p: z.infer<typeof UpdateParams>) {
  return update(store, (doc, today, roster) => {
    const i = find(doc, p.id);
    if (!i) return { result: { updated: false, reason: "not_found" } };
    if (p.name !== undefined) {
      const error = nameError(p.name);
      if (error) return { result: { updated: false, reason: "invalid_name", message: error } };
    }
    let next: AdkarInitiative = withDetails(i, {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.owner !== undefined ? { owner: ownerName(p.owner ?? undefined, roster) ?? null } : {}),
      ...(p.description !== undefined ? { description: p.description } : {}),
    });
    if (p.startDate !== undefined) {
      const error = startDateError(next, p.startDate, today);
      if (error) return { result: { updated: false, reason: "invalid_date", message: error } };
      next = withStartDate(next, p.startDate, today) ?? next;
    }
    return { doc: withInitiative(doc, p.id, () => next), result: { updated: true } };
  });
}

registry.register({
  id: "tool.adkar.update_initiative",
  toolId: "tool.adkar",
  name: "update_initiative",
  category: "write",
  requiresConfirmation: false,
  description:
    "Edit an initiative in place: name, owner, description (null clears the last two), or the start date (also the day it entered Awareness; not after today or its first move). Returns {updated: false, reason: 'not_found' | 'invalid_name' | 'invalid_date', message?} or {updated: true}.",
  paramsSchema: UpdateParams,
  handler: async (params) => updateInitiative(browserStore, params),
  mcpHandler: async (params, ctx) => updateInitiative(serverStore(ctx.userId), params),
});

const IdParams = z.object({ id: z.string() });

async function removeInitiative(store: AdkarStore, { id }: z.infer<typeof IdParams>) {
  return update(store, (doc, today, _roster, legacy) => {
    if (!find(doc, id)) return { result: { removed: false } };
    const initiatives = doc.initiatives.filter((i) => i.id !== id);
    // The page's one-time move would bring it back from the old blob: the
    // moved-ids record (only the page writes it) doesn't list it yet, and
    // nothing from the blob would be left in the doc to show it moved.
    const back = planAdkarMove(legacy.blob, initiatives, legacy.moved, today).toMove;
    if (back.some((i) => i.id === id)) {
      return {
        result: {
          removed: false,
          reason: "not_moved_yet",
          message:
            "It is still in the tracker's old data. Open the ADKAR page once so it moves the initiatives into the workspace, then delete it.",
        },
      };
    }
    return { doc: { ...doc, initiatives }, result: { removed: true } };
  });
}

registry.register({
  id: "tool.adkar.remove_initiative",
  toolId: "tool.adkar",
  name: "remove_initiative",
  category: "write",
  requiresConfirmation: false,
  description:
    "Delete an initiative with its groups and history. One still waiting in the tracker's old data, whose deletion the page's one-time move would undo, is refused until the ADKAR page has been opened once. Returns {removed: false} for an unknown id, {removed: false, reason: 'not_moved_yet', message}, else {removed: true}.",
  paramsSchema: IdParams,
  handler: async (params) => removeInitiative(browserStore, params),
  mcpHandler: async (params, ctx) => removeInitiative(serverStore(ctx.userId), params),
});

/* ── set_group_scores ───────────────────────────────────────────────── */

const ScoreValue = z.number().int().min(1).max(5).nullable();

const GroupParams = z.object({
  id: z.string().describe("The initiative id."),
  groupId: z
    .string()
    .optional()
    .describe("An existing group; leave out to find it by name or add it."),
  name: z
    .string()
    .max(NAME_MAX)
    .optional()
    .describe(
      "The group's name: finds it (case-insensitive) or adds it; with groupId, renames it."
    ),
  scores: z
    .object({
      awareness: ScoreValue.optional(),
      desire: ScoreValue.optional(),
      knowledge: ScoreValue.optional(),
      ability: ScoreValue.optional(),
      reinforcement: ScoreValue.optional(),
    })
    .optional()
    .describe(
      "Element -> 1-5, or null to clear it to not scored; elements left out keep their score."
    ),
  assessedAt: IsoDay.optional().describe(
    "The day the scores were taken (a real day, not after today); the first score dates it today otherwise."
  ),
  note: z.string().max(DESCRIPTION_MAX).nullable().optional(),
});

async function setGroupScores(store: AdkarStore, p: z.infer<typeof GroupParams>) {
  return update(store, (doc, today) => {
    const i = find(doc, p.id);
    if (!i) return { result: { set: false, reason: "not_found" } };
    let groups = i.groups ?? [];
    let group = p.groupId
      ? groups.find((g) => g.id === p.groupId)
      : groups.find((g) => nameKey(g.name) === nameKey(p.name));
    if (p.groupId && !group) return { result: { set: false, reason: "group_not_found" } };
    if (!group) {
      const error = nameError(p.name ?? "", "group");
      if (error) return { result: { set: false, reason: "invalid_name", message: error } };
      group = newGroup(p.name ?? "", crypto.randomUUID());
      groups = [...groups, group];
    }
    const groupId = group.id;
    const dateError = p.assessedAt ? assessedAtError(p.assessedAt, today) : null;
    if (dateError) return { result: { set: false, reason: "invalid_date", message: dateError } };
    let next: AdkarInitiative = { ...i, groups };
    for (const el of ADKAR_ELEMENTS) {
      const v = p.scores?.[el];
      if (v === undefined) continue;
      next = withGroupScore(next, groupId, el, v as AdkarScore | null, p.assessedAt ?? today);
    }
    next = withGroupPatch(next, groupId, {
      ...(p.groupId && p.name !== undefined ? { name: p.name } : {}),
      ...(p.assessedAt !== undefined ? { assessedAt: p.assessedAt } : {}),
      ...(p.note !== undefined ? { note: p.note } : {}),
    });
    const saved = next.groups?.find((g) => g.id === groupId);
    return {
      doc: withInitiative(doc, p.id, () => next),
      result: {
        set: true,
        groupId,
        scores: saved?.scores ?? {},
        barrier: barrierPoint(saved?.scores),
        initiativeBarrier: initiativeBarrier(next),
      },
    };
  });
}

registry.register({
  id: "tool.adkar.set_group_scores",
  toolId: "tool.adkar",
  name: "set_group_scores",
  category: "write",
  requiresConfirmation: false,
  description:
    "Score a group affected by an initiative on the five elements (1-5; null clears one). Pass groupId, or a name to find the group (case-insensitive) or add it. Returns {set: false, reason: 'not_found' | 'group_not_found' | 'invalid_name' | 'invalid_date', message?} or {set: true, groupId, scores, barrier: {element, score?, unscoredBefore?}, initiativeBarrier}.",
  paramsSchema: GroupParams,
  handler: async (params) => setGroupScores(browserStore, params),
  mcpHandler: async (params, ctx) => setGroupScores(serverStore(ctx.userId), params),
});

/* ── advance / step_back ────────────────────────────────────────────── */

const MoveParams = z.object({
  id: z.string(),
  on: IsoDay.optional().describe(
    "The day it moved; defaults to today. Not before its last move, not after today."
  ),
});

async function move(
  store: AdkarStore,
  p: z.infer<typeof MoveParams>,
  direction: "advance" | "back"
) {
  return update(store, (doc, today) => {
    const i = find(doc, p.id);
    if (!i) return { result: { moved: false, reason: "not_found" } };
    const on = p.on ?? today;
    const error = moveDateError(i, on, today);
    if (error) return { result: { moved: false, reason: "invalid_date", message: error } };
    const next = direction === "advance" ? advance(i, on, today) : stepBack(i, on, today);
    if (!next) {
      return {
        result: {
          moved: false,
          reason: direction === "advance" ? "at_final_stage" : "at_first_stage",
        },
      };
    }
    return {
      doc: withInitiative(doc, p.id, () => next),
      result: {
        moved: true,
        from: i.currentStage,
        stage: next.currentStage,
        enteredAt: on,
        pastBarrier: pastBarrier(next).map((x) => ({
          groupName: x.group.name,
          barrier: x.barrier,
        })),
      },
    };
  });
}

registry.register({
  id: "tool.adkar.advance",
  toolId: "tool.adkar",
  name: "advance",
  category: "write",
  requiresConfirmation: false,
  description:
    "Move an initiative to the next stage, entered on `on` (default today; backdatable, not before its last move). pastBarrier lists groups whose barrier it has now moved past. Returns {moved: false, reason: 'not_found' | 'invalid_date' | 'at_final_stage', message?} or {moved: true, from, stage, enteredAt, pastBarrier}.",
  paramsSchema: MoveParams,
  handler: async (params) => move(browserStore, params, "advance"),
  mcpHandler: async (params, ctx) => move(serverStore(ctx.userId), params, "advance"),
});

registry.register({
  id: "tool.adkar.step_back",
  toolId: "tool.adkar",
  name: "step_back",
  category: "write",
  requiresConfirmation: false,
  description:
    "Move an initiative back a stage when adoption slipped, from `on` (default today; not before its last move). The history keeps both moves. Returns {moved: false, reason: 'not_found' | 'invalid_date' | 'at_first_stage', message?} or {moved: true, from, stage, enteredAt, pastBarrier}.",
  paramsSchema: MoveParams,
  handler: async (params) => move(browserStore, params, "back"),
  mcpHandler: async (params, ctx) => move(serverStore(ctx.userId), params, "back"),
});
