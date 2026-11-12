/**
 * tool.quick_vote.* (tools plan P1.4): Amr reads Quick Vote as the page
 * does (the round being set up, the formats, the saved results, totals
 * only) and sets up a round the host then runs. start_round is closed to
 * visitors (an open live room asks it next) and refuses over MCP; the reads
 * come from the user's synced row there.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
  };
});

import { registry } from "@/lib/actions/registry";
import "@/lib/actions/tools/quick-vote";
import { hydrateQuickVote, useQuickVote, QUICK_VOTE_STORE_KEY } from "@/lib/quick-vote/store";
import { QUICK_VOTE_INITIAL } from "@/lib/quick-vote/state";
import { draftFromPreset } from "@/lib/quick-vote/draft";
import { presetById } from "@/lib/quick-vote/presets";
import { buildExample } from "@/app/(tools)/quick-vote/example";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u1",
  source,
  squadProfileIds: [] as string[],
});

const run = async (name: string, params: Record<string, unknown> = {}, mcp = false) => {
  const action = registry.get(`tool.quick_vote.${name}`);
  if (!action) throw new Error(`no action ${name}`);
  const parsed = action.paramsSchema.parse(params);
  return (mcp ? action.mcpHandler!(parsed, ctx("mcp")) : action.handler(parsed, ctx())) as Promise<
    Record<string, unknown>
  >;
};

const example = buildExample(new Date("2026-11-12T12:00:00Z"));
// The example's rows, as the page would have stored them (example ids are only a prefix).
const results = example.results.map((r, i) => ({ ...r, id: `qvr-${i}` }));

beforeEach(async () => {
  blobs.clear();
  await hydrateQuickVote();
  useQuickVote.setState({ ...QUICK_VOTE_INITIAL });
});

describe("registration", () => {
  it("registers the four verbs with their categories, start_round closed to visitors", () => {
    expect(registry.get("tool.quick_vote.list_state")?.category).toBe("read");
    expect(registry.get("tool.quick_vote.list_presets")?.category).toBe("read");
    expect(registry.get("tool.quick_vote.list_results")?.category).toBe("read");
    const start = registry.get("tool.quick_vote.start_round");
    expect(start?.category).toBe("write");
    expect(start?.visitor).toBe(false);
    for (const name of ["list_state", "list_presets", "start_round", "list_results"]) {
      expect(registry.get(`tool.quick_vote.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("list_presets", () => {
  it("lists every format with its kind, answers and threshold, plus the host's own", async () => {
    useQuickVote.setState({
      customPresets: example.customPresets.map((c) => ({ ...c, id: "mine" })),
    });
    const out = (await run("list_presets")) as {
      formats: {
        id: string;
        kind: string;
        answers: string[];
        showsFrom: number;
        yourOwn: string | null;
      }[];
      yourFormats: { id: string; name: string; format: string }[];
      feelings: { core: string }[];
    };
    expect(out.formats).toHaveLength(16);
    expect(out.formats.find((f) => f.id === "roman")).toMatchObject({
      kind: "choice",
      answers: ["Thumbs up", "Sideways", "Thumbs down"],
      showsFrom: 3,
      yourOwn: null,
    });
    expect(out.formats.find((f) => f.id === "esvp")?.showsFrom).toBe(5);
    expect(out.formats.find((f) => f.id === "poll")?.yourOwn).toBe("options");
    expect(out.yourFormats).toEqual([
      { id: "mine", name: "Sprint Review ROTI", format: "roti", question: expect.any(String) },
    ]);
    expect(out.feelings.map((f) => f.core)).toContain("Glad");
  });
});

describe("start_round", () => {
  it("sets up a poll on the page, checked like the form", async () => {
    const out = await run("start_round", {
      format: "poll",
      question: "Where should we hold the retro?",
      options: ["Meeting room", "Cafe", "Online"],
    });
    expect(out).toEqual({
      started: true,
      format: "poll",
      kind: "choice",
      question: "Where should we hold the retro?",
      answers: ["Meeting room", "Cafe", "Online"],
      showsFrom: 3,
    });
    expect(useQuickVote.getState().draft).toMatchObject({
      presetId: "poll",
      question: "Where should we hold the retro?",
      optionsText: "Meeting room\nCafe\nOnline",
    });
  });

  it("starts a format with its own answers, and the feelings wheel's second step", async () => {
    expect(await run("start_round", { format: "fist-of-five" })).toMatchObject({
      started: true,
      kind: "scale",
      answers: presetById("fist-of-five")!.points!.map((p) => p.label),
    });
    const feel = await run("start_round", { format: "feelings", feeling: "worried" });
    expect(feel).toMatchObject({
      started: true,
      question: "You picked worried: which word fits best?",
    });
    expect((feel.answers as string[])[0]).toBe("Nervous");
  });

  it("starts the host's saved format by its id", async () => {
    useQuickVote.setState({ customPresets: [{ ...example.customPresets[0], id: "mine" }] });
    const out = await run("start_round", { format: "mine" });
    expect(out).toMatchObject({ started: true, format: "roti" });
    expect(useQuickVote.getState().draft).toMatchObject({ presetId: "roti", customId: "mine" });
  });

  it("refuses what the form would: no format, misplaced fields, too few options", async () => {
    expect(await run("start_round", { format: "nope" })).toEqual({
      started: false,
      reason: "No format “nope”. list_presets gives the ids.",
    });
    expect(await run("start_round", { format: "roman", options: ["A", "B"] })).toEqual({
      started: false,
      reason: "Roman vote has its own answers; options don't apply.",
    });
    expect(await run("start_round", { format: "poll", options: ["Only one"] })).toEqual({
      started: false,
      reason: "The round isn't complete.",
      missing: ["Give at least 2 options, one per line."],
    });
    expect(await run("start_round", { format: "guess-number", min: 10, max: 5 })).toMatchObject({
      started: false,
      missing: ["The highest answer needs to be above the lowest."],
    });
    expect(useQuickVote.getState().draft).toBeNull();
  });

  it("refuses over MCP: rounds are set up where the page and its room are", async () => {
    const out = await run("start_round", { format: "roti" }, true);
    expect(out.started).toBe(false);
    expect(out.reason).toMatch(/in the browser/);
  });
});

describe("list_state and list_results", () => {
  it("says what is set up and what is missing", async () => {
    useQuickVote.setState({ draft: { ...draftFromPreset(presetById("poll")!), optionsText: "A" } });
    const out = (await run("list_state")) as {
      settingUp: Record<string, unknown>;
      results: number;
    };
    expect(out.settingUp).toMatchObject({
      format: "poll",
      kind: "choice",
      ready: false,
      missing: ["Give at least 2 options, one per line."],
    });
    expect(out.results).toBe(0);
  });

  it("lists saved rounds newest first in one line each, totals only", async () => {
    useQuickVote.setState({ results });
    const out = (await run("list_results", { limit: 2 })) as {
      total: number;
      results: Record<string, unknown>[];
    };
    expect(out.total).toBe(4);
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({
      format: "fist-of-five",
      kind: "scale",
      people: 6,
      how: "live room",
      summary: "6 people answered. Average 3.8 of 5; most said 4: I like it (3).",
      sentTo: [],
    });
    expect(out.results[1]).toMatchObject({ format: "guess-number", realAnswer: 11 });
    // Nothing per person ever: no ballots, names or member ids.
    expect(JSON.stringify(out)).not.toMatch(/ballot|member|identity/i);
  });

  it("reads the user's synced row over MCP", async () => {
    blobs.set(QUICK_VOTE_STORE_KEY, {
      results,
      customPresets: [],
      draft: { presetId: "roti", question: "Worth it?" },
    });
    const state = (await run("list_state", {}, true)) as {
      results: number;
      latest: { format: string };
      settingUp: { format: string; ready: boolean };
    };
    expect(state.results).toBe(4);
    expect(state.latest.format).toBe("fist-of-five");
    expect(state.settingUp).toMatchObject({ format: "roti", ready: true });
    const listed = (await run("list_results", {}, true)) as { total: number };
    expect(listed.total).toBe(4);
  });
});
