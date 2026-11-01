import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { defineCrudActions } from "@/lib/actions/define-crud";

/**
 * Regression guard for the CRUD `create` action's id handling.
 *
 * The documented contract is "accept the entity with `id` optional;
 * auto-generate if absent". Previously `createSchema` used the entity
 * schema verbatim (id required), so an id-less create was rejected by the
 * transport's schema validation (-32602) BEFORE the handler ran — the
 * `generateId` fallback, and every collection's id factory, was dead code.
 *
 * These tests lock in:
 *   1. the create paramsSchema ACCEPTS an entity without `id` (so the
 *      transport no longer rejects it) when a generateId is supplied,
 *   2. the handler fills the id from generateId and returns it,
 *   3. an explicit id is preserved (generateId NOT consulted),
 *   4. the advertised JSON Schema still describes every entity field and
 *      keeps `id` out of `required`,
 *   5. WITHOUT a generateId, `id` stays required (id-less create rejected),
 *      so we never upsert an id-less row.
 */

interface Widget {
  id: string;
  name: string;
}
const WidgetSchema = z.object({ id: z.string(), name: z.string() }) as unknown as z.ZodType<Widget>;

const GEN_NS = "__crudid_gen.widget";
const NOGEN_NS = "__crudid_nogen.widget";
const REFINED_NS = "__crudid_refined.widget";

function idsFor(ns: string) {
  return [`${ns}.create`, `${ns}.list`, `${ns}.update`, `${ns}.delete`];
}

afterEach(() => {
  for (const ns of [GEN_NS, NOGEN_NS, REFINED_NS])
    for (const id of idsFor(ns)) registry.unregister(id);
});

describe("defineCrudActions create — id auto-generation", () => {
  function makeWithGen() {
    const upserts: Widget[] = [];
    defineCrudActions<Widget>({
      toolId: GEN_NS,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => upserts,
      upsert: (w) => upserts.push(w),
      remove: () => {},
      generateId: () => "GEN_ID_123",
    });
    return { create: registry.get(`${GEN_NS}.create`)!, upserts };
  }

  it("accepts an entity WITHOUT an id at the schema layer (no -32602)", () => {
    const { create } = makeWithGen();
    const parsed = (
      create.paramsSchema as { safeParse: (v: unknown) => { success: boolean } }
    ).safeParse({ entity: { name: "no-id" } });
    expect(parsed.success).toBe(true);
  });

  it("fills the id from generateId and upserts the entity with it", async () => {
    const { create, upserts } = makeWithGen();
    const res = (await create.handler(
      { entity: { name: "no-id" } } as never,
      makeContext("u", "mcp")
    )) as {
      id: string;
    };
    expect(res.id).toBe("GEN_ID_123");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toEqual({ name: "no-id", id: "GEN_ID_123" });
  });

  it("preserves an explicitly supplied id (generateId not consulted)", async () => {
    const { create, upserts } = makeWithGen();
    const res = (await create.handler(
      { entity: { id: "explicit", name: "x" } } as never,
      makeContext("u", "mcp")
    )) as { id: string };
    expect(res.id).toBe("explicit");
    expect(upserts[0].id).toBe("explicit");
  });

  it("still advertises every field and keeps id out of required", () => {
    const { create } = makeWithGen();
    const js = registryToJsonSchema(create.paramsSchema);
    const entity = (js.properties as { entity: { properties?: object; required?: string[] } })
      .entity;
    expect(Object.keys(entity.properties ?? {})).toEqual(expect.arrayContaining(["id", "name"]));
    expect(entity.required ?? []).not.toContain("id");
    expect(entity.required ?? []).toContain("name");
  });

  it("WITHOUT a generateId, id stays required (id-less create rejected)", () => {
    defineCrudActions<Widget>({
      toolId: NOGEN_NS,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
      // no generateId
    });
    const create = registry.get(`${NOGEN_NS}.create`)!;
    const parsed = (
      create.paramsSchema as { safeParse: (v: unknown) => { success: boolean } }
    ).safeParse({ entity: { name: "no-id" } });
    expect(parsed.success).toBe(false);
  });

  // zod 4 refuses `extend` on an object with refinements; the relaxed create
  // schema must register anyway and keep the record rules.
  it("keeps a refined schema's rules on the id-optional create schema", () => {
    const Ranged = z
      .object({ id: z.string(), low: z.number(), high: z.number() })
      .superRefine((v, ctx) => {
        if (v.low > v.high) ctx.addIssue({ code: "custom", message: "low > high", path: ["low"] });
      }) as unknown as z.ZodType<Widget>;
    defineCrudActions<Widget>({
      toolId: REFINED_NS,
      schema: Ranged,
      entityName: "range",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
      generateId: () => "GEN",
    });
    const create = registry.get(`${REFINED_NS}.create`)!;
    const parse = (entity: unknown) =>
      (create.paramsSchema as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
        entity,
      }).success;
    expect(parse({ low: 1, high: 2 })).toBe(true);
    expect(parse({ low: 3, high: 2 })).toBe(false);
    expect(parse({ id: "x", low: 3, high: 2 })).toBe(false);
  });
});

function registryToJsonSchema(schema: unknown): {
  properties?: Record<string, unknown>;
} {
  return z.toJSONSchema(schema as z.ZodType, { target: "draft-2020-12" }) as {
    properties?: Record<string, unknown>;
  };
}
