import { z } from "zod";
import { registry } from "./registry";

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
}

export function defineCrudActions<T extends { id: string }>(opts: CrudOptions<T>): void {
  const { toolId, schema, entityName, selectAll, upsert, remove } = opts;

  // ──────── create ────────
  // Accept the same schema with `id` optional; auto-generate if absent.
  const createSchema = z.object({
    entity: schema,
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
    handler: async (params: { id: string; patch: Record<string, unknown> }): Promise<{ updated: boolean }> => {
      const current = selectAll().find((e) => e.id === params.id);
      if (!current) return { updated: false };
      // Validate the merged result against the entity schema — reject
      // if a malformed patch would produce an invalid entity.
      const merged = { ...current, ...params.patch, id: params.id };
      // Zod 4: safeParse signature accepts (input, options?). The
      // legacy z.ZodType<T> typing wrapping our generic schema can
      // confuse TS; cast through unknown to a callable shape.
      const parsed = (schema as { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { message: string } } }).safeParse(merged);
      if (!parsed.success) {
        throw new Error(`Patch produces invalid ${entityName}: ${parsed.error?.message ?? "validation failed"}`);
      }
      upsert(parsed.data as T);
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
  });
}
