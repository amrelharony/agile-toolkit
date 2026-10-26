/**
 * tool.dod_builder.* coverage (singleton doc, Phase 6).
 *
 *   1. registration — list_state read; the rest writes, with MCP handlers.
 *   2. criteria — add (Required by default, duplicates refused), update, remove.
 *   3. set_story_check — ticks on a story, unknown story or criterion refused.
 *   4. list_state — the page's adherence (lib/dod/model) for a sprint and by sprint.
 *   5. the old blob — read until moved; the first write moves it (a copy).
 *   6. the MCP path, and tool.release_readiness reading the workspace DoD first.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id,
// and the user_state blobs by key.
const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DefinitionOfDone, Sprint, Story } from "@/lib/stores/workspace-types";
import {
  DOD_DOC_ID,
  DOD_KIND,
  DOD_LEGACY_KEY,
  adherenceBySprint,
  dodAdherence,
  dodVerdict,
  normalizeDefinitionOfDone,
} from "@/lib/dod/model";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { todayIso } from "@/lib/sprints/series";
import { addDays } from "@/lib/flow/days";

import "@/lib/actions/tools/dod-builder";
import "@/lib/actions/tools/release-readiness";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(
  path: "handler" | "mcpHandler",
  tool: string,
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.${tool}.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", "dod_builder", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", "dod_builder", verb, params);

const doc = () =>
  (useWorkspaceStore.getState().definitionsOfDone ?? []).find((d) => d.id === DOD_DOC_ID);

const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-01",
  endDate: "2026-10-14",
  pointsPlanned: 0,
  status: "active",
};
const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  sprintId: "s1",
  ...patch,
});

beforeEach(() => {
  rows.clear();
  blobs.clear();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    definitionsOfDone: [],
    stories: [],
    sprints: [],
    releaseReadinesses: [],
  });
});

describe("tool.dod_builder — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.dod_builder.list_state")?.category).toBe("read");
    for (const verb of [
      "add_criterion",
      "update_criterion",
      "remove_criterion",
      "set_story_check",
    ]) {
      const a = registry.get(`tool.dod_builder.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe("criteria", () => {
  it("adds Required by default, refuses duplicates, updates and removes", async () => {
    const a = await call<{ added: boolean; id: string; required: boolean }>("add_criterion", {
      label: "Code reviewed",
      category: "code",
    });
    expect(a).toMatchObject({ added: true, required: true });
    const b = await call<{ id: string }>("add_criterion", {
      label: "Docs",
      category: "docs",
      required: false,
    });
    expect(await call("add_criterion", { label: " code reviewed. ", category: "code" })).toEqual({
      added: false,
      reason: "duplicate",
      id: a.id,
    });
    expect(
      await call("update_criterion", {
        id: b.id,
        required: true,
        label: "Docs updated",
        description: "README",
      })
    ).toEqual({ updated: true });
    expect(doc()?.items[1]).toMatchObject({
      label: "Docs updated",
      required: true,
      description: "README",
    });
    expect(await call("update_criterion", { id: b.id, label: "Code reviewed" })).toEqual({
      updated: false,
      reason: "duplicate",
    });
    expect(await call("remove_criterion", { id: a.id })).toEqual({ removed: true });
    expect(await call("remove_criterion", { id: a.id })).toEqual({
      removed: false,
      reason: "not_found",
    });
  });
});

describe("ticks and adherence", () => {
  it("ticks a story and reads the page's adherence for the sprint", async () => {
    const rev = await call<{ id: string }>("add_criterion", {
      label: "Code reviewed",
      category: "code",
    });
    const ci = await call<{ id: string }>("add_criterion", {
      label: "CI green",
      category: "testing",
    });
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: [story("a"), story("b"), story("example-c")],
    });
    expect(
      await call("set_story_check", { storyId: "a", criterionId: "nope", checked: true })
    ).toEqual({ updated: false, reason: "unknown_criterion" });
    expect(
      await call("set_story_check", { storyId: "zz", criterionId: rev.id, checked: true })
    ).toEqual({ updated: false, reason: "unknown_story" });
    await call("set_story_check", { storyId: "a", criterionId: rev.id, checked: true });
    const r = await call<{ meetsDod: boolean; open: { id: string }[] }>("set_story_check", {
      storyId: "a",
      criterionId: ci.id,
      checked: true,
    });
    expect(r).toMatchObject({ updated: true, meetsDod: true, open: [] });

    const listed = await call<{
      requiredCount: number;
      sprint: { id: string };
      adherence: ReturnType<typeof dodAdherence>;
      bySprint: ReturnType<typeof adherenceBySprint>;
      verdict: string;
    }>("list_state");
    const ws = useWorkspaceStore.getState();
    const d = normalizeDefinitionOfDone(doc());
    expect(listed.requiredCount).toBe(2);
    expect(listed.sprint.id).toBe("s1");
    // The same numbers as the page: example stories don't count.
    expect(listed.adherence).toEqual(dodAdherence(ws.stories, d, "s1"));
    expect(listed.adherence).toMatchObject({ done: 2, meeting: 1, pct: 50 });
    expect(listed.bySprint).toEqual(adherenceBySprint(ws.stories, ws.sprints, d));
    expect(listed.verdict).toBe(dodVerdict(d, listed.adherence, "Sprint 1"));
    expect(await call("list_state", { sprintId: "missing" })).toMatchObject({
      error: "unknown_sprint",
    });
  });
});

describe("the old blob", () => {
  const blob = {
    items: [{ id: "seed-ci", label: "CI green", category: "testing", required: true, done: true }],
    history: [{ sprintName: "Sprint 3", totalRequired: 1, completed: 1, ts: "2026-05-01" }],
  };

  it("is read until it moves, and the first write moves a copy of it", async () => {
    window.localStorage.setItem(DOD_LEGACY_KEY, JSON.stringify(blob));
    const listed = await call<{ source: string; criteria: { id: string }[] }>("list_state");
    expect(listed).toMatchObject({ source: "legacy", criteria: [{ id: "seed-ci" }] });
    await call("add_criterion", { label: "Reviewed", category: "code" });
    expect(doc()?.items.map((i) => i.id)).toEqual(["seed-ci", expect.stringMatching(/^dod_/)]);
    expect(doc()?.history).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem(DOD_LEGACY_KEY)!)).toEqual(blob);
  });

  it("moves on the server too, and the server keeps the blob", async () => {
    blobs.set(DOD_LEGACY_KEY, blob);
    expect(await callMcp("list_state")).toMatchObject({ source: "legacy" });
    await callMcp("update_criterion", { id: "seed-ci", required: false });
    const stored = rows.get(`${DOD_KIND}/${DOD_DOC_ID}`) as DefinitionOfDone;
    expect(stored.items[0]).toMatchObject({ id: "seed-ci", required: false, done: true });
    expect(blobs.get(DOD_LEGACY_KEY)).toEqual(blob);
    expect(await callMcp("list_state")).toMatchObject({ source: "workspace" });
  });
});

describe("the MCP path", () => {
  it("ticks a story row and reads the same adherence", async () => {
    rows.set("workspace:sprint/s1", SPRINT);
    rows.set("workspace:story/a", story("a"));
    const rev = await callMcp<{ id: string }>("add_criterion", {
      label: "Reviewed",
      category: "code",
    });
    await callMcp("set_story_check", { storyId: "a", criterionId: rev.id, checked: true });
    expect((rows.get("workspace:story/a") as Story).dodChecks?.checked).toEqual([rev.id]);
    const listed = await callMcp<{ adherence: { done: number; meeting: number; pct: number } }>(
      "list_state"
    );
    expect(listed.adherence).toMatchObject({ done: 1, meeting: 1, pct: 100 });
    expect(useWorkspaceStore.getState().definitionsOfDone).toEqual([]);
  });

  it("tool.release_readiness checks a release's linked stories against the workspace DoD", async () => {
    const rev = await call<{ id: string }>("add_criterion", {
      label: "Reviewed",
      category: "code",
    });
    useWorkspaceStore.setState({
      stories: [story("a", { title: "Pay by card" })],
      releaseReadinesses: [
        {
          id: RELEASE_DOC_ID,
          releases: [
            {
              id: "r1",
              name: "v1",
              plannedDate: addDays(todayIso(), 7) as string,
              status: "planning",
              gates: {},
              storyIds: ["a"],
            },
          ],
          gates: [{ id: "dod_met", label: "Definition of Done met", auto: "dod" }],
        },
      ],
    });
    type Listed = {
      releases: { gates: { id: string; passed: boolean; check?: { detail: string } }[] }[];
    };
    const gate = async () =>
      (await run<Listed>("handler", "release_readiness", "list_state")).releases[0].gates[0];
    expect(await gate()).toMatchObject({
      passed: false,
      check: { detail: "Not met: Pay by card (1 open)" },
    });
    await call("set_story_check", { storyId: "a", criterionId: rev.id, checked: true });
    expect(await gate()).toMatchObject({ passed: true });
  });
});
