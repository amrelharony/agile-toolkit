import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { defineCrudActions } from "@/lib/actions/define-crud";

/**
 * Smoke tests for the CRUD action generator. We register against a
 * disposable namespace so this test can't collide with the real
 * workspace.* actions. Handlers are NOT invoked — they call into the
 * workspace store, which we don't want to spin up for this assertion.
 */

const TEST_NAMESPACE = "__test.widget";
const EXPECTED_IDS = [
  `${TEST_NAMESPACE}.create`,
  `${TEST_NAMESPACE}.list`,
  `${TEST_NAMESPACE}.update`,
  `${TEST_NAMESPACE}.delete`,
] as const;

interface Widget {
  id: string;
  name: string;
}

const WidgetSchema = z.object({ id: z.string(), name: z.string() });

describe("defineCrudActions", () => {
  afterEach(() => {
    for (const id of EXPECTED_IDS) registry.unregister(id);
  });

  it("registers all four CRUD actions under the expected ids", () => {
    defineCrudActions<Widget>({
      toolId: TEST_NAMESPACE,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
    });

    for (const id of EXPECTED_IDS) {
      const action = registry.get(id);
      expect(action, `expected ${id} to be registered`).toBeDefined();
    }
  });

  it("assigns the correct category for each CRUD action", () => {
    defineCrudActions<Widget>({
      toolId: TEST_NAMESPACE,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
    });

    expect(registry.get(`${TEST_NAMESPACE}.create`)?.category).toBe("write");
    expect(registry.get(`${TEST_NAMESPACE}.list`)?.category).toBe("read");
    expect(registry.get(`${TEST_NAMESPACE}.update`)?.category).toBe("write");
    expect(registry.get(`${TEST_NAMESPACE}.delete`)?.category).toBe("write");
  });

  it("includes the entityName in the generated descriptions", () => {
    defineCrudActions<Widget>({
      toolId: TEST_NAMESPACE,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
    });

    expect(registry.get(`${TEST_NAMESPACE}.create`)?.description).toContain("widget");
    expect(registry.get(`${TEST_NAMESPACE}.list`)?.description).toContain("widget");
    expect(registry.get(`${TEST_NAMESPACE}.update`)?.description).toContain("widget");
    expect(registry.get(`${TEST_NAMESPACE}.delete`)?.description).toContain("widget");
  });
});
