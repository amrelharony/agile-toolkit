/**
 * Post-mortem — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     Blameless post-mortems: factors, timeline, action items, publish.
 *
 * Agent surface: tool.post_mortem.*
 * Backing CRUD : workspace.post_mortem.* (auto-generated). Singleton: one
 *                PostMortemLog document (postmortems[]) under a fixed id.
 *
 *   1. list_state          — post-mortems + status tallies + open/overdue actions.
 *   2. add_postmortem      — create a draft (stamps createdAt).
 *   3. set_status          — draft/review/published (publish stamps publishedAt).
 *   4. add_factor          — append a contributing factor.
 *   5. add_action          — add an action item (status open).
 *   6. update_action       — patch an action's status/owner/dueDate.
 *   7. add_timeline_entry  — append a timeline note.
 *   8. remove_postmortem   — delete a post-mortem by id.
 *
 * Entity kind "workspace:postMortem" + the fixed PM_ID match
 * post-mortem-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type {
  PostMortemLog,
  PostMortem,
  PostMortemAction,
  PostMortemTimelineEntry,
} from "@/lib/stores/workspace-types";

const KIND_PM = "workspace:postMortem";
// MUST match PM_ID in post-mortem-client.tsx.
const PM_ID = "postMortem:current";

const ws = () => useWorkspaceStore.getState();

const nowISO = () => new Date().toISOString();
// Local calendar day, like the post-mortem UI (helpers.ts todayIso): the UTC
// day put a new post-mortem on the wrong date near midnight and shifted
// "overdue" by a day.
const todayISO = () => todayLocalISO();

function isOverdue(a: PostMortemAction): boolean {
  if (a.status === "done" || !a.dueDate) return false;
  return a.dueDate < todayISO();
}

function emptyDoc(): PostMortemLog {
  return { id: PM_ID, postmortems: [] };
}

function browserDoc(): PostMortemLog | null {
  return (ws().postMortemLogs ?? []).find((d) => d.id === PM_ID) ?? null;
}

function summarize(doc: PostMortemLog | null) {
  const pms = doc?.postmortems ?? [];
  const byStatus = { draft: 0, review: 0, published: 0 };
  let openActions = 0;
  let overdueActions = 0;
  for (const pm of pms) {
    byStatus[pm.status]++;
    for (const a of pm.actions) {
      if (a.status !== "done") openActions++;
      if (isOverdue(a)) overdueActions++;
    }
  }
  return {
    exists: doc !== null,
    total: pms.length,
    byStatus,
    openActions,
    overdueActions,
    postmortems: pms.map((pm) => ({
      id: pm.id,
      title: pm.title,
      incidentDate: pm.incidentDate,
      status: pm.status,
      factorCount: pm.contributingFactors.length,
      timelineCount: pm.timeline.length,
      actionCount: pm.actions.length,
      openActionCount: pm.actions.filter((a) => a.status !== "done").length,
      createdAt: pm.createdAt,
      publishedAt: pm.publishedAt,
    })),
  };
}

// ──────── tool.post_mortem.list_state ────────
registry.register({
  id: "tool.post_mortem.list_state",
  toolId: "tool.post_mortem",
  name: "list_state",
  category: "read",
  description:
    "Summarise post-mortems. Returns {exists, total, byStatus:{draft,review,published}, openActions (status≠done), overdueActions (open & past dueDate), postmortems:{id,title,incidentDate,status,factorCount,timelineCount,actionCount,openActionCount,createdAt,publishedAt}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    return summarize(doc ?? null);
  },
});

const addParams = z.object({
  title: z.string().min(1).max(240),
  incidentDate: z.string().max(40).optional(),
  description: z.string().max(4000).optional(),
});

// ──────── tool.post_mortem.add_postmortem ────────
registry.register({
  id: "tool.post_mortem.add_postmortem",
  toolId: "tool.post_mortem",
  name: "add_postmortem",
  category: "write",
  requiresConfirmation: false,
  description:
    "Create a post-mortem (status 'draft', stamps createdAt). incidentDate defaults to today (YYYY-MM-DD). Returns {added: false} when the title is blank, else {added: true, id}.",
  paramsSchema: addParams,
  handler: async (params) => {
    if (!params.title.trim()) return { added: false };
    const base = browserDoc() ?? emptyDoc();
    const pm = newPostMortem(params);
    ws().upsertPostMortemLog({ ...base, id: PM_ID, postmortems: [pm, ...base.postmortems] });
    return { added: true, id: pm.id };
  },
  mcpHandler: async (params, ctx) => {
    // Whitespace-only passes min(1); the UI trims and refuses a blank title.
    if (!params.title.trim()) return { added: false };
    const base = (await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID)) ?? emptyDoc();
    const pm = newPostMortem(params);
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, {
      ...base,
      id: PM_ID,
      postmortems: [pm, ...base.postmortems],
    });
    return { added: true, id: pm.id };
  },
});

const statusParams = z.object({
  postmortemId: z.string(),
  status: z.enum(["draft", "review", "published"]),
});

// ──────── tool.post_mortem.set_status ────────
registry.register({
  id: "tool.post_mortem.set_status",
  toolId: "tool.post_mortem",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a post-mortem's status. Moving to 'published' stamps publishedAt (now) if unset. Returns {updated: false} when the id is unknown.",
  paramsSchema: statusParams,
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertPostMortemLog(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const next = applyStatus(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, next);
    return { updated: true };
  },
});

const factorParams = z.object({
  postmortemId: z.string(),
  text: z.string().min(1).max(1000),
});

// ──────── tool.post_mortem.add_factor ────────
registry.register({
  id: "tool.post_mortem.add_factor",
  toolId: "tool.post_mortem",
  name: "add_factor",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a contributing factor to a post-mortem. Returns {added: false} when the id is unknown or the text is blank.",
  paramsSchema: factorParams,
  handler: async (params) => {
    const next = applyFactor(browserDoc(), params);
    if (!next) return { added: false };
    ws().upsertPostMortemLog(next);
    return { added: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const next = applyFactor(base ?? null, params);
    if (!next) return { added: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, next);
    return { added: true };
  },
});

const actionParams = z.object({
  postmortemId: z.string(),
  text: z.string().min(1).max(2000),
  owner: z.string().max(120).optional(),
  dueDate: z.string().max(40).optional(),
});

// ──────── tool.post_mortem.add_action ────────
registry.register({
  id: "tool.post_mortem.add_action",
  toolId: "tool.post_mortem",
  name: "add_action",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add an action item (status 'open') to a post-mortem. Returns {added: false} when the id is unknown or the text is blank, else {added: true, id}.",
  paramsSchema: actionParams,
  handler: async (params) => {
    const r = applyAddAction(browserDoc(), params);
    if (!r) return { added: false };
    ws().upsertPostMortemLog(r.doc);
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const r = applyAddAction(base ?? null, params);
    if (!r) return { added: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, r.doc);
    return { added: true, id: r.id };
  },
});

const updateActionParams = z.object({
  postmortemId: z.string(),
  actionId: z.string(),
  status: z.enum(["open", "in_progress", "done"]).optional(),
  owner: z.string().max(120).optional(),
  dueDate: z.string().max(40).optional(),
});

// ──────── tool.post_mortem.update_action ────────
registry.register({
  id: "tool.post_mortem.update_action",
  toolId: "tool.post_mortem",
  name: "update_action",
  category: "write",
  requiresConfirmation: false,
  description:
    "Patch an action item's status (open/in_progress/done), owner, and/or dueDate. Returns {updated: false} when the post-mortem or action id is unknown.",
  paramsSchema: updateActionParams,
  handler: async (params) => {
    const next = applyUpdateAction(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertPostMortemLog(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const next = applyUpdateAction(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, next);
    return { updated: true };
  },
});

const timelineParams = z.object({
  postmortemId: z.string(),
  text: z.string().min(1).max(2000),
  author: z.string().max(80).optional(),
});

// ──────── tool.post_mortem.add_timeline_entry ────────
registry.register({
  id: "tool.post_mortem.add_timeline_entry",
  toolId: "tool.post_mortem",
  name: "add_timeline_entry",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a timeline note to a post-mortem (ts now; author defaults to 'agent'). Returns {added: false} when the id is unknown or the text is blank, else {added: true, id}.",
  paramsSchema: timelineParams,
  handler: async (params) => {
    const r = applyTimeline(browserDoc(), params);
    if (!r) return { added: false };
    ws().upsertPostMortemLog(r.doc);
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const r = applyTimeline(base ?? null, params);
    if (!r) return { added: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, r.doc);
    return { added: true, id: r.id };
  },
});

// ──────── tool.post_mortem.remove_postmortem ────────
registry.register({
  id: "tool.post_mortem.remove_postmortem",
  toolId: "tool.post_mortem",
  name: "remove_postmortem",
  category: "write",
  requiresConfirmation: false,
  description: "Delete a post-mortem by id. Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ postmortemId: z.string() }),
  handler: async (params) => {
    const next = applyRemove(browserDoc(), params.postmortemId);
    if (!next) return { removed: false };
    ws().upsertPostMortemLog(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<PostMortemLog>(ctx.userId, KIND_PM, PM_ID);
    const next = applyRemove(base ?? null, params.postmortemId);
    if (!next) return { removed: false };
    await serverUpsertEntity<PostMortemLog>(ctx.userId, KIND_PM, next);
    return { removed: true };
  },
});

function newPostMortem(params: z.infer<typeof addParams>): PostMortem {
  return {
    id: crypto.randomUUID(),
    title: params.title.trim(),
    incidentDate: params.incidentDate || todayISO(),
    status: "draft",
    contributingFactors: [],
    timeline: [],
    actions: [],
    description: params.description,
    createdAt: nowISO(),
  };
}

function mapPm(
  doc: PostMortemLog | null,
  postmortemId: string,
  fn: (pm: PostMortem) => PostMortem
): PostMortemLog | null {
  if (!doc || !doc.postmortems.some((p) => p.id === postmortemId)) return null;
  return {
    ...doc,
    postmortems: doc.postmortems.map((p) => (p.id === postmortemId ? fn(p) : p)),
  };
}

function applyStatus(
  doc: PostMortemLog | null,
  params: z.infer<typeof statusParams>
): PostMortemLog | null {
  return mapPm(doc, params.postmortemId, (pm) => {
    const patch: Partial<PostMortem> = { status: params.status };
    if (params.status === "published" && !pm.publishedAt) patch.publishedAt = nowISO();
    return { ...pm, ...patch };
  });
}

function applyFactor(
  doc: PostMortemLog | null,
  params: z.infer<typeof factorParams>
): PostMortemLog | null {
  // Whitespace-only text passes min(1); refuse it like the UI does.
  const text = params.text.trim();
  if (!text) return null;
  return mapPm(doc, params.postmortemId, (pm) => ({
    ...pm,
    contributingFactors: [...pm.contributingFactors, text],
  }));
}

function applyAddAction(
  doc: PostMortemLog | null,
  params: z.infer<typeof actionParams>
): { doc: PostMortemLog; id: string } | null {
  const text = params.text.trim();
  if (!text) return null;
  const action: PostMortemAction = {
    id: crypto.randomUUID(),
    text,
    owner: params.owner,
    dueDate: params.dueDate,
    status: "open",
  };
  const next = mapPm(doc, params.postmortemId, (pm) => ({
    ...pm,
    actions: [...pm.actions, action],
  }));
  return next ? { doc: next, id: action.id } : null;
}

function applyUpdateAction(
  doc: PostMortemLog | null,
  params: z.infer<typeof updateActionParams>
): PostMortemLog | null {
  if (!doc) return null;
  const pm = doc.postmortems.find((p) => p.id === params.postmortemId);
  if (!pm || !pm.actions.some((a) => a.id === params.actionId)) return null;
  return mapPm(doc, params.postmortemId, (p) => ({
    ...p,
    actions: p.actions.map((a) =>
      a.id === params.actionId
        ? {
            ...a,
            ...(params.status !== undefined ? { status: params.status } : {}),
            ...(params.owner !== undefined ? { owner: params.owner } : {}),
            ...(params.dueDate !== undefined ? { dueDate: params.dueDate } : {}),
          }
        : a
    ),
  }));
}

function applyTimeline(
  doc: PostMortemLog | null,
  params: z.infer<typeof timelineParams>
): { doc: PostMortemLog; id: string } | null {
  const text = params.text.trim();
  if (!text) return null;
  const entry: PostMortemTimelineEntry = {
    id: crypto.randomUUID(),
    ts: nowISO(),
    author: params.author?.trim() || "agent",
    text,
  };
  const next = mapPm(doc, params.postmortemId, (pm) => ({
    ...pm,
    timeline: [...pm.timeline, entry],
  }));
  return next ? { doc: next, id: entry.id } : null;
}

function applyRemove(doc: PostMortemLog | null, postmortemId: string): PostMortemLog | null {
  if (!doc || !doc.postmortems.some((p) => p.id === postmortemId)) return null;
  return { ...doc, postmortems: doc.postmortems.filter((p) => p.id !== postmortemId) };
}
