/**
 * RACI Matrix Builder — tool-local actions.
 *
 * Category: Team Health & Maturity
 * Tool:     Who is Responsible, Accountable, Consulted or Informed for each
 *           activity; columns are roster people or group roles, and a cell
 *           can be A and R at once.
 *
 * Agent surface: tool.raci.*
 * Backing CRUD : workspace.raci_matrix.* (auto-generated). Singleton: one
 *                RaciMatrix document under RACI_ID.
 *
 *   1. list_state      — the matrix, the checks, the load warnings, the verdict.
 *   2. add_role        — add a column (a roster person, or a group role).
 *   3. add_activity    — add a row.
 *   4. set_cell        — set one cell's letters.
 *   5. rename          — rename a column or a row.
 *   6. remove_role     — remove a column and its cells.
 *   7. remove_activity — remove a row and its cells.
 *   8. reset           — clear the matrix (asks for confirmation).
 *
 * Every check comes from lib/raci/model, as on the page.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { RaciMatrix, RaciRole, TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember } from "@/lib/team/names";
import {
  RACI_DESCRIPTION_MAX,
  RACI_ID,
  RACI_KIND,
  RACI_LOAD,
  RACI_NAME_MAX,
  activityIssues,
  cellOf,
  cellText,
  countsByRole,
  emptyRaci,
  loadWarnings,
  nameTaken,
  normalizeCell,
  normalizeRaci,
  raciVerdict,
  unassignedActivities,
  withActivity,
  withCell,
  withRole,
  withoutActivity,
  withoutRole,
} from "@/lib/raci/model";

/** MUST match registerCollection("teamMember", …) in workspace-store.ts. */
const KIND_MEMBER = "workspace:teamMember";

const ws = () => useWorkspaceStore.getState();

/** Where the matrix lives: the browser's workspace, or the user's rows on the server. */
interface RaciStore {
  getDoc(): Promise<RaciMatrix | null>;
  putDoc(doc: RaciMatrix): Promise<void>;
  roster(): Promise<TeamMember[]>;
}

const browserStore: RaciStore = {
  getDoc: async () => (ws().raciMatrices ?? []).find((d) => d.id === RACI_ID) ?? null,
  putDoc: async (doc) => ws().upsertRaciMatrix(doc),
  roster: async () => ws().teamMembers ?? [],
};

function serverStore(userId: string): RaciStore {
  return {
    getDoc: async () => (await serverGetEntity<RaciMatrix>(userId, RACI_KIND, RACI_ID)) ?? null,
    putDoc: async (doc) => {
      await serverUpsertEntity<RaciMatrix>(userId, RACI_KIND, doc);
    },
    roster: async () => serverListEntities<TeamMember>(userId, KIND_MEMBER),
  };
}

/** Change the matrix with `fn` (as the page reads it); a refusal writes nothing. */
async function change<T extends Record<string, unknown>>(
  store: RaciStore,
  fn: (doc: RaciMatrix) => { doc: RaciMatrix; result: T } | { refuse: T }
): Promise<T> {
  const out = fn(normalizeRaci((await store.getDoc()) ?? emptyRaci()));
  if ("refuse" in out) return out.refuse;
  await store.putDoc({ ...out.doc, id: RACI_ID });
  return out.result;
}

/* ── list_state ─────────────────────────────────────────────────────── */

function summarize(raw: RaciMatrix | null, roster: readonly TeamMember[]) {
  const doc = normalizeRaci(raw ?? emptyRaci());
  return {
    exists: raw !== null,
    roles: doc.roles.map((r) => ({
      ...r,
      // A person's column: whether they are still on the roster.
      ...(r.memberId ? { onTeam: roster.some((m) => m.id === r.memberId) } : {}),
    })),
    activities: doc.activities,
    cells: doc.cells,
    matrix: doc.activities.map((a) => ({
      activityId: a.id,
      activity: a.name,
      cells: Object.fromEntries(doc.roles.map((r) => [r.id, cellText(cellOf(doc, a.id, r.id))])),
    })),
    issues: activityIssues(doc).map(({ kind, activityId, message }) => ({
      kind,
      activityId,
      message,
    })),
    loadWarnings: loadWarnings(doc).map(({ kind, roleId, activityId, count, of, message }) => ({
      kind,
      ...(roleId ? { roleId } : {}),
      ...(activityId ? { activityId } : {}),
      count,
      of,
      message,
    })),
    thresholds: RACI_LOAD,
    unassigned: unassignedActivities(doc).map((a) => a.id),
    countsByRole: countsByRole(doc),
    verdict: raciVerdict(doc),
  };
}

registry.register({
  id: "tool.raci.list_state",
  toolId: "tool.raci",
  name: "list_state",
  category: "read",
  description:
    "The RACI matrix with the page's checks. Returns {exists, roles: {id, name, description?, memberId? (a roster person), onTeam? (still on the roster)}[], activities: {id, name, description?}[], cells: {activityId: {roleId: ('R'|'A'|'C'|'I')[]}} (normalised: [R], [A], [A,R], [C] or [I]; a missing cell is empty), matrix: {activityId, activity, cells: {roleId: 'A/R' | 'C' | ''}}[], issues: {kind: 'no_a' | 'many_a' | 'no_r', activityId, message}[] (assigned activities only; A/R counts as both), loadWarnings: {kind: 'accountable_load' | 'consulted_load', roleId?, activityId?, count, of, message}[], thresholds: {maxAccountableShare, minActivitiesForShare, maxConsulted}, unassigned (activity ids nobody is assigned to), countsByRole: {roleId, name, memberId?, R, A, C, I}[], verdict}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.getDoc(), await browserStore.roster()),
  mcpHandler: async (_params, ctx) => {
    const store = serverStore(ctx.userId);
    return summarize(await store.getDoc(), await store.roster());
  },
});

/* ── Rows and columns ───────────────────────────────────────────────── */

const NameParam = z.string().trim().min(1).max(RACI_NAME_MAX);
const DescriptionParam = z.string().trim().max(RACI_DESCRIPTION_MAX).optional();

const AddRoleParams = z.object({
  name: NameParam.describe(
    "A roster member's name links the column to them; any other name is a group role."
  ),
  memberId: z.string().min(1).optional().describe("A TeamMember id; its name is used."),
  description: DescriptionParam,
});

async function addRole(store: RaciStore, params: z.infer<typeof AddRoleParams>) {
  const roster = await store.roster();
  const member = params.memberId
    ? roster.find((m) => m.id === params.memberId)
    : findRosterMember(roster, params.name);
  if (params.memberId && !member) return { added: false, reason: "unknown_member" };
  return change(store, (doc) => {
    const name = member?.name ?? params.name;
    if (nameTaken(doc.roles, name) || (member && doc.roles.some((r) => r.memberId === member.id))) {
      return { refuse: { added: false, reason: "duplicate" } };
    }
    const role: RaciRole = {
      id: `raci_role_${nanoid(8)}`,
      name,
      ...(member ? { memberId: member.id } : {}),
      ...(params.description ? { description: params.description } : {}),
    };
    return {
      doc: withRole(doc, role),
      result: { added: true, id: role.id, name, memberId: member?.id ?? null },
    };
  });
}

registry.register({
  id: "tool.raci.add_role",
  toolId: "tool.raci",
  name: "add_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a column. Params: name (a roster member's name, matched case-insensitively, links the column to them; any other name, e.g. 'Dev Team', is a group role), memberId? (a TeamMember id, taking their name), description?. Creates the matrix if absent. Returns {added: true, id, name, memberId (null for a group role)}, or {added: false, reason: 'duplicate' | 'unknown_member'}.",
  paramsSchema: AddRoleParams,
  handler: async (params) => addRole(browserStore, params),
  mcpHandler: async (params, ctx) => addRole(serverStore(ctx.userId), params),
});

const AddActivityParams = z.object({ name: NameParam, description: DescriptionParam });

async function addActivity(store: RaciStore, params: z.infer<typeof AddActivityParams>) {
  return change(store, (doc) => {
    if (nameTaken(doc.activities, params.name)) {
      return { refuse: { added: false, reason: "duplicate" } };
    }
    const activity = {
      id: `raci_act_${nanoid(8)}`,
      name: params.name,
      ...(params.description ? { description: params.description } : {}),
    };
    return { doc: withActivity(doc, activity), result: { added: true, id: activity.id } };
  });
}

registry.register({
  id: "tool.raci.add_activity",
  toolId: "tool.raci",
  name: "add_activity",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a row (an activity). Params: name, description?. Returns {added: true, id}, or {added: false, reason: 'duplicate'}.",
  paramsSchema: AddActivityParams,
  handler: async (params) => addActivity(browserStore, params),
  mcpHandler: async (params, ctx) => addActivity(serverStore(ctx.userId), params),
});

const SetCellParams = z.object({
  activityId: z.string().min(1),
  roleId: z.string().min(1),
  letters: z
    .array(z.enum(["R", "A", "C", "I"]))
    .max(4)
    .describe(
      "[] clears the cell; ['A','R'] is Accountable and Responsible. C or I with R or A is dropped."
    ),
});

async function setCell(store: RaciStore, params: z.infer<typeof SetCellParams>) {
  return change(store, (doc) => {
    if (!doc.activities.some((a) => a.id === params.activityId)) {
      return { refuse: { updated: false, reason: "unknown_activity" } };
    }
    if (!doc.roles.some((r) => r.id === params.roleId)) {
      return { refuse: { updated: false, reason: "unknown_role" } };
    }
    const next = withCell(doc, params.activityId, params.roleId, params.letters);
    return {
      doc: next,
      result: {
        updated: true,
        letters: normalizeCell(params.letters),
        issues: activityIssues(next)
          .filter((i) => i.activityId === params.activityId)
          .map((i) => i.message),
      },
    };
  });
}

registry.register({
  id: "tool.raci.set_cell",
  toolId: "tool.raci",
  name: "set_cell",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set one cell's letters (ids from list_state). Params: activityId, roleId, letters: ('R'|'A'|'C'|'I')[]. Letters are normalised as on the page: A and R can go together; C or I stand alone and are dropped when given with R or A; [] clears it. Returns {updated: true, letters (as saved), issues (that activity's remaining issues)}, or {updated: false, reason: 'unknown_activity' | 'unknown_role'}.",
  paramsSchema: SetCellParams,
  handler: async (params) => setCell(browserStore, params),
  mcpHandler: async (params, ctx) => setCell(serverStore(ctx.userId), params),
});

const RenameParams = z.object({
  kind: z.enum(["role", "activity"]),
  id: z.string().min(1),
  name: NameParam,
});

async function rename(store: RaciStore, params: z.infer<typeof RenameParams>) {
  const roster = params.kind === "role" ? await store.roster() : [];
  return change(store, (doc) => {
    const rows = params.kind === "role" ? doc.roles : doc.activities;
    if (!rows.some((r) => r.id === params.id))
      return { refuse: { renamed: false, reason: "not_found" } };
    if (
      nameTaken(
        rows.filter((r) => r.id !== params.id),
        params.name
      )
    ) {
      return { refuse: { renamed: false, reason: "duplicate" } };
    }
    if (params.kind === "activity") {
      return {
        doc: {
          ...doc,
          activities: doc.activities.map((a) =>
            a.id === params.id ? { ...a, name: params.name } : a
          ),
        },
        result: { renamed: true },
      };
    }
    // A column follows a roster person by name, as on the page.
    const member = findRosterMember(roster, params.name);
    return {
      doc: {
        ...doc,
        roles: doc.roles.map((r) => {
          if (r.id !== params.id) return r;
          const next: RaciRole = { ...r, name: member?.name ?? params.name };
          if (member) next.memberId = member.id;
          else delete next.memberId;
          return next;
        }),
      },
      result: { renamed: true, memberId: member?.id ?? null },
    };
  });
}

registry.register({
  id: "tool.raci.rename",
  toolId: "tool.raci",
  name: "rename",
  category: "write",
  requiresConfirmation: false,
  description:
    "Rename a column (kind 'role') or a row (kind 'activity'). A column renamed to a roster member's name links to them, any other name makes it a group role. Returns {renamed: true, memberId? (roles)}, or {renamed: false, reason: 'not_found' | 'duplicate'}.",
  paramsSchema: RenameParams,
  handler: async (params) => rename(browserStore, params),
  mcpHandler: async (params, ctx) => rename(serverStore(ctx.userId), params),
});

async function removeRow(store: RaciStore, kind: "role" | "activity", id: string) {
  return change(store, (doc) => {
    const rows = kind === "role" ? doc.roles : doc.activities;
    if (!rows.some((r) => r.id === id)) return { refuse: { removed: false, reason: "not_found" } };
    return {
      doc: kind === "role" ? withoutRole(doc, id) : withoutActivity(doc, id),
      result: { removed: true },
    };
  });
}

registry.register({
  id: "tool.raci.remove_role",
  toolId: "tool.raci",
  name: "remove_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a column by id, with its cells. Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => removeRow(browserStore, "role", params.id),
  mcpHandler: async (params, ctx) => removeRow(serverStore(ctx.userId), "role", params.id),
});

registry.register({
  id: "tool.raci.remove_activity",
  toolId: "tool.raci",
  name: "remove_activity",
  category: "write",
  requiresConfirmation: false,
  description:
    "Remove a row by id, with its cells. Returns {removed: true}, or {removed: false, reason: 'not_found'}.",
  paramsSchema: z.object({ id: z.string().min(1) }),
  handler: async (params) => removeRow(browserStore, "activity", params.id),
  mcpHandler: async (params, ctx) => removeRow(serverStore(ctx.userId), "activity", params.id),
});

async function reset(store: RaciStore) {
  const before = normalizeRaci((await store.getDoc()) ?? emptyRaci());
  await store.putDoc(emptyRaci());
  return { reset: true, roles: before.roles.length, activities: before.activities.length };
}

registry.register({
  id: "tool.raci.reset",
  toolId: "tool.raci",
  name: "reset",
  category: "write",
  requiresConfirmation: true,
  description:
    "Clear the whole matrix: every column, row and cell. The page's Clear the matrix offers Undo; this does not. Returns {reset: true, roles, activities} (what was cleared).",
  paramsSchema: z.object({}),
  handler: async () => reset(browserStore),
  mcpHandler: async (_params, ctx) => reset(serverStore(ctx.userId)),
});
