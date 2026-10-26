/**
 * tool.health_check.* coverage (singleton doc, S4 — Team Health & Maturity).
 *
 *   1. registration — list_state read; the rest write; reset asks first.
 *   2. set_dimension + set_sprint_name + list_state — health over the rated
 *      dimensions only, yellow counting half (never the placeholder greens).
 *   3. set_dimension refuses an unknown dimension.
 *   4. save_check snapshots the draft into history and starts a new one,
 *      refusing while a dimension is unrated.
 *   5. reset clears the draft and history.
 *   6. the server handlers read and write the same document by its kind.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
  };
});

import { registry } from "@/lib/actions/registry";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { HEALTH_CHECK_DIMENSIONS, HEALTH_CHECK_ID } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";

import "@/lib/actions/tools/health-check";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const VERBS = [
  "set_sprint_name",
  "set_sprint",
  "set_dimension",
  "save_check",
  "remove_check",
  "add_dimension",
  "archive_dimension",
  "reset",
];

describe("tool.health_check — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.health_check.list_state")?.category).toBe("read");
    for (const verb of VERBS) {
      expect(registry.get(`tool.health_check.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.health_check.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.health_check.${verb}`)?.requiresConfirmation).toBe(
        verb === "reset"
      );
    }
  });
});

describe("tool.health_check lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ healthChecks: [], sprints: [] }));

  it("sets a dimension light + sprint name and computes current health", async () => {
    await registry
      .get("tool.health_check.set_sprint_name")!
      .handler({ sprintName: "Sprint 1" }, ctx());
    const r0 = (await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Fun", light: "red" }, ctx())) as { set: boolean };
    expect(r0.set).toBe(true);
    await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Speed", light: "yellow" }, ctx());

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      current: { sprintName: string; scores: Record<string, { light: string }> };
      lights: Record<string, string | null>;
      currentHealth: number;
      checkCount: number;
    };
    expect(r.exists).toBe(true);
    expect(r.current.sprintName).toBe("Sprint 1");
    expect(r.current.scores["Fun"].light).toBe("red");
    expect(r.lights.Teamwork).toBeNull();
    // Only Fun (red, 0) and Speed (yellow, ½) are rated: 25%.
    expect(r.currentHealth).toBe(25);
    expect(r.checkCount).toBe(0);
  });

  it("set_dimension refuses an unknown dimension", async () => {
    const r = (await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Ping Pong", light: "green" }, ctx())) as { set: boolean };
    expect(r.set).toBe(false);
  });

  it("save_check snapshots the draft into history and starts a new one", async () => {
    await registry
      .get("tool.health_check.set_sprint_name")!
      .handler({ sprintName: "Sprint 7" }, ctx());
    const refused = (await registry.get("tool.health_check.save_check")!.handler({}, ctx())) as {
      saved: boolean;
      unrated: string[];
    };
    expect(refused).toMatchObject({ saved: false });
    expect(refused.unrated).toHaveLength(8);

    for (const d of HEALTH_CHECK_DIMENSIONS) {
      await registry
        .get("tool.health_check.set_dimension")!
        .handler({ dimension: d, light: d === "Speed" ? "red" : "green" }, ctx());
    }
    const saved = (await registry.get("tool.health_check.save_check")!.handler({}, ctx())) as {
      saved: boolean;
      checkCount: number;
    };
    expect(saved.saved).toBe(true);
    expect(saved.checkCount).toBe(1);

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      current: { sprintName: string };
      currentHealth: number | null;
      checkCount: number;
      history: { sprintName: string; health: number }[];
    };
    // The saved check keeps Speed = red: 7 of 8 green, 88%.
    expect(r.history).toHaveLength(1);
    expect(r.history[0].sprintName).toBe("Sprint 7");
    expect(r.history[0].health).toBe(88);
    // The new check is blank and unrated, not 100%.
    expect(r.current.sprintName).toBe("");
    expect(r.currentHealth).toBeNull();
    expect(r.checkCount).toBe(1);
  });

  it("reset clears the draft and history", async () => {
    await registry
      .get("tool.health_check.set_dimension")!
      .handler({ dimension: "Mission", light: "yellow" }, ctx());

    const rr = (await registry.get("tool.health_check.reset")!.handler({}, ctx())) as {
      reset: boolean;
    };
    expect(rr.reset).toBe(true);

    const r = (await registry.get("tool.health_check.list_state")!.handler({}, ctx())) as {
      checkCount: number;
      currentHealth: number | null;
    };
    expect(r.checkCount).toBe(0);
    expect(r.currentHealth).toBeNull();
  });
});

describe("tool.health_check on the server", () => {
  it("reads and writes the singleton under its kind", async () => {
    const upsert = vi.mocked(serverStore.serverUpsertEntity);
    upsert.mockClear();
    const r = (await registry.get("tool.health_check.set_dimension")!.mcpHandler!(
      { dimension: "Fun", light: "green", note: "Good week" },
      ctx()
    )) as {
      set: boolean;
    };
    expect(r.set).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      "u",
      "workspace:healthCheck",
      expect.objectContaining({ id: HEALTH_CHECK_ID })
    );
    const written = upsert.mock.calls[0][2] as unknown as {
      current: { scores: { Fun: { note: string } }; rated: string[] };
    };
    expect(written.current.scores.Fun.note).toBe("Good week");
    expect(written.current.rated).toEqual(["Fun"]);
  });

  it("save_check takes the user's day a day ahead of the server's, not two", async () => {
    // A draft with every dimension rated, as the server would read it.
    const rated = {
      id: HEALTH_CHECK_ID,
      current: {
        sprintName: "",
        scores: Object.fromEntries(
          HEALTH_CHECK_DIMENSIONS.map((d) => [d, { light: "green", trend: "same" }])
        ),
        rated: [...HEALTH_CHECK_DIMENSIONS],
      },
      history: [],
    };
    vi.mocked(serverStore.serverGetEntity).mockImplementation(async () => rated as never);
    const save = registry.get("tool.health_check.save_check")!;
    const today = todayLocalISO();
    try {
      // Ahead of UTC, the user's today is the server's tomorrow: accepted.
      expect(await save.mcpHandler!({ date: addDays(today, 1) }, ctx())).toMatchObject({
        saved: true,
        date: addDays(today, 1),
      });
      expect(await save.mcpHandler!({ date: addDays(today, 2) }, ctx())).toMatchObject({
        saved: false,
        reason: "A check can't be dated in the future.",
      });
    } finally {
      vi.mocked(serverStore.serverGetEntity).mockImplementation(async () => null);
    }
    // In the browser, today is the user's own: tomorrow is refused.
    useWorkspaceStore.setState({ healthChecks: [rated as never] });
    expect(await save.handler({ date: addDays(today, 1) }, ctx())).toMatchObject({ saved: false });
  });
});
