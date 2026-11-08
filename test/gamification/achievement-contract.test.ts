import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  achievements,
  achievementsByCategory,
  activeAchievements,
  retiredAchievements,
} from "@/lib/gamification/achievements";
import { ACHIEVEMENT_RULE_IDS, dispatch, isRelevantEvent } from "@/lib/gamification/engine";
import { recordOutcome } from "@/lib/gamification/ledger";
import { OUTCOMES } from "@/lib/gamification/outcomes";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { scanEmissions, scannedFiles } from "./emit-scan";

/**
 * The achievement catalog's contract: badges reward finished work, retired
 * badges are never evaluated and never revoked, and the engine only looks
 * at events a badge or challenge can use.
 */

const RETIRED = [
  "first-click",
  "hover-hundred",
  "scroll-floor",
  "combo-3",
  "combo-5",
  "kudos-combo-5",
  "marathon-30",
  "marathon-60",
  "audio-on",
  "audio-modes",
  "theme-toggle",
  "reduce-motion",
  "prompt-copier",
  "silent-run",
  "wip-disciplined",
  // `workspace-push` still has no emitter.
  "workspace-share",
];

const NEW_BADGES: Record<string, number> = {
  "first-win": 25,
  "busy-day": 100,
  "big-day": 300,
  "steady-week": 200,
  "steady-month": 500,
  "five-tool-finisher": 150,
  "ten-tool-finisher": 400,
  "kudos-week": 350,
  "deep-focus": 150,
  "full-ceremony": 150,
  unblocker: 200,
  "safe-keeper": 100,
};

describe("achievement catalog", () => {
  it("has unique ids", () => {
    expect(new Set(achievements.map((a) => a.id)).size).toBe(achievements.length);
  });

  it("retires exactly the input, time-on-site, preference and dead badges", () => {
    expect(retiredAchievements.map((a) => a.id).sort()).toEqual([...RETIRED].sort());
  });

  it("adds the outcome badges with their XP", () => {
    for (const [id, xp] of Object.entries(NEW_BADGES)) {
      const a = achievements.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a?.xp).toBe(xp);
      expect(a?.retired).toBeUndefined();
    }
  });

  it("gives every active badge a rule and no retired badge one", () => {
    const rules = new Set(ACHIEVEMENT_RULE_IDS);
    expect(activeAchievements.filter((a) => !rules.has(a.id)).map((a) => a.id)).toEqual([]);
    expect(retiredAchievements.filter((a) => rules.has(a.id)).map((a) => a.id)).toEqual([]);
    const known = new Set(achievements.map((a) => a.id));
    expect(ACHIEVEMENT_RULE_IDS.filter((id) => !known.has(id))).toEqual([]);
  });

  it("leaves retired badges out of the active list and the category groups", () => {
    expect(activeAchievements.some((a) => a.retired)).toBe(false);
    expect(activeAchievements.length + retiredAchievements.length).toBe(achievements.length);
    const grouped = Array.from(achievementsByCategory().values()).flat();
    expect(grouped).toHaveLength(activeAchievements.length);
  });

  it("has no rule reading combos, clicks, hovers or session minutes", () => {
    const engine = readFileSync(join(process.cwd(), "src/lib/gamification/engine.ts"), "utf8");
    const rulesBlock = engine.slice(
      engine.indexOf("const rules"),
      engine.indexOf("ACHIEVEMENT_RULE_IDS")
    );
    for (const banned of ["comboDepth", '"click"', '"hover"', "session-minutes", "silentMode"]) {
      expect(rulesBlock, banned).not.toContain(banned);
    }
    expect(engine).not.toContain("getCombo");
  });
});

describe("relevant events", () => {
  it("ignores raw input and settings", () => {
    for (const name of [
      "click",
      "hover",
      "key",
      "scroll-floor",
      "session-minute",
      "theme-toggle",
      "sonification-on",
      "audio-mode-used",
      "reduce-motion-on",
      "prompt-copied",
      "drag-drop",
      "workspace-push",
      "member-join",
      "room-connected",
    ]) {
      expect(isRelevantEvent(name), name).toBe(false);
    }
  });

  it("takes tool events, outcomes, secrets and the named signals", () => {
    for (const name of [
      "tool:kanban:card-done",
      "outcome:retro-finished",
      "secret:konami",
      "logo-whispered",
      "tool-visit",
      "export-png",
      "room-joined",
      "room-members",
      "invite-created",
      "sync-remote",
      "workspace-import",
      "backup-downloaded",
      "prestige-completed",
    ]) {
      expect(isRelevantEvent(name), name).toBe(true);
    }
  });
});

describe("retired badges in a real profile", () => {
  beforeAll(async () => {
    await useVDnaStore.persist.rehydrate();
  });
  beforeEach(() => {
    useVDnaStore.setState({
      unlocked: [],
      counters: {},
      xp: 0,
      lifetimeXp: 0,
      level: 1,
      dailyChallenges: [],
      weeklyChallenges: [],
      recentEvents: [],
      xpDay: { date: "", total: 0, byKey: {} },
      claims: {},
      onceKeys: [],
    });
  });

  it("are never awarded, whatever arrives", () => {
    // Counters the old rules read, as a long-time user's profile holds them.
    useVDnaStore.setState({
      counters: { hover: 500, click: 900, "session-minutes": 120, "audio-modes-used": 3 },
    });
    for (let i = 0; i < 10; i++) {
      for (const name of ["click", "hover", "scroll-floor", "theme-toggle", "workspace-push"]) {
        dispatch({ name });
      }
      dispatch({ name: "tool:kudos:sent" });
      recordOutcome("card-done", { meta: { toolId: "kanban" } });
    }
    const unlocked = useVDnaStore.getState().unlocked;
    expect(unlocked.filter((id) => RETIRED.includes(id))).toEqual([]);
    expect(unlocked).toContain("first-win");
  });

  it("are never revoked, and keep their XP", () => {
    useVDnaStore.setState({ unlocked: ["first-click", "combo-5", "silent-run"], xp: 425 });
    recordOutcome("card-done", { meta: { toolId: "kanban" } });
    const s = useVDnaStore.getState();
    expect(s.unlocked).toEqual(expect.arrayContaining(["first-click", "combo-5", "silent-run"]));
    expect(s.xp).toBeGreaterThan(425);
  });
});

describe("every badge rule can fire", () => {
  const engine = readFileSync(join(process.cwd(), "src/lib/gamification/engine.ts"), "utf8");
  const rulesBlock = engine.slice(
    engine.indexOf("const rules"),
    engine.indexOf("ACHIEVEMENT_RULE_IDS")
  );
  const literals = (re: RegExp) =>
    Array.from(new Set(Array.from(rulesBlock.matchAll(re), (m) => m[1])));

  /**
   * Badges whose tool event (or meta) nothing sends today. They predate the
   * outcome catalog and stay listed here until their tool emits; a new dead
   * rule fails the test, and wiring one of these fails it too until the
   * entry is removed.
   */
  const KNOWN_DEAD_TOOL_EVENTS = [
    "tool:velocity:sprint-added", // velocity-five
    "tool:decision-log:adr-new", // adr-writer
    "tool:release-planner:simulate", // release-forecast
    "tool:user-interviews:interview-new", // interview-ten
    "tool:kudos:squad-complete", // squad-booster-all
  ];

  it("names only outcomes that exist", () => {
    const ids = new Set(OUTCOMES.map((o) => `outcome:${o.id}`));
    const named = literals(/"(outcome:[a-z0-9-]+)"/g);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((n) => !ids.has(n))).toEqual([]);
  });

  it("names only tool events something emits (known dead ones listed)", () => {
    const emitted = new Set(scanEmissions().map((e) => e.name));
    const dead = literals(/"(tool:[a-z0-9-]+:[a-z0-9-]+)"/g).filter((n) => !emitted.has(n));
    expect(dead.sort()).toEqual([...KNOWN_DEAD_TOOL_EVENTS].sort());
  }, 30_000);

  it("has a sender in a mounted module for every named signal", () => {
    // Bare event names a rule compares against (evt === "room-joined").
    const named = literals(/\b(?:evt|e) === "([a-z][a-z0-9-]*)"/g).filter(
      (n) => n !== "logo-whispered"
    );
    expect(named).toEqual(
      expect.arrayContaining([
        "room-joined",
        "invite-created",
        "room-members",
        "backup-downloaded",
        "workspace-import",
        "sync-remote",
      ])
    );
    const files = scannedFiles();
    /** A module counts as mounted when another source file imports it. */
    const mounted = (path: string) => {
      const noExt = path.replace(/\.tsx?$/, "");
      const base = noExt.slice(noExt.lastIndexOf("/") + 1);
      const alias = `"@/${noExt}"`;
      const relative = new RegExp(`["']\\.{1,2}/(?:[^"']*/)?${base}["']`);
      return files.some(
        (f) => f.path !== path && (f.text.includes(alias) || relative.test(f.text))
      );
    };
    const senders = (name: string) =>
      files.filter(
        (f) =>
          f.text.includes(`signalGamification("${name}"`) ||
          f.text.includes(`dispatch({ name: "${name}"`) ||
          f.text.includes(`emitRtEvent("${name}")`) ||
          f.text.includes(`emitUiEvent("${name}")`)
      );
    const unsent = named.filter((n) => !senders(n).some((f) => mounted(f.path)));
    expect(unsent).toEqual([]);
  }, 30_000);
});
