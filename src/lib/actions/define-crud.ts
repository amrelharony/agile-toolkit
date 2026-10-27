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

/**
 * Where a create or update runs, for the hooks that read or write beyond
 * the one record (`load`, `beforeWrite`).
 */
export interface CrudEnv<T> {
  /** Every stored record of the entity: the browser store's list in the tab, the caller's rows over MCP. */
  all: () => Promise<readonly T[]>;
  /**
   * The MCP caller: set on the server transport only. Undefined in the
   * tab, where a hook reads and writes the browser store.
   */
  userId?: string;
}

interface CrudOptions<T extends { id: string }, L = undefined> {
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
  /**
   * Last step before `create` or `update` writes, on both transports: gets
   * the validated record and the stored one (undefined on create) and
   * returns what to save. Stories use it to stamp a status change the way
   * the app's `setStoryStatus` does, so an agent moving a story to done
   * leaves the same trail. On `update` it also gets the patch as the caller
   * sent it, so it can tell a key the caller set from one the merge kept
   * (a backlog item judges only what the patch sets), and what `load` read.
   */
  prepare?: (
    next: T,
    current: T | undefined,
    patch: Readonly<Record<string, unknown>> | undefined,
    loaded: L | undefined
  ) => T;
  /**
   * Async, on both transports, before `prepare` on create and update:
   * reads what prepare needs besides the two records (a backlog item's
   * method rows), once per write. Gets the stored record (undefined on
   * create) and the transport; what it returns is prepare's and
   * beforeWrite's last argument. Not with `versioned`.
   */
  load?: (current: T | undefined, env: CrudEnv<T>) => Promise<L>;
  /**
   * Async, on both transports, after `prepare` and right before create or
   * update writes: gets the record about to be saved, the stored one
   * (undefined on create), the transport and what `load` read. Throw to
   * refuse: nothing is written (a backlog item refuses a rank another item
   * holds). After its checks it may write the records of other kinds that
   * go with the save (a backlog item's legacy rows), just before the record
   * itself. Not with `versioned`.
   */
  beforeWrite?: (
    next: T,
    current: T | undefined,
    env: CrudEnv<T>,
    loaded: L | undefined
  ) => Promise<void>;
  /**
   * For an entity whose store `remove` takes other rows with it (a weighted
   * matrix's options and criteria): `describe` says what goes, in the delete
   * verb's description, and `server` does the same on the MCP transport —
   * given the user and the id, it deletes the entity's own row too. Without
   * it the MCP delete tombstones the one row, so a cascading `remove` would
   * give the two transports of one action id different results (see the
   * R12-fix note on create).
   */
  cascade?: {
    describe: string;
    server: (userId: string, id: string) => Promise<void>;
  };
}

export function defineCrudActions<T extends { id: string }, L = undefined>(
  opts: CrudOptions<T, L>
): void {
  const { toolId, schema, entityName, selectAll, upsert, remove } = opts;
  const prepare = opts.prepare ?? ((next: T) => next);
  // C1: server-side counterpart key for MCP. e.g. "workspace.sprint"
  // → "workspace:sprint" in user_entities. An explicit `serverKind`
  // overrides the derived value for collections whose registered sync
  // kind doesn't equal the camelCased toolId suffix (see psych-safety).
  const serverKind = opts.serverKind ?? kindFromToolId(toolId);
  // A versioned update is a compare-and-set that re-runs a synchronous
  // prepare on each attempt: there is no place for an async step in it.
  if (opts.versioned && (opts.load || opts.beforeWrite)) {
    throw new Error(`${toolId}: a versioned CRUD takes no load or beforeWrite hook.`);
  }
  const clientEnv: CrudEnv<T> = { all: async () => selectAll() };
  const serverEnv = (userId: string): CrudEnv<T> => ({
    all: () => serverListEntities<T>(userId, serverKind),
    userId,
  });
  /** load, then prepare, then beforeWrite: the record to save (a throw writes nothing). */
  const prepared = async (
    next: T,
    current: T | undefined,
    patch: Readonly<Record<string, unknown>> | undefined,
    env: CrudEnv<T>
  ): Promise<T> => {
    const loaded = opts.load ? await opts.load(current, env) : undefined;
    const out = prepare(next, current, patch, loaded);
    if (opts.beforeWrite) await opts.beforeWrite(out, current, env, loaded);
    return out;
  };

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
  // falls back to the original behaviour. `safeExtend` first: zod 4 refuses
  // `extend` on an object with refinements (an allocation round's
  // cross-field rules), and `safeExtend` keeps them on the relaxed schema.
  type Extend = (shape: Record<string, z.ZodType<unknown>>) => z.ZodType<T>;
  const objectSchema = schema as unknown as { extend?: Extend; safeExtend?: Extend };
  const relaxId = objectSchema.safeExtend ?? objectSchema.extend;
  const createEntitySchema: z.ZodType<T> =
    opts.generateId && typeof relaxId === "function"
      ? relaxId.call(schema, { id: z.string().optional() })
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
      const hadExplicitId = typeof entity.id === "string" && entity.id.length > 0;
      if (!hadExplicitId && opts.generateId) {
        (entity as { id: string }).id = opts.generateId();
      }
      // R12-fix: same duplicate guard as the mcpHandler below. `create`
      // must not silently overwrite an existing record, but this local
      // (in-tab agent) path previously upserted blindly — the two
      // transports of the SAME action id had opposite duplicate
      // semantics, and a create echoing an id from a prior `list`
      // clobbered the entity wholesale. Scoped to explicit ids so the
      // common generate-an-id path stays a single write.
      if (hadExplicitId && selectAll().some((e) => e.id === entity.id)) {
        throw new Error(
          `${entityName} with id "${entity.id}" already exists — use update to modify it.`
        );
      }
      upsert(await prepared(entity, undefined, undefined, clientEnv));
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
      const env = serverEnv(ctx.userId);
      await serverUpsertEntity<T>(
        ctx.userId,
        serverKind,
        await prepared(entity, undefined, undefined, env)
      );
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
      upsert(await prepared(parsed.data as T, current, params.patch, clientEnv));
      return { updated: true };
    },
    mcpHandler: async (params, ctx) => {
      // Validate the merged result against the entity schema — reject if a
      // malformed patch would produce an invalid entity. Shared by both the
      // versioned (CAS) and blind write paths below.
      const validated = (current: T): T => {
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
          (current) => prepare(validated(current), current, params.patch, undefined)
        );
        return { updated: result !== null };
      }
      const current = await serverGetEntity<T>(ctx.userId, serverKind, params.id);
      if (!current) return { updated: false };
      const next = await prepared(validated(current), current, params.patch, serverEnv(ctx.userId));
      await serverUpsertEntity<T>(ctx.userId, serverKind, next);
      return { updated: true };
    },
  });

  // ──────── delete ────────
  registry.register({
    id: `${toolId}.delete`,
    toolId,
    name: "delete",
    category: "write",
    description: opts.cascade
      ? `Delete a ${entityName} by id. ${opts.cascade.describe}`
      : `Delete a ${entityName} by id.`,
    paramsSchema: z.object({ id: z.string() }),
    handler: async (params: { id: string }): Promise<{ deleted: boolean }> => {
      remove(params.id);
      return { deleted: true };
    },
    mcpHandler: async (params, ctx) => {
      if (opts.cascade) await opts.cascade.server(ctx.userId, params.id);
      else await serverDeleteEntity(ctx.userId, serverKind, params.id);
      return { deleted: true };
    },
  });
}
