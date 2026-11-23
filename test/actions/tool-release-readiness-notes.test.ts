/**
 * tool.release_readiness's release-notes verbs (tools plan, phase 2):
 * suggest_stories and draft_notes read; link_stories and set_notes write,
 * each with an MCP handler; list_state gains storyIds and hasNotes. The
 * existing verbs' file (tool-release-readiness.test.ts) stays as it is.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Release, ReleaseReadiness, Story } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
    serverGetUserStateBlob: vi.fn(async () => null),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import "@/lib/actions/tools/release-readiness";

const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;
const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T>(verb: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(`tool.release_readiness.${verb}`)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const story = (id: string, daysAgo: number | null, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "done",
  ...(daysAgo !== null ? { doneAt: new Date(`${on(-daysAgo)}T12:00:00`).toISOString() } : {}),
  ...over,
});
const shipped: Release = {
  id: "r1",
  name: "v1",
  plannedDate: on(-10),
  status: "shipped",
  shippedDate: on(-10),
  gates: {},
  storyIds: ["s0"],
};
const planning: Release = {
  id: "r2",
  name: "v2",
  plannedDate: on(5),
  status: "planning",
  gates: {},
};
const docOf = (...releases: Release[]): ReleaseReadiness => ({ id: RELEASE_DOC_ID, releases });
const STORIES = [
  story("s0", 12),
  story("s1", 5, { title: "Fix the login crash", ticketKey: "APP-9" }),
  story("s2", 2, { title: "Search by name", epicId: "e1" }),
  story("s3", null, { status: "in_progress" }),
  story("example-s", 3),
];

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) =>
  (ws().releaseReadinesses ?? [])
    .find((d) => d.id === RELEASE_DOC_ID)
    ?.releases.find((r) => r.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    releaseReadinesses: [docOf(planning, shipped)],
    stories: STORIES,
    featureFlags: [],
    definitionsOfDone: [],
    epicRoadmaps: [
      {
        id: "epicRoadmap:current",
        epics: [
          {
            id: "e1",
            title: "Search",
            startQuarter: "Q1 2026",
            endQuarter: "Q1 2026",
            progress: 0,
          },
        ],
      },
    ],
  });
});

describe("registration", () => {
  it("adds two reads and two writes, each with an MCP handler", () => {
    for (const verb of ["suggest_stories", "draft_notes"]) {
      expect(registry.get(`tool.release_readiness.${verb}`)?.category, verb).toBe("read");
    }
    for (const verb of ["link_stories", "set_notes"]) {
      const a = registry.get(`tool.release_readiness.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
    for (const verb of ["suggest_stories", "draft_notes", "link_stories", "set_notes"]) {
      expect(registry.get(`tool.release_readiness.${verb}`)?.mcpHandler, verb).toBeTypeOf(
        "function"
      );
    }
  });
});

describe("the release-notes verbs", () => {
  it("lists each release's stories and whether it has notes", async () => {
    const out = await run<{ releases: { id: string; storyIds: string[]; hasNotes: boolean }[] }>(
      "list_state"
    );
    expect(out.releases.map((r) => [r.id, r.storyIds, r.hasNotes])).toEqual([
      ["r2", [], false],
      ["r1", ["s0"], false],
    ]);
  });

  it("suggests the stories done since the previous ship, not linked elsewhere", async () => {
    const out = await run<{ suggestions: { id: string; kind: string }[] }>("suggest_stories", {
      releaseId: "r2",
    });
    expect(out.suggestions.map((s) => [s.id, s.kind])).toEqual([
      ["s2", "new"],
      ["s1", "fix"],
    ]);
  });

  it("links stories, skipping unknown ones and those linked elsewhere, and can set the list", async () => {
    const out = await run<{
      storyIds: string[];
      added: number;
      skipped: { id: string; reason: string }[];
    }>("link_stories", { releaseId: "r2", storyIds: ["s1", "s2", "s0", "nope", "example-s"] });
    expect(out.storyIds).toEqual(["s1", "s2"]);
    expect(out.added).toBe(2);
    expect(out.skipped).toEqual([
      { id: "s0", reason: "linked_elsewhere" },
      { id: "nope", reason: "unknown" },
      { id: "example-s", reason: "unknown" },
    ]);
    await run("link_stories", { releaseId: "r2", storyIds: [], mode: "set" });
    expect(stored("r2")?.storyIds).toBeUndefined();
  });

  it("drafts notes from the linked done stories by the template, saving nothing", async () => {
    await run("link_stories", { releaseId: "r2", storyIds: ["s1", "s2", "s3"] });
    const before = JSON.stringify(ws().releaseReadinesses);
    const out = await run<{ drafted: boolean; text: string; leftOut: { id: string }[] }>(
      "draft_notes",
      { releaseId: "r2", audience: "team" }
    );
    expect(out.drafted).toBe(true);
    expect(out.text).toContain("New\n- Search by name");
    expect(out.text).toContain("Fixed\n- Fix the login crash (APP-9)");
    expect(out.leftOut.map((s) => s.id)).toEqual(["s3"]);
    expect(JSON.stringify(ws().releaseReadinesses)).toBe(before);
    const customers = await run<{ text: string }>("draft_notes", {
      releaseId: "r2",
      audience: "customers",
    });
    expect(customers.text).not.toContain("APP-9");
  });

  it("refuses to draft for a release with no done stories linked", async () => {
    expect(await run("draft_notes", { releaseId: "r2", audience: "customers" })).toMatchObject({
      drafted: false,
    });
  });

  it("saves and clears the notes", async () => {
    expect(
      await run("set_notes", { releaseId: "r1", audience: "customers", text: "  What's new  " })
    ).toMatchObject({ updated: true, cleared: false });
    expect(stored("r1")?.releaseNotes).toMatchObject({ audience: "customers", text: "What's new" });
    // A shipped release keeps its frozen gates; only the notes changed.
    expect(stored("r1")?.status).toBe("shipped");
    await run("set_notes", { releaseId: "r1", audience: "customers", text: "" });
    expect(stored("r1")?.releaseNotes).toBeUndefined();
    const schema = registry.get("tool.release_readiness.set_notes")!.paramsSchema;
    expect(
      schema.safeParse({ releaseId: "r1", audience: "team", text: "x".repeat(3001) }).success
    ).toBe(false);
  });

  it("works on the user's rows over MCP", async () => {
    server.rows.set(`workspace:releaseReadiness/${RELEASE_DOC_ID}`, docOf(planning, shipped));
    for (const s of STORIES) server.rows.set(`workspace:story/${s.id}`, s);
    await run("link_stories", { releaseId: "r2", storyIds: ["s2"] }, true);
    const draft = await run<{ text: string }>(
      "draft_notes",
      { releaseId: "r2", audience: "team" },
      true
    );
    expect(draft.text).toContain("Search by name");
    await run("set_notes", { releaseId: "r2", audience: "team", text: draft.text }, true);
    const doc = server.rows.get(`workspace:releaseReadiness/${RELEASE_DOC_ID}`) as ReleaseReadiness;
    expect(doc.releases[0]).toMatchObject({ storyIds: ["s2"], releaseNotes: { audience: "team" } });
    expect(stored("r2")?.storyIds).toBeUndefined();
  });
});
