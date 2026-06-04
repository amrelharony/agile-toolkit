import { z } from "zod";
import { registry } from "./registry";
import {
  serverListEntities,
  serverGetEntity,
  serverUpsertEntity,
  serverVersionedUpdate,
  serverDeleteEntity,
  kindFromToolId,
} from "./server-store";

/**
 * Generate the four standard CRUD actions for a workspace entity in
 * one call. Saves writing ~120 boilerplate handlers across the ~30
 * workspace collections.
 *
 * Example:
 *
 *   defineCrudActions({
 *     toolId: "workspace.sprint",
 *     schema: SprintSchema,
 *     selectAll: () => useWorkspaceStore.getState().sprints,
 *     upsert: (s) => useWorkspaceStore.getState().upsertSprint(s),
 *     remove: (id) => useWorkspaceStore.getState().removeSprint(id),
 *   });
 *
 * Registers four actions:
 *   workspace.sprint.create  (write)   → adds an entity
 *   workspace.sprint.list    (read)    → returns all entities
 *   workspace.sprint.update  (write)   → upserts by id
 *   workspace.sprint.delete  (write)   → removes by id
 */
interface CrudOptions<T extends { id: string }> {
  /** Action namespace (e.g. "workspace.sprint"). */
  toolId: string;
  /** Zod schema for the entity itself. */
  schema: z.ZodType<T>;
  /** Human-readable entity name (singular). Used in descriptions. */
  entityName: string;
  selectAll: () => readonly T[];
  upsert: (entity: T) => void;
  remove: (id: string) => void;
  /** Optional id factory for `create` when params omit `id`. */
  generateId?: () => string;
  /**
   * Override the `user_entities.kind` the MCP handlers read/write.
   * Defaults to `kindFromToolId(toolId)` (camelCases the dotted suffix).
   * Supply this when the toolId's camelCased form does NOT equal the kind
   * the browser sync engine registered the collection under — otherwise
   * MCP writes land on an orphaned kind the app never reads (a silent
   * round-trip break). See the `workspace.psych_safety_log` registration:
   * its suffix camelCases to `psychSafetyLog`, but the collection is
   * registered (and the tool.psych_safety.* verbs write) under
   * `workspace:psychSafety`.
   */
  serverKind?: string;
  /**
   * Opt the MCP `update` handler into optimistic-concurrency
   * (compare-and-set via {@link serverVersionedUpdate}) instead of a blind
   * read-modify-write. Set this for entities that carry a monotonic
   * `version` and are edited by BOTH the user's browser and an agent —
   * `workspace.model` (ModelEntry) is the case in point: its browser
   * `upsertModel` is a version-guarded CAS, and `tool.model_registry.*`
   * already writes server-side via `serverVersionedUpdate`, so the generic
   * `workspace.model.update` must too or it becomes a lost-update back-door
   * (a stale blind write silently clobbers a concurrent field change in the
   * DB). The mutate still validates the merged entity against the schema;
   * `serverVersionedUpdate` bumps `version` so the browser LWW accepts the
   * write and the next stale writer is detected. Default (false) keeps the
   * blind write — fine for entities without a version field.
   */
  versioned?: boolean;
}

export function defineCrudActions<T extends { id: string }>(opts: CrudOptions<T>): void {
  const { toolId, schema, entityName, selectAll, upsert, remove } = opts;
  // C1: server-side counterpart key for MCP. e.g. "workspace.sprint"
  // → "workspace:sprint" in user_entities. An explicit `serverKind`
  // overrides the derived value for collections whose registered sync
  // kind doesn't equal the camelCased toolId suffix (see psych-safety).
  const serverKind = opts.serverKind ?? kindFromToolId(toolId);

  // Defensive: typing safeParse via the wider z.ZodType<T> shape.
  type SafeParseFn = (v: unknown) => {
    success: boolean;
    data?: T;
    error?: { message: string };
  };
  const safeParseSchema: SafeParseFn = (
    schema as unknown as { safeParse: SafeParseFn }
  ).safeParse.bind(schema);

  // ──────── create ────────
  // Accept the entity with `id` OPTIONAL so a caller can omit it and let
  // `generateId` mint one (the documented contract). The entity schemas are
  // `z.object(...)` cast to z.ZodType<T>, so at runtime we override just the
  // `id` field to optional via `.extend` — keeping every other field (and
  // its advertised JSON Schema) intact. Previously `createSchema` used the
  // entity schema verbatim, whose `id` is required, so the transport's
  // safeParse rejected an id-less create with -32602 BEFORE the handler ran:
  // the `generateId` fallback below (and every collection's id factory) was
  // unreachable. We only relax `id` when a `generateId` exists to fill it;
  // without one, `id` stays required so an id-less create is still rejected
  // rather than upserting an id-less row. A non-object schema (no `.extend`)
  // falls back to the original behaviour.
  const objectSchema = schema as unknown as {
    extend?: (shape: Record<string, z.ZodType<unknown>>) => z.ZodType<T>;
  };
  const createEntitySchema: z.ZodType<T> =
    opts.generateId && typeof objectSchema.extend === "function"
      ? objectSchema.extend({ id: z.string().optional() })
      : schema;
  const createSchema = z.object({
    entity: createEntitySchema,
  });
  registry.register({
    id: `${toolId}.create`,
    toolId,
    name: "create",
    category: "write",
    description: `Create a ${entityName}.`,
    paramsSchema: createSchema,
    handler: async (params: { entity: T }): Promise<{ id: string }> => {
      const entity = params.entity;
      if (!entity.id && opts.generateId) {
        (entity as { id: string }).id = opts.generateId();
      }
      upsert(entity);
      return { id: entity.id };
    },
    mcpHandler: async (params: { entity: T }, ctx) => {
      const entity = params.entity;
      const hadExplicitId = typeof entity.id === "string" && entity.id.length > 0;
      if (!hadExplicitId && opts.generateId) {
        (entity as { id: string }).id = opts.generateId();
      }
      // `create` must not silently overwrite an existing record. Auto-generated
      // ids can't collide, but a caller-supplied id can — reject the duplicate
      // so a create can never clobber data (callers wanting overwrite semantics
      // use `update`). The check is scoped to explicit ids, so the common
      // generate-an-id path stays a single write.
      if (hadExplicitId) {
        const existing = await serverGetEntity<T>(ctx.userId, serverKind, entity.id);
        if (existing) {
          throw new Error(
            `${entityName} with id "${entity.id}" already exists — use update to modify it.`
          );
        }
      }
      await serverUpsertEntity<T>(ctx.userId, serverKind, entity);
      return { id: entity.id };
    },
  });

  // ──────── list ────────
  registry.register({
    id: `${toolId}.list`,
    toolId,
    name: "list",
    category: "read",
    description: `List all ${entityName} records in the workspace.`,
    paramsSchema: z.object({}),
    handler: async (): Promise<{ items: readonly T[] }> => {
      return { items: selectAll() };
    },
    mcpHandler: async (_params, ctx) => {
      const items = await serverListEntities<T>(ctx.userId, serverKind);
      return { items };
    },
  });

  // ──────── update ────────
  // Zod 4: `z.record(keyType, valueType)` — both args required.
  const updateSchema = z.object({
    id: z.string(),
    patch: z.record(z.string(), z.unknown()),
  });
  registry.register({
    id: `${toolId}.update`,
    toolId,
    name: "update",
    category: "write",
    description: `Update a ${entityName} by id (partial patch merged into existing record).`,
    paramsSchema: updateSchema,
    handler: async (params: {
      id: string;
      patch: Record<string, unknown>;
    }): Promise<{ updated: boolean }> => {
      const current = selectAll().find((e) => e.id === params.id);
      if (!current) return { updated: false };
      // Validate the merged result against the entity schema — reject
      // if a malformed patch would produce an invalid entity.
      const merged = { ...current, ...params.patch, id: params.id };
      const parsed = safeParseSchema(merged);
      if (!parsed.success) {
        throw new Error(
          `Patch produces invalid ${entityName}: ${parsed.error?.message ?? "validation failed"}`
        );
      }
      upsert(parsed.data as T);
      return { updated: true };
    },
    mcpHandler: async (params, ctx) => {
      // Validate the merged result against the entity schema — reject if a
      // malformed patch would produce an invalid entity. Shared by both the
      // versioned (CAS) and blind write paths below.
      const applyPatch = (current: T): T => {
        const merged = { ...current, ...params.patch, id: params.id };
        const parsed = safeParseSchema(merged);
        if (!parsed.success) {
          throw new Error(
            `Patch produces invalid ${entityName}: ${parsed.error?.message ?? "validation failed"}`
          );
        }
        return parsed.data as T;
      };
      if (opts.versioned) {
        // Compare-and-set: re-reads + re-applies on a lost race and bumps
        // `version`, so a concurrent writer touching a different field is
        // never clobbered. Returns null when the row is missing/deleted.
        const result = await serverVersionedUpdate<T>(
          ctx.userId,
          serverKind,
          params.id,
          applyPatch
        );
        return { updated: result !== null };
      }
      const current = await serverGetEntity<T>(ctx.userId, serverKind, params.id);
      if (!current) return { updated: false };
      await serverUpsertEntity<T>(ctx.userId, serverKind, applyPatch(current));
      return { updated: true };
    },
  });

  // ──────── delete ────────
  registry.register({
    id: `${toolId}.delete`,
    toolId,
    name: "delete",
    category: "write",
    description: `Delete a ${entityName} by id.`,
    paramsSchema: z.object({ id: z.string() }),
    handler: async (params: { id: string }): Promise<{ deleted: boolean }> => {
      remove(params.id);
      return { deleted: true };
    },
    mcpHandler: async (params, ctx) => {
      await serverDeleteEntity(ctx.userId, serverKind, params.id);
      return { deleted: true };
    },
  });
}
