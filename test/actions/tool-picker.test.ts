/**
 * tool.picker.* coverage: Amr spins, adds names, rotates roles and rolls
 * dice with the page's own rules, on the Picker's store; over MCP he reads
 * the synced copy, answers spins and rolls without saving, and asks for the
 * app for anything that would change the lists or the rotation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  serverGetUserStateBlob: vi.fn(),
  serverListEntities: vi.fn(),
}));
vi.mock("@/lib/actions/server-store", () => server);

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { PICKER_INITIAL, PICKER_LIMITS } from "@/lib/picker/model";
import { readPicker, usePickerStore } from "@/lib/picker/store";
import "@/lib/actions/tools/picker";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = <R>(name: string, params: unknown, source: "agent" | "mcp" = "agent") =>
  registry.get(`tool.picker.${name}`)!.handler(params as never, ctx(source)) as Promise<R>;

const TEAM = ["Amina", "Ben", "Chloé", "Dev"].map((name, i) => ({ id: `m${i}`, name }));

beforeEach(() => {
  usePickerStore.setState({ ...PICKER_INITIAL });
  useWorkspaceStore.setState({ teamMembers: TEAM });
  server.serverGetUserStateBlob.mockReset();
  server.serverListEntities.mockReset();
});

describe("registration", () => {
  it("has a read and four writes, all open to a visitor's own tab", () => {
    expect(registry.get("tool.picker.list_state")?.category).toBe("read");
    for (const name of ["spin", "add_names", "rotate_role", "roll_dice"]) {
      const a = registry.get(`tool.picker.${name}`);
      expect(a?.category, name).toBe("write");
      // Nothing here reaches other people: the room spin is the page's own button.
      expect(a?.visitor, name).not.toBe(false);
    }
    expect(registry.get("tool.picker.spin")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.picker.roll_dice")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.picker.list_state", () => {
  it("reads the wheel from the team, with roles and who is next", async () => {
    const s = await run<{
      wheel: {
        source: string;
        names: { name: string; canComeUp: boolean }[];
        leftThisRound: number;
      };
      roles: { name: string; next: string | null }[];
    }>("list_state", {});
    expect(s.wheel.source).toBe("team");
    expect(s.wheel.names.map((n) => n.name)).toEqual(["Amina", "Ben", "Chloé", "Dev"]);
    expect(s.wheel.leftThisRound).toBe(4);
    expect(s.roles.map((r) => [r.name, r.next])).toEqual([
      ["Facilitator", "Amina"],
      ["Scribe", "Amina"],
      ["Timekeeper", "Amina"],
    ]);
  });
});

describe("tool.picker.spin", () => {
  it("picks each person once before anyone twice, and saves each pick", async () => {
    const picked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await run<{ name: string; leftThisRound: number; saved: boolean }>("spin", {});
      picked.push(r.name);
      expect(r.saved).toBe(true);
      expect(r.leftThisRound).toBe(3 - i);
    }
    expect([...picked].sort()).toEqual(["Amina", "Ben", "Chloé", "Dev"]);
    expect(readPicker().recent.map((p) => p.result)).toEqual([...picked].reverse());
    const fifth = await run<{ newRound: boolean; round: number }>("spin", {});
    expect(fifth).toMatchObject({ newRound: true, round: 2 });
  });

  it("switches the wheel to a list by name first, and refuses one that isn't there", async () => {
    await run("add_names", { names: ["Nile", "Amazon"], list: "Rivers" });
    usePickerStore.setState({ source: "team" });
    const r = await run<{ name: string; from: string }>("spin", { source: "rivers" });
    expect(["Nile", "Amazon"]).toContain(r.name);
    expect(r.from).toBe("Rivers (2 names)");
    expect(readPicker().source).not.toBe("team");
    await expect(run("spin", { source: "Mountains" })).rejects.toThrow(/No saved list/);
  });

  it("says why when there's nobody to spin", async () => {
    useWorkspaceStore.setState({ teamMembers: [] });
    await expect(run("spin", {})).rejects.toThrow(/nobody on it yet/);
  });

  it("over MCP, spins the synced copy without saving", async () => {
    server.serverGetUserStateBlob.mockResolvedValue({
      lists: [{ id: "l1", name: "Topics", entries: ["Only one"] }],
      source: "l1",
    });
    server.serverListEntities.mockResolvedValue([]);
    const r = await run<{ name: string; saved: boolean }>("spin", {}, "mcp");
    expect(r).toMatchObject({ name: "Only one", saved: false });
    expect(server.serverGetUserStateBlob).toHaveBeenCalledWith("u", "agile-toolkit:picker");
    expect(readPicker().recent).toEqual([]);
  });
});

describe("tool.picker.add_names", () => {
  it("makes a list (never touching the team), then adds to it, skipping repeats", async () => {
    const a = await run<{ listName: string; created: boolean; added: number }>("add_names", {
      names: ["Sam", "Jo"],
    });
    expect(a).toMatchObject({ listName: "Picker list", created: true, added: 2 });
    const b = await run<{ created: boolean; added: number; skipped: number }>("add_names", {
      names: ["sam", "Alex"],
    });
    expect(b).toMatchObject({ created: false, added: 1, skipped: 1 });
    expect(readPicker().lists[0].entries.map((e) => e.name)).toEqual(["Sam", "Jo", "Alex"]);
    expect(useWorkspaceStore.getState().teamMembers).toEqual(TEAM);
  });

  it("refuses a new list past the cap, and refuses over MCP", async () => {
    usePickerStore.setState({
      lists: Array.from({ length: PICKER_LIMITS.maxLists }, (_, i) => ({
        id: `l${i}`,
        name: `List ${i}`,
        entries: [],
        updatedAt: "2026-11-01T00:00:00Z",
      })),
    });
    await expect(run("add_names", { names: ["X"], list: "Another" })).rejects.toThrow(/20 lists/);
    await expect(run("add_names", { names: ["X"] }, "mcp")).rejects.toThrow(/in the app/);
  });
});

describe("tool.picker.rotate_role", () => {
  it("gives the role to whoever is due, then the next person", async () => {
    const first = await run<{ person: string; turns: number }>("rotate_role", {
      role: "facilitator",
    });
    expect(first).toEqual({ role: "Facilitator", person: "Amina", turns: 1 });
    const second = await run<{ person: string }>("rotate_role", { role: "role-facilitator" });
    expect(second.person).toBe("Ben");
    expect(readPicker().roleTurns.map((t) => t.person)).toEqual(["Amina", "Ben"]);
  });

  it("passes over someone away today, and keeps them away for the day", async () => {
    const r = await run<{ person: string }>("rotate_role", { role: "Scribe", skip: ["amina"] });
    expect(r.person).toBe("Ben");
    expect(readPicker().away.keys).toEqual(["amina"]);
  });

  it("refuses an unknown role, and refuses over MCP", async () => {
    await expect(run("rotate_role", { role: "Juggler" })).rejects.toThrow(/No role called/);
    await expect(run("rotate_role", { role: "Scribe" }, "mcp")).rejects.toThrow(/in the app/);
  });
});

describe("tool.picker.roll_dice", () => {
  it("rolls and saves the roll; over MCP it rolls without saving", async () => {
    const r = await run<{ dice: string; rolls: number[]; total: number }>("roll_dice", {
      count: 2,
      sides: 6,
    });
    expect(r.dice).toBe("2d6");
    expect(r.rolls).toHaveLength(2);
    expect(r.total).toBe(r.rolls[0] + r.rolls[1]);
    expect(readPicker().recent[0]).toMatchObject({ kind: "dice", detail: "2d6" });
    await run("roll_dice", { count: 1, sides: 20 }, "mcp");
    expect(readPicker().recent).toHaveLength(1);
  });

  it("takes the defaults and refuses a die that doesn't exist", () => {
    const schema = registry.get("tool.picker.roll_dice")!.paramsSchema;
    expect(schema.parse({})).toEqual({ count: 1, sides: 6 });
    expect(schema.safeParse({ sides: 7 }).success).toBe(false);
    expect(schema.safeParse({ count: 7 }).success).toBe(false);
  });
});
