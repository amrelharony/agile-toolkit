/**
 * Interrupt Buffer — tool-local actions.
 *
 * Category: Flow & Delivery (tools plan, phase 1)
 *
 * Agent surface: tool.interrupt_buffer.*
 * Backing CRUD : workspace.interrupt_item.* (the A3 entity) and
 *                workspace.sprint.* (`Sprint.interruptBuffer`), the records
 *                the Interrupt Buffer page, Sprint Planning and the cockpit
 *                read. Status comes from lib/sprints/interrupts
 *                (`interruptBufferStatus`), as on the page.
 *
 *   1. list_state     — a sprint's buffer, what its interrupts used, the
 *                       state (ok / watch / over) and the Emergency
 *                       Procedure when it is over, the interrupts, and every
 *                       sprint's history.
 *   2. set_buffer     — set or clear a sprint's buffer (a share or points).
 *   3. log_interrupt  — log unplanned work in a sprint; its kind defaults to
 *                       the keyword reading of its title.
 *   4. resolve        — mark an interrupt resolved, or reopen it.
 *   5. classify       — read only: kinds and guessed sizes for titles, by
 *                       the page's keyword rules (no AI).
 */

import { nanoid } from "nanoid";
import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import {
  INTERRUPT_ITEM_KIND,
  INTERRUPT_KINDS,
  TOOL_TEXT_MAX,
  type InterruptItem,
  type Sprint,
} from "@/lib/stores/workspace-types";
import { pickDefaultSprint } from "@/lib/sprints/series";
import { isExampleId } from "@/lib/utils/example-id";
import {
  BUFFER_PCT_MAX,
  EMERGENCY_STEPS,
  INTERRUPT_SIZE_MAX,
  bufferHistory,
  bufferLabel,
  classifyInterrupt,
  cleanBuffer,
  interruptBufferStatus,
  sprintInterrupts,
} from "@/lib/sprints/interrupts";

const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

interface BufferStore {
  sprints: () => Promise<Sprint[]>;
  putSprint: (s: Sprint) => Promise<void>;
  items: () => Promise<InterruptItem[]>;
  getItem: (id: string) => Promise<InterruptItem | null>;
  putItem: (i: InterruptItem) => Promise<void>;
}

const browserStore: BufferStore = {
  sprints: async () => ws().sprints ?? [],
  putSprint: async (s) => ws().upsertSprint(s),
  items: async () => ws().interruptItems ?? [],
  getItem: async (id) => (ws().interruptItems ?? []).find((i) => i.id === id) ?? null,
  putItem: async (i) => ws().upsertInterruptItem(i),
};

const serverStore = (userId: string): BufferStore => ({
  sprints: () => serverListEntities<Sprint>(userId, KIND_SPRINT),
  putSprint: async (s) => {
    await serverUpsertEntity<Sprint>(userId, KIND_SPRINT, s);
  },
  items: () => serverListEntities<InterruptItem>(userId, INTERRUPT_ITEM_KIND),
  getItem: (id) => serverGetEntity<InterruptItem>(userId, INTERRUPT_ITEM_KIND, id),
  putItem: async (i) => {
    await serverUpsertEntity<InterruptItem>(userId, INTERRUPT_ITEM_KIND, i);
  },
});

const SprintIdParam = z
  .string()
  .min(1)
  .optional()
  .describe("The sprint. Omit for the active one (else the newest that isn't cancelled).");

const real = <T extends { id: string }>(xs: readonly T[]) => xs.filter((x) => !isExampleId(x.id));

/** The sprint named, else the one the pages open on. */
async function sprintFor(store: BufferStore, sprintId?: string): Promise<Sprint | undefined> {
  const sprints = real(await store.sprints());
  return sprintId ? sprints.find((s) => s.id === sprintId) : pickDefaultSprint(sprints, null);
}

async function listState(store: BufferStore, sprintId?: string) {
  const sprints = real(await store.sprints());
  const items = real(await store.items());
  const sprint = sprintId
    ? sprints.find((s) => s.id === sprintId)
    : pickDefaultSprint(sprints, null);
  const status = sprint ? interruptBufferStatus(sprint, items) : null;
  return {
    sprint: sprint
      ? { id: sprint.id, name: sprint.name, status: sprint.status, buffer: bufferLabel(sprint) }
      : null,
    status,
    emergencyProcedure: status?.over ? EMERGENCY_STEPS : null,
    interrupts: sprint ? sprintInterrupts(items, sprint.id) : [],
    unassigned: items.filter((i) => !i.sprintId).length,
    history: bufferHistory(sprints, items).map((r) => ({
      sprintId: r.sprint.id,
      name: r.sprint.name,
      bufferPoints: r.status.bufferPoints,
      usedPoints: r.status.usedPoints,
      total: r.status.total,
      state: r.status.state,
    })),
  };
}

// ──────── tool.interrupt_buffer.list_state ────────
registry.register({
  id: "tool.interrupt_buffer.list_state",
  toolId: "tool.interrupt_buffer",
  name: "list_state",
  category: "read",
  description:
    "Read a sprint's interrupt buffer as the page shows it. Returns {sprint: {id, name, status, buffer (label)} | null, status: {bufferPoints | null, usedPoints, leftPoints | null, usedShare | null, state: none|ok|watch|over, over, total, open, resolved, emergencies, unsized, byKind, summary} | null, emergencyProcedure: {id, title, detail}[] | null (when over), interrupts: InterruptItem[] (newest first), unassigned (logged with no sprint), history: {sprintId, name, bufferPoints, usedPoints, total, state}[]}. Every interrupt in the sprint uses the buffer, open or resolved.",
  paramsSchema: z.object({ sprintId: SprintIdParam }),
  handler: async ({ sprintId }) => listState(browserStore, sprintId),
  mcpHandler: async ({ sprintId }, ctx) => listState(serverStore(ctx.userId), sprintId),
});

// ──────── tool.interrupt_buffer.set_buffer ────────
const BufferParams = z
  .object({
    sprintId: SprintIdParam,
    pct: z
      .number()
      .gt(0)
      .max(BUFFER_PCT_MAX)
      .optional()
      .describe(`A share of the sprint's planned points, 1–${BUFFER_PCT_MAX}.`),
    points: z.number().min(0).optional().describe("The buffer in points (wins over pct)."),
    clear: z.boolean().optional().describe("Remove the sprint's buffer."),
  })
  .refine((p) => p.clear || p.pct !== undefined || p.points !== undefined, {
    message: "Give pct, points, or clear: true.",
  });

async function setBuffer(store: BufferStore, p: z.infer<typeof BufferParams>) {
  const sprint = await sprintFor(store, p.sprintId);
  if (!sprint) return { updated: false as const, reason: "No such sprint." };
  const buffer = p.clear
    ? undefined
    : cleanBuffer({
        ...(p.pct !== undefined ? { pct: p.pct } : {}),
        ...(p.points !== undefined ? { points: p.points } : {}),
      });
  const next: Sprint = { ...sprint };
  if (buffer) next.interruptBuffer = buffer;
  else delete next.interruptBuffer;
  await store.putSprint(next);
  return { updated: true as const, sprintId: sprint.id, buffer: bufferLabel(next) };
}

registry.register({
  id: "tool.interrupt_buffer.set_buffer",
  toolId: "tool.interrupt_buffer",
  name: "set_buffer",
  category: "write",
  description:
    "Set a sprint's interrupt buffer: pct (a share of its planned points) and/or points (wins when both), or clear: true to remove it. Returns {updated: true, sprintId, buffer (label)} or {updated: false, reason}.",
  paramsSchema: BufferParams,
  handler: async (p) => setBuffer(browserStore, p),
  mcpHandler: async (p, ctx) => setBuffer(serverStore(ctx.userId), p),
});

// ──────── tool.interrupt_buffer.log_interrupt ────────
const LogParams = z.object({
  title: z.string().trim().min(1).max(TOOL_TEXT_MAX.text).describe("What came in."),
  kind: z
    .enum(INTERRUPT_KINDS)
    .optional()
    .describe("bug | support | request | incident | other. Omit to read it from the title."),
  size: z.number().min(0).max(INTERRUPT_SIZE_MAX).optional().describe("Its size in points."),
  emergency: z.boolean().optional().describe("It couldn't wait: the team stopped other work."),
  sprintId: SprintIdParam,
});

async function logInterrupt(store: BufferStore, p: z.infer<typeof LogParams>) {
  const sprint = await sprintFor(store, p.sprintId);
  if (p.sprintId && !sprint) return { logged: false as const, reason: "No such sprint." };
  const guess = classifyInterrupt(p.title);
  const item: InterruptItem = {
    id: `interrupt_${nanoid(8)}`,
    ...(sprint ? { sprintId: sprint.id } : {}),
    title: p.title.replace(/\s+/g, " "),
    kind: p.kind ?? guess.kind,
    ...(p.size !== undefined ? { size: p.size } : {}),
    emergency: p.emergency ?? false,
    loggedAt: new Date().toISOString(),
  };
  await store.putItem(item);
  // Counted once, whether or not the store's list already holds the new row.
  const others = sprint ? (await store.items()).filter((i) => i.id !== item.id) : [];
  const status = sprint ? interruptBufferStatus(sprint, [...real(others), item]) : null;
  return {
    logged: true as const,
    id: item.id,
    kind: item.kind,
    sprintId: item.sprintId ?? null,
    status: status ? { state: status.state, over: status.over, summary: status.summary } : null,
  };
}

registry.register({
  id: "tool.interrupt_buffer.log_interrupt",
  toolId: "tool.interrupt_buffer",
  name: "log_interrupt",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log unplanned work that landed in a sprint (default: the active one). kind defaults to a keyword reading of the title. Returns {logged: true, id, kind, sprintId, status: {state, over, summary} | null}; when status.over, the buffer is spent: suggest the Emergency Procedure (list_state).",
  paramsSchema: LogParams,
  handler: async (p) => logInterrupt(browserStore, p),
  mcpHandler: async (p, ctx) => logInterrupt(serverStore(ctx.userId), p),
});

// ──────── tool.interrupt_buffer.resolve ────────
const ResolveParams = z.object({
  id: z.string().min(1),
  reopen: z.boolean().optional().describe("Reopen a resolved interrupt instead."),
});

async function resolve(store: BufferStore, p: z.infer<typeof ResolveParams>) {
  const current = await store.getItem(p.id);
  if (!current) return { updated: false as const };
  const { resolvedAt: _was, ...open } = current;
  void _was;
  const next: InterruptItem = p.reopen ? open : { ...open, resolvedAt: new Date().toISOString() };
  await store.putItem(next);
  return { updated: true as const, resolved: Boolean(next.resolvedAt) };
}

registry.register({
  id: "tool.interrupt_buffer.resolve",
  toolId: "tool.interrupt_buffer",
  name: "resolve",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark an interrupt resolved now, or reopen it (reopen: true). It still counts against its sprint's buffer either way. Returns {updated: true, resolved} or {updated: false} for an unknown id.",
  paramsSchema: ResolveParams,
  handler: async (p) => resolve(browserStore, p),
  mcpHandler: async (p, ctx) => resolve(serverStore(ctx.userId), p),
});

// ──────── tool.interrupt_buffer.classify ────────
registry.register({
  id: "tool.interrupt_buffer.classify",
  toolId: "tool.interrupt_buffer",
  name: "classify",
  category: "read",
  description:
    "Suggest a kind (bug | support | request | incident | other) and, when a word says, a size in points for each interrupt title, by the page's keyword rules. Nothing is saved. Returns {items: {title, kind, size?}[]}.",
  paramsSchema: z.object({ titles: z.array(z.string().trim().min(1).max(300)).min(1).max(20) }),
  handler: async ({ titles }) => ({
    items: titles.map((title) => ({ title, ...classifyInterrupt(title) })),
  }),
});
