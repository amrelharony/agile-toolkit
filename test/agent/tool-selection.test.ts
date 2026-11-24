/**
 * Tool-selection helpers that keep per-turn trimming correct: ranking against
 * the recent user context (so follow-ups keep their referents) and keeping every
 * tool the transcript already references (so the request body stays valid),
 * and the per-turn tool set that replaced the old "send the whole registry"
 * fallback.
 */

import { describe, it, expect } from "vitest";
import "@/lib/actions/register-all";
import { registry, claudeNameFromId } from "@/lib/actions/registry";
import { tools, getToolById } from "@/lib/constants/tools";
import { rankActionIds } from "@/lib/agent/mascot/kb";
import {
  CORE_WORKSPACE_GROUPS,
  MAX_TOOLS_PER_TURN,
  PAGE_ACTION_GROUPS,
  PAGE_ACTIONS,
  PAGE_READ_GROUPS,
  pageActionGroups,
  pageActions,
  recentUserText,
  selectTurnToolIds,
  toolNamesInHistory,
} from "@/lib/agent/tool-selection";
import type {
  ChatMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
} from "@/lib/agent/types";

const text = (t: string): TextBlock => ({ type: "text", text: t });
const toolUse = (name: string): ToolUseBlock => ({
  type: "tool_use",
  id: `t_${name}`,
  name,
  input: {},
});
const toolResult = (): ToolResultBlock => ({
  type: "tool_result",
  tool_use_id: "x",
  content: "{}",
});

let n = 0;
function msg(role: ChatMessage["role"], content: ContentBlock[]): ChatMessage {
  return { id: `m${n++}`, role, content, createdAt: new Date().toISOString() };
}

describe("recentUserText", () => {
  it("concatenates the last 2 user messages oldest-first, skipping non-user roles", () => {
    const msgs = [
      msg("user", [text("create a sprint called Sprint 47")]),
      msg("assistant", [toolUse("workspace_sprint_create")]),
      msg("tool", [toolResult()]),
      msg("user", [text("rename it")]),
    ];
    expect(recentUserText(msgs)).toBe("create a sprint called Sprint 47 rename it");
  });

  it("honours n", () => {
    const msgs = [
      msg("user", [text("one")]),
      msg("user", [text("two")]),
      msg("user", [text("three")]),
    ];
    expect(recentUserText(msgs, 2)).toBe("two three");
    expect(recentUserText(msgs, 1)).toBe("three");
  });

  it("returns '' when there are no user-text messages", () => {
    expect(recentUserText([])).toBe("");
    expect(recentUserText([msg("assistant", [text("hi")])])).toBe("");
  });
});

describe("toolNamesInHistory", () => {
  it("collects assistant tool_use names, deduped across turns", () => {
    const msgs = [
      msg("user", [text("go")]),
      msg("assistant", [text("ok"), toolUse("workspace_sprint_create")]),
      msg("tool", [toolResult()]),
      msg("assistant", [toolUse("workspace_sprint_create"), toolUse("workspace_story_create")]),
    ];
    expect(new Set(toolNamesInHistory(msgs))).toEqual(
      new Set(["workspace_sprint_create", "workspace_story_create"])
    );
  });

  it("returns [] when no tools were called", () => {
    expect(
      toolNamesInHistory([msg("user", [text("hi")]), msg("assistant", [text("hello")])])
    ).toEqual([]);
  });
});

describe("pageActionGroups", () => {
  it("names the page's own groups first, then where else its actions live", () => {
    expect(pageActionGroups("planning-poker")).toEqual([
      "tool.planning_poker",
      "workspace.planning_poker",
      "workspace.poker_estimation_log",
    ]);
    expect(pageActionGroups("retro")).toEqual([
      "tool.retro",
      "workspace.retro",
      "workspace.retro_board",
    ]);
    // Actions under a different name than the page.
    expect(pageActionGroups("ceremony-timer")).toContain("tool.ceremony_cadence");
    // Quick Vote only reads the places its options come from (PAGE_READ_GROUPS).
    expect(pageActionGroups("quick-vote")).toEqual(["tool.quick_vote", "workspace.quick_vote"]);
    // A page with no extras keeps just its two defaults.
    expect(pageActionGroups("model-card")).toEqual(["tool.model_card", "workspace.model_card"]);
  });
});

describe("pageActions", () => {
  const actions = [
    { id: "tool.retro.add_card", category: "write" },
    { id: "tool.retro.list_state", category: "read" },
    { id: "workspace.retro_board.create", category: "write" },
    { id: "workspace.retro_board.list", category: "read" },
    { id: "workspace.story.create", category: "write" },
    { id: "workspace.story.list", category: "read" },
    { id: "workspace.sprint.list", category: "read" },
    { id: "tool.audience_wall.add_wall", category: "write" },
    { id: "tool.audience_wall.room_status", category: "read" },
    { id: "tool.audience_wall.reveal", category: "write" },
    { id: "tool.quick_vote.list_state", category: "read" },
  ];
  const ids = (toolId: string) => pageActions(toolId, actions).map((a) => a.id);

  it("gives the page's own groups' actions, reads first, then writes", () => {
    expect(ids("retro")).toEqual([
      "tool.retro.list_state",
      "workspace.retro_board.list",
      "tool.retro.add_card",
      "workspace.retro_board.create",
    ]);
  });

  it("adds only the reads of the groups a page only reads, after its own", () => {
    // Quick Vote reads backlog items, stories and retro boards.
    expect(ids("quick-vote")).toEqual([
      "tool.quick_vote.list_state",
      "workspace.story.list",
      "workspace.retro_board.list",
    ]);
  });

  it("adds a page's single verbs, and no other action of their group", () => {
    const review = ids("sprint-review");
    expect(review).toContain("tool.audience_wall.room_status");
    expect(review).toContain("tool.audience_wall.reveal");
    expect(review).not.toContain("tool.audience_wall.add_wall");
    expect(review.indexOf("tool.audience_wall.room_status")).toBeLessThan(
      review.indexOf("tool.audience_wall.reveal")
    );
  });

  it("gives a page with no own actions its read groups' reads, then the core reads", () => {
    // Relative Sizing has no actions of its own yet; it reads stories.
    const sizing = ids("relative-sizing");
    expect(sizing[0]).toBe("workspace.story.list");
    expect(sizing).toContain("workspace.sprint.list");
    expect(sizing.filter((id) => id === "workspace.story.list")).toHaveLength(1);
    expect(sizing.every((id) => id.endsWith(".list"))).toBe(true);
  });
});

describe("selectTurnToolIds", () => {
  const actions = [
    { id: "tool.retro.add_card", category: "write" },
    { id: "tool.retro.list_state", category: "read" },
    { id: "tool.retro_extra.thing", category: "read" }, // a different tool, same stem
    { id: "workspace.sprint.create", category: "write" },
    { id: "workspace.sprint.list", category: "read" },
    { id: "workspace.story.create", category: "write" },
    { id: "intent.summarize_workspace", category: "intent" },
    { id: "intent.plan_sprint", category: "intent" },
  ];

  it("orders: history, the open tool's reads then writes, ranked, then intents", () => {
    expect(
      selectTurnToolIds({
        actions,
        toolId: "retro",
        rankedIds: ["workspace.sprint.list", "tool.retro.add_card"],
        historyIds: ["workspace.story.create"],
      })
    ).toEqual([
      "workspace.story.create",
      "tool.retro.list_state",
      "tool.retro.add_card",
      "workspace.sprint.list",
      "intent.summarize_workspace",
      "intent.plan_sprint",
    ]);
  });

  it("with no user text (nothing ranked) offers the open tool and the intents, not everything", () => {
    const ids = selectTurnToolIds({ actions, toolId: "retro", rankedIds: [] });
    expect(ids).toEqual([
      "tool.retro.list_state",
      "tool.retro.add_card",
      "intent.summarize_workspace",
      "intent.plan_sprint",
    ]);
    expect(selectTurnToolIds({ actions })).toEqual([
      "intent.summarize_workspace",
      "intent.plan_sprint",
    ]);
  });

  it("matches the page's groups on each action's toolId, so actions kept under another name count", () => {
    const withCadence = [
      ...actions,
      { id: "tool.ceremony_cadence.set", category: "write", toolId: "tool.ceremony_cadence" },
      { id: "tool.ceremony_cadence.get", category: "read", toolId: "tool.ceremony_cadence" },
    ];
    expect(selectTurnToolIds({ actions: withCadence, toolId: "ceremony-timer" })).toEqual([
      "tool.ceremony_cadence.get",
      "tool.ceremony_cadence.set",
      "intent.summarize_workspace",
      "intent.plan_sprint",
    ]);
  });

  it("gives a page with no actions of its own the core workspace reads", () => {
    expect(selectTurnToolIds({ actions, toolId: "tech-radar" })).toEqual([
      "workspace.sprint.list",
      "intent.summarize_workspace",
      "intent.plan_sprint",
    ]);
  });

  it("skips ids the registry doesn't know and never repeats one", () => {
    expect(
      selectTurnToolIds({
        actions,
        rankedIds: ["ghost.action", "workspace.sprint.list", "workspace.sprint.list"],
        historyIds: ["also.ghost", "workspace.sprint.list"],
      })
    ).toEqual(["workspace.sprint.list", "intent.summarize_workspace", "intent.plan_sprint"]);
  });

  it("caps at max, but always keeps every tool the chat already used", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `w.a${i}`, category: "read" }));
    const ranked = many.map((a) => a.id);
    expect(selectTurnToolIds({ actions: many, rankedIds: ranked })).toHaveLength(
      MAX_TOOLS_PER_TURN
    );
    expect(selectTurnToolIds({ actions: many, rankedIds: ranked, max: 5 })).toEqual(
      ranked.slice(0, 5)
    );
    // History past the cap is still sent: dropping one would make the body
    // invalid. It doesn't use up the cap either, so fresh picks still come.
    const history = ranked.slice(90);
    const ids = selectTurnToolIds({
      actions: many,
      rankedIds: ranked,
      historyIds: history,
      max: 5,
    });
    expect(ids).toEqual([...history, ...ranked.slice(0, 5)]);
  });

  it("still offers the open tool after a long conversation used many tools", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `w.a${i}`, category: "read" }));
    const ids = selectTurnToolIds({
      actions: [...actions, ...many],
      toolId: "retro",
      historyIds: many.map((a) => a.id),
    });
    expect(ids).toContain("tool.retro.list_state");
    expect(ids).toContain("intent.plan_sprint");
  });
});

describe("selectTurnToolIds on the real registry", () => {
  const all = registry.list();
  const pick = (opts: { toolId?: string | null; text?: string; history?: string[] }) =>
    selectTurnToolIds({
      actions: all,
      toolId: opts.toolId,
      rankedIds: opts.text ? rankActionIds(opts.text, MAX_TOOLS_PER_TURN) : [],
      historyIds: opts.history,
    });

  it("the registry is far too big to send whole", () => {
    expect(all.length).toBeGreaterThan(MAX_TOOLS_PER_TURN * 4);
  });

  it("never falls back to the whole registry, whatever the ask", () => {
    for (const opts of [
      {},
      { text: "" },
      { text: "hi" },
      { text: "zzqx" },
      { toolId: "planning-poker" },
      { toolId: "planning-poker", text: "do it" },
      { text: "create a sprint called Sprint 47 and add three stories" },
    ]) {
      const ids = pick(opts);
      expect(ids.length).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
      expect(ids.length).toBeLessThan(all.length);
    }
  });

  it("always offers the open tool's own actions, reads first", () => {
    const groups = new Set(pageActionGroups("planning-poker"));
    const own = all.filter((a) => groups.has(a.toolId));
    expect(own.some((a) => a.id.startsWith("tool.planning_poker."))).toBe(true);
    expect(own.some((a) => a.id.startsWith("workspace.poker_estimation_log."))).toBe(true);
    const ids = pick({ toolId: "planning-poker", text: "hi" });
    const reads = own.filter((a) => a.category === "read").length;
    expect(ids.slice(0, own.length).sort()).toEqual(own.map((a) => a.id).sort());
    for (const id of ids.slice(0, reads)) {
      expect(registry.get(id)?.category).toBe("read");
    }
  });

  describe("every page reaches its own actions", () => {
    const groups = new Set(all.map((a) => a.toolId));

    it("PAGE_ACTION_GROUPS names only real pages and real action groups", () => {
      for (const [page, extra] of Object.entries(PAGE_ACTION_GROUPS)) {
        expect(getToolById(page), page).toBeDefined();
        for (const g of extra) expect(groups.has(g), `${page} → ${g}`).toBe(true);
      }
      for (const g of CORE_WORKSPACE_GROUPS) expect(groups.has(g), g).toBe(true);
    });

    it("every tool.* and workspace.* action group belongs to some page", () => {
      const reached = new Set(tools.flatMap((t) => pageActionGroups(t.id)));
      const orphans = Array.from(groups).filter(
        (g) => (g.startsWith("tool.") || g.startsWith("workspace.")) && !reached.has(g)
      );
      // A new group needs a PAGE_ACTION_GROUPS entry (or a page named after
      // it), or the agent only ever finds it through KB ranking.
      expect(orphans).toEqual([]);
    });

    it("a vague ask with nothing ranked still offers each page's actions", () => {
      for (const t of tools) {
        const pageGroups = new Set(pageActionGroups(t.id));
        const own = all.filter((a) => pageGroups.has(a.toolId)).map((a) => a.id);
        const ids = selectTurnToolIds({ actions: all, toolId: t.id, rankedIds: [] });
        expect(ids.length, t.id).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
        if (own.length > 0) {
          // Every own action fits under the cap, so none is cut.
          expect(
            own.filter((id) => !ids.includes(id)),
            t.id
          ).toEqual([]);
        } else {
          // No agent actions for this page's data: the workspace's main reads.
          expect(ids, t.id).toContain("workspace.story.list");
        }
      }
    });

    it("pins the pages whose actions don't live under tool.<id>", () => {
      expect(pick({ toolId: "ceremony-timer", text: "add one" })).toContain(
        "tool.ceremony_cadence.set"
      );
      expect(pick({ toolId: "model-card", text: "add one" })).toContain(
        "workspace.model_card.create"
      );
      expect(pick({ toolId: "retro", text: "what's on this board?" })).toContain(
        "workspace.retro_board.list"
      );
      expect(pick({ toolId: "sprint-planning", text: "add one" })).toContain(
        "workspace.story.create"
      );
      expect(pick({ toolId: "stakeholder-map", text: "add one" })).toContain(
        "workspace.team_member.list"
      );
      // Sprint Review's feedback room is an Audience Wall room.
      const review = pick({ toolId: "sprint-review", text: "reveal the posts" });
      for (const verb of ["room_status", "open_round", "set_open", "reveal", "lower_hands"]) {
        expect(review, verb).toContain(`tool.audience_wall.${verb}`);
      }
      expect(review).toContain("tool.sprint_review.add_feedback");
      // Only the room verbs: not the wall's own writes, scoring or saved sessions.
      const vague = pick({ toolId: "sprint-review" });
      for (const verb of ["room_status", "open_round", "set_open", "reveal", "lower_hands"]) {
        expect(vague, verb).toContain(`tool.audience_wall.${verb}`);
      }
      for (const verb of ["add_wall", "scoring", "list_sessions"]) {
        expect(vague, verb).not.toContain(`tool.audience_wall.${verb}`);
      }
    });

    it("gives Quick Vote the reads of its options' places, and none of their writes", () => {
      const own = pageActions("quick-vote", all).map((a) => a.id);
      const sources = ["workspace.backlog_item", "workspace.story", "workspace.retro_board"];
      // Quick Vote's options come from the backlog, the stories and the retro.
      for (const g of sources) expect(own, g).toContain(`${g}.list`);
      expect(own.indexOf("tool.quick_vote.list_state")).toBeLessThan(
        own.indexOf("workspace.backlog_item.list")
      );
      const ids = pick({ toolId: "quick-vote" });
      for (const g of sources) {
        expect(ids, g).toContain(`${g}.list`);
        for (const verb of ["create", "update", "delete"]) {
          expect(ids, `${g}.${verb}`).not.toContain(`${g}.${verb}`);
        }
      }
    });

    it("keeps every page's actions within one turn's tools", () => {
      for (const t of tools) {
        expect(pageActions(t.id, all).length, t.id).toBeLessThanOrEqual(MAX_TOOLS_PER_TURN);
      }
    });

    it("PAGE_READ_GROUPS and PAGE_ACTIONS name only real pages, groups with reads and real actions", () => {
      for (const [page, read] of Object.entries(PAGE_READ_GROUPS)) {
        expect(getToolById(page), page).toBeDefined();
        for (const g of read) {
          expect(
            all.some((a) => a.toolId === g && a.category === "read"),
            `${page} reads ${g}`
          ).toBe(true);
        }
      }
      for (const [page, ids] of Object.entries(PAGE_ACTIONS)) {
        expect(getToolById(page), page).toBeDefined();
        for (const id of ids) expect(registry.get(id), `${page} → ${id}`).toBeDefined();
      }
    });

    it("no page both writes and only reads a group, or only reads one of its own", () => {
      for (const [page, read] of Object.entries(PAGE_READ_GROUPS)) {
        const own = pageActionGroups(page);
        for (const g of read) expect(own, `${page} → ${g}`).not.toContain(g);
      }
    });

    it("gives Quick Vote the reads of the places its options come from, after its own", () => {
      const ids = pick({ toolId: "quick-vote", text: "vote on these" });
      const sources = ["workspace.backlog_item", "workspace.story", "workspace.retro_board"];
      for (const g of sources) expect(ids, g).toContain(`${g}.list`);
      expect(ids.indexOf("tool.quick_vote.list_state")).toBeLessThan(
        ids.indexOf("workspace.backlog_item.list")
      );
      // Every read comes before the first write.
      const firstWrite = ids.findIndex((id) => registry.get(id)?.category !== "read");
      for (const g of sources) {
        expect(ids.indexOf(`${g}.list`), g).toBeLessThan(firstWrite);
      }
    });
  });

  it("keeps tools the conversation already used, even off-topic ones", () => {
    const used = "tool.adkar.list_state";
    expect(registry.get(used)).toBeDefined();
    const ids = pick({ toolId: "planning-poker", text: "cast my vote", history: [used] });
    expect(ids[0]).toBe(used);
  });

  it("keeps the request a small fraction of the full tool list", () => {
    const full = JSON.stringify(registry.toOpenAiTools()).length;
    const wanted = new Set(
      pick({ toolId: "retro", text: "add a card about flaky CI" }).map((id) => claudeNameFromId(id))
    );
    const turn = JSON.stringify(
      registry.toOpenAiTools().filter((t) => wanted.has(t.function.name))
    ).length;
    expect(full).toBeGreaterThan(300_000); // ~590 KB measured with 831 actions
    expect(turn).toBeLessThan(full / 5);
  });
});
