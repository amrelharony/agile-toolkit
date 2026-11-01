/**
 * `defineCrudActions({ cascade })`: an entity whose store `remove` takes
 * other rows with it deletes the same way over MCP. Without `cascade` the
 * MCP delete tombstones the one row, as it always did.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return { ...actual, serverDeleteEntity: vi.fn(async () => {}) };
});

import { z } from "zod";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { defineCrudActions } from "@/lib/actions/define-crud";
import * as serverStore from "@/lib/actions/server-store";

interface Widget {
  id: string;
  name: string;
}
const WidgetSchema = z.object({ id: z.string(), name: z.string() }) as unknown as z.ZodType<Widget>;

const PLAIN_NS = "__crud_cascade_plain.widget";
const CASCADE_NS = "__crud_cascade.widget";

afterEach(() => {
  for (const ns of [PLAIN_NS, CASCADE_NS])
    for (const verb of ["create", "list", "update", "delete"]) registry.unregister(`${ns}.${verb}`);
  vi.mocked(serverStore.serverDeleteEntity).mockClear();
});

describe("defineCrudActions delete", () => {
  it("without a cascade, tombstones the one row over MCP", async () => {
    defineCrudActions<Widget>({
      toolId: PLAIN_NS,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: () => {},
    });
    const del = registry.get(`${PLAIN_NS}.delete`)!;
    expect(del.description).toBe("Delete a widget by id.");
    expect(await del.mcpHandler!({ id: "w1" }, makeContext("u1", "mcp"))).toEqual({
      deleted: true,
    });
    expect(serverStore.serverDeleteEntity).toHaveBeenCalledWith(
      "u1",
      "__crud_cascade_plain.widget",
      "w1"
    );
  });

  it("with a cascade, runs it over MCP instead, says it, and the tab still calls remove", async () => {
    const server = vi.fn(async () => {});
    const removed: string[] = [];
    defineCrudActions<Widget>({
      toolId: CASCADE_NS,
      schema: WidgetSchema,
      entityName: "widget",
      selectAll: () => [],
      upsert: () => {},
      remove: (id) => removed.push(id),
      cascade: { describe: "Its parts go too.", server },
    });
    const del = registry.get(`${CASCADE_NS}.delete`)!;
    expect(del.description).toBe("Delete a widget by id. Its parts go too.");

    expect(await del.mcpHandler!({ id: "w2" }, makeContext("u2", "mcp"))).toEqual({
      deleted: true,
    });
    expect(server).toHaveBeenCalledWith("u2", "w2");
    expect(serverStore.serverDeleteEntity).not.toHaveBeenCalled();

    expect(await del.handler({ id: "w3" }, makeContext("u2", "agent"))).toEqual({ deleted: true });
    expect(removed).toEqual(["w3"]);
  });
});
