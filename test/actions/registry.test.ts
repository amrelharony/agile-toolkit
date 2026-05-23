import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { claudeNameFromId, registry } from "@/lib/actions/registry";

/**
 * Smoke tests for the singleton tool-action registry. We register
 * disposable actions under a `__test.` namespace and clean them up in
 * afterEach so we don't pollute other suites that share the singleton.
 */

const TEST_IDS = [
  "__test.foo.do_thing",
  "__test.foo.read_thing",
  "workspace.scalars.set_team_name", // intentionally the real id we want resolve() to handle
] as const;

function registerTestActions() {
  registry.register({
    id: "__test.foo.do_thing",
    toolId: "__test.foo",
    name: "do_thing",
    category: "write",
    description: "A test action.",
    paramsSchema: z.object({ x: z.number() }),
    handler: async (params: { x: number }) => ({ doubled: params.x * 2 }),
  });

  registry.register({
    id: "__test.foo.read_thing",
    toolId: "__test.foo",
    name: "read_thing",
    category: "read",
    description: "A test read action.",
    paramsSchema: z.object({}),
    handler: async () => ({ items: [] }),
  });

  // Register the real-shape id so the resolve() round-trip can be
  // exercised even if the production registry isn't loaded in this
  // test run.
  if (!registry.get("workspace.scalars.set_team_name")) {
    registry.register({
      id: "workspace.scalars.set_team_name",
      toolId: "workspace.scalars",
      name: "set_team_name",
      category: "write",
      description: "Set team name (test stub).",
      paramsSchema: z.object({ name: z.string() }),
      handler: async () => ({ ok: true }),
    });
  }
}

describe("ToolActionRegistry", () => {
  beforeEach(() => {
    registerTestActions();
  });

  afterEach(() => {
    for (const id of TEST_IDS) registry.unregister(id);
  });

  it("register + get round-trips by canonical id", () => {
    const action = registry.get("__test.foo.do_thing");
    expect(action).toBeDefined();
    expect(action?.id).toBe("__test.foo.do_thing");
    expect(action?.category).toBe("write");
  });

  it("resolve() accepts the canonical dotted id", () => {
    const action = registry.resolve("__test.foo.do_thing");
    expect(action?.id).toBe("__test.foo.do_thing");
  });

  it("resolve() accepts the Anthropic-format underscore name", () => {
    const action = registry.resolve("__test_foo_do_thing");
    expect(action?.id).toBe("__test.foo.do_thing");
  });

  it("resolve() correctly resolves workspace_scalars_set_team_name → workspace.scalars.set_team_name", () => {
    // This is the exact bug the reverse-map fix is preventing.
    const action = registry.resolve("workspace_scalars_set_team_name");
    expect(action?.id).toBe("workspace.scalars.set_team_name");
  });

  it("resolve() returns undefined for an unknown name", () => {
    expect(registry.resolve("not_a_real_tool_name")).toBeUndefined();
  });

  it("toClaudeTools() emits dot-to-underscore names for registered tools", () => {
    const tools = registry.toClaudeTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("__test_foo_do_thing");
    expect(names).toContain("__test_foo_read_thing");
    expect(names).toContain("workspace_scalars_set_team_name");

    const doThing = tools.find((t) => t.name === "__test_foo_do_thing");
    expect(doThing?.description).toBe("A test action.");
    expect(doThing?.input_schema).toBeDefined();
  });

  it("re-registering the same id is idempotent (no throw, registry unchanged)", () => {
    const before = registry.get("__test.foo.do_thing");
    expect(() => {
      registry.register({
        id: "__test.foo.do_thing",
        toolId: "__test.foo",
        name: "do_thing",
        category: "read", // different on purpose — should be IGNORED
        description: "duplicate",
        paramsSchema: z.object({}),
        handler: async () => ({}),
      });
    }).not.toThrow();
    const after = registry.get("__test.foo.do_thing");
    expect(after).toBe(before);
    expect(after?.category).toBe("write"); // original wins
    expect(after?.description).toBe("A test action.");
  });

  it("claudeNameFromId is the inverse-friendly munger", () => {
    expect(claudeNameFromId("workspace.scalars.set_team_name")).toBe(
      "workspace_scalars_set_team_name"
    );
    expect(claudeNameFromId("a.b.c")).toBe("a_b_c");
    expect(claudeNameFromId("no_dots")).toBe("no_dots");
  });
});
