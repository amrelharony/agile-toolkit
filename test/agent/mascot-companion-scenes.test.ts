import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import spec from "../../docs/mascot/companion-scenes.json";
import contextSpec from "../../docs/mascot/context-sheets.json";
import { FRAMES, PACKS, type PackId } from "@/components/agent/mascot/mascot-packs";
import { clipFrames, type FrameRef } from "@/components/agent/mascot/engine/clips";
import {
  COMPANION_SCENES,
  HOLD_SCENES,
  SCENES,
  sceneHold,
} from "@/components/agent/mascot/engine/scenes";
import {
  chooseShot,
  clipPacks,
  shippedScene,
  type ShotInput,
} from "@/components/agent/mascot/engine/sprite-poses";
import { installContextSenses } from "@/components/agent/mascot/engine/interactions/context";
import {
  installIntentSenses,
  STORY_AFTER_MS,
  type IntentHooks,
} from "@/components/agent/mascot/engine/interactions/intent";
import {
  handleMascotCommand,
  storyFor,
} from "@/components/agent/mascot/engine/customization/commands";
import {
  awaitDecision,
  CALM_AFTER_TROUBLE,
  DECISION_END_MS,
  DECISION_HOLD,
  decisionWaiting,
  isDeclined,
  noteTrouble,
  QUIET_HOLD,
  resetCompanion,
  showTrouble,
  TROUBLE_MS,
  troubleRecent,
} from "@/lib/agent/mascot/companion";
import { quietChange, watchQuiet } from "@/lib/agent/mascot/use-quiet-companion";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";
import {
  PAGE_PASTIMES,
  PLAY_SCENES,
  pagePastimes,
  pagePreloads,
} from "@/lib/agent/mascot/context/moments";
import { TOOL_SCENES } from "@/lib/agent/mascot/context/tool-scenes";
import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/notify/prefs";

const NAMES = spec.sheets.map((s) => s.pack);
const SLOT = (sheet: (typeof spec.sheets)[number], n: number) => sheet.slots[n - 2].id;

const CALM: ShotInput = {
  drag: null,
  reaction: null,
  micro: null,
  talking: false,
  look: null,
  reducedMotion: false,
  speed: 1,
  ready: () => true,
};

describe("the companion scenes and their spec", () => {
  it("ships one pack per sheet, its seven story frames in slot order", () => {
    for (const s of spec.sheets) {
      expect(PACKS[s.pack as PackId], s.id).toBeDefined();
      expect(s.slots.map((slot) => FRAMES[slot.id as keyof typeof FRAMES])).toEqual(
        s.slots.map((_, i) => [s.pack, i])
      );
    }
  });

  it("keeps the N ids, a 64-hex sha256 for the approved file, and no S number", () => {
    expect(spec.sheets.map((s) => s.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `N${String(i + 1).padStart(2, "0")}`)
    );
    for (const s of spec.sheets) expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    const contextPacks = new Set(contextSpec.sheets.map((s) => s.pack));
    for (const name of NAMES) expect(contextPacks.has(name), name).toBe(false);
  });

  it("plays each sheet as one scene from its own pack, every frame used", () => {
    for (const s of spec.sheets) {
      const c = SCENES[s.pack];
      expect(c, s.pack).toBeDefined();
      expect(clipPacks(c)).toEqual([s.pack]);
      const used = new Set(clipFrames(c));
      for (const slot of s.slots) expect(used.has(slot.id as FrameRef), slot.id).toBe(true);
    }
  });

  it("follows each sheet's segments: the way in once, the waiting frames held", () => {
    for (const s of spec.sheets) {
      const c = SCENES[s.pack];
      const seg = s.segments as { entry: number[]; hold?: number[]; illustration?: number[] };
      if (seg.illustration) {
        // Nothing real to hold for or approve: the whole story, played only on request.
        expect(c.steps.map((st) => st.f)).toEqual(seg.illustration.map((n) => SLOT(s, n)));
        expect(HOLD_SCENES[s.pack]).toBeUndefined();
        expect(COMPANION_SCENES.play).toContain(s.pack);
        continue;
      }
      expect(c.steps.map((st) => st.f)).toEqual(seg.entry.map((n) => SLOT(s, n)));
      if (seg.hold) {
        expect(HOLD_SCENES[s.pack], s.pack).toBeDefined();
        expect(c.loop!.map((st) => st.f)).toEqual(seg.hold.map((n) => SLOT(s, n)));
        expect(c.still).toBe(SLOT(s, seg.hold[0]));
      } else {
        expect(HOLD_SCENES[s.pack]).toBeUndefined();
        expect(c.loop).toBeUndefined();
      }
    }
  });

  it("names the same holds in the engine and in the hooks that set them", () => {
    expect(DECISION_HOLD).toBe(sceneHold(COMPANION_SCENES.decision));
    expect(QUIET_HOLD).toBe(sceneHold(COMPANION_SCENES.quiet));
    expect(HOLD_SCENES[COMPANION_SCENES.decision]).toBe("decision");
    expect(HOLD_SCENES[COMPANION_SCENES.quiet]).toBe("calm");
    for (const s of CALM_AFTER_TROUBLE) expect(SCENES[s]).toBeDefined();
  });

  it("never plays the AI reviewer, the retry or the decision on its own", () => {
    // No review service exists, no chat offers a Try again, and the decision is only for a real card.
    const automatic = new Set<string>([
      ...PLAY_SCENES,
      ...PAGE_PASTIMES.map((p) => p.scene),
      ...TOOL_SCENES.flatMap((t) => [...t.open, ...Object.values(t.actions).flat()]),
      COMPANION_SCENES.stuck,
      COMPANION_SCENES.storyRead,
    ]);
    for (const s of ["reviewer", "retry", "decide", "quiet"])
      expect(automatic.has(s), s).toBe(false);
    expect(COMPANION_SCENES.play).toContain("reviewer");
    expect(COMPANION_SCENES.play).toContain("retry");
    expect(COMPANION_SCENES.play).not.toContain("decide");
  });
});

describe("a held companion scene among his poses", () => {
  const decide = SCENES.decide;
  const quiet = SCENES.quiet;

  it("waits on a decision over talking and the idle poses", () => {
    const shot = chooseShot({ ...CALM, holds: [DECISION_HOLD, "sitting"], talking: true });
    expect(shot.clip).toBe(decide);
    expect(shot.hold).toBe(DECISION_HOLD);
  });

  it("gives way to being carried, a reaction and the phone's tilt", () => {
    expect(chooseShot({ ...CALM, holds: [DECISION_HOLD], drag: { vx: 0, at: 0 } }).clip?.name).toBe(
      "lifted"
    );
    expect(chooseShot({ ...CALM, holds: [DECISION_HOLD], reaction: "poke" }).clip?.name).toBe(
      "poke"
    );
    expect(chooseShot({ ...CALM, holds: [DECISION_HOLD, "whoa"] }).clip?.name).toBe("hold.whoa");
  });

  it("keeps the calm one under talking, and over the idle stance", () => {
    expect(chooseShot({ ...CALM, holds: [QUIET_HOLD], talking: true }).clip?.name).toBe("talk");
    const shot = chooseShot({ ...CALM, holds: [QUIET_HOLD] });
    expect(shot.clip).toBe(quiet);
    expect(shot.hold).toBe(QUIET_HOLD);
  });

  it("shows one waiting frame under reduced motion", () => {
    const shot = chooseShot({ ...CALM, holds: [DECISION_HOLD], reducedMotion: true });
    expect(shot.still).toBe(true);
    expect(shot.clip?.still).toBe("decide.wait-a");
    expect(quiet.still).toBe("quiet.settle-a");
  });

  it("stands in while its pack loads, and asks for it", () => {
    const shot = chooseShot({ ...CALM, holds: [DECISION_HOLD], ready: () => false });
    expect(shot.anim).toBe("frames");
    expect(shot.needs).toEqual(["decide"]);
  });

  it("ignores a held scene that isn't one of the held kind", () => {
    expect(chooseShot({ ...CALM, holds: ["scene:rabbit"] }).key).toMatch(/^idle/);
  });
});

describe("waiting for the visitor's decision", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCompanion();
    useMascotStore.getState().reset();
  });
  afterEach(() => {
    resetCompanion();
    vi.useRealTimers();
  });
  const holding = () => useMascotStore.getState().holds.includes(DECISION_HOLD);

  it("holds while a card waits, and lets go once it's answered or gone", () => {
    awaitDecision("approve", true);
    expect(holding()).toBe(true);
    expect(decisionWaiting()).toBe(true);
    awaitDecision("approve", false);
    expect(holding()).toBe(true); // a tick, in case another card follows
    vi.advanceTimersByTime(DECISION_END_MS);
    expect(holding()).toBe(false);
  });

  it("keeps waiting through two cards back to back, without offering the options anew", () => {
    awaitDecision("approve", true);
    awaitDecision("approve", false);
    awaitDecision("approve", true);
    vi.advanceTimersByTime(DECISION_END_MS * 2);
    expect(holding()).toBe(true);
  });

  it("waits while any card does", () => {
    awaitDecision("consent", true);
    awaitDecision("approve", true);
    awaitDecision("consent", false);
    vi.advanceTimersByTime(DECISION_END_MS);
    expect(holding()).toBe(true);
    awaitDecision("approve", false);
    vi.advanceTimersByTime(DECISION_END_MS);
    expect(holding()).toBe(false);
  });

  it("has no timer of its own: a card left alone keeps him waiting", () => {
    awaitDecision("approve", true);
    vi.advanceTimersByTime(60 * 60_000);
    expect(holding()).toBe(true);
  });
});

describe("the visitor saying no", () => {
  it("is a decision, not a failure: Deny, a closed card, a stopped turn", () => {
    expect(
      isDeclined({ is_error: true, content: "User denied execution of tasks.add_card." })
    ).toBe(true);
    expect(isDeclined({ is_error: true, content: "Cancelled." })).toBe(true);
    // Stopped while the action ran.
    expect(isDeclined({ is_error: true, content: "Handler error: cancelled" })).toBe(true);
    expect(
      isDeclined({
        is_error: true,
        content: [{ type: "text", text: "User denied execution of x." }],
      })
    ).toBe(true);
  });

  it("leaves a real failure, and a success, as they were", () => {
    expect(isDeclined({ is_error: true, content: "Tool not available: x" })).toBe(false);
    expect(isDeclined({ is_error: true, content: "Invalid input" })).toBe(false);
    expect(isDeclined({ content: "User denied execution of x." })).toBe(false);
  });
});

describe("trouble", () => {
  afterEach(() => resetCompanion());

  it("lasts a few minutes", () => {
    noteTrouble(1000);
    expect(troubleRecent(1000 + TROUBLE_MS - 1)).toBe(true);
    expect(troubleRecent(1000 + TROUBLE_MS)).toBe(false);
  });

  it("lasts while a crashed tool's page stays up, and a few minutes after", () => {
    showTrouble(true);
    expect(troubleRecent(Date.now() + 10 * TROUBLE_MS)).toBe(true);
    showTrouble(false);
    expect(troubleRecent()).toBe(true);
    expect(troubleRecent(Date.now() + TROUBLE_MS + 1)).toBe(false);
  });
});

describe("the page pastimes", () => {
  it("fit the page: priorities, flow, retros and boards", () => {
    expect(pagePastimes("/wsjf")).toEqual(["dino"]);
    expect(pagePastimes("/prioritizer/abc")).toEqual(["dino"]);
    expect(pagePastimes("/kanban")).toEqual(["octopus", "escape"]);
    expect(pagePastimes("/retro")).toEqual(["ahwa", "escape"]);
    expect(pagePastimes("/retro-actions")).toEqual(["ahwa"]);
    expect(pagePastimes("/retrospective")).toEqual([]);
    expect(pagePastimes("/comics")).toEqual([]);
    expect(pagePreloads("/comics/ep/31")).toEqual(["comic"]);
    expect(pagePreloads("/kanban")).toEqual([]);
  });

  describe("while he passes the time", () => {
    const played: string[] = [];
    const install = (path: string) =>
      installContextSenses({
        act: (r) => played.push(r),
        allow: () => true,
        busy: () => false,
        want: () => undefined,
        path: () => path,
        weather: async () => null,
        weekend: () => [5, 6],
        shipped: (s) => s === "ahwa" || s === "escape",
        now: () => new Date(Date.now()),
        random: () => 0,
        storage: null,
        later: (fn) => {
          fn();
          return 0;
        },
      });
    beforeEach(() => {
      played.length = 0;
      resetCompanion();
    });
    afterEach(() => resetCompanion());

    it("may share a knowing look with the ahwa cup on a retro", () => {
      const c = install("/retro");
      expect(c.play()).toBe(true);
      expect(played.at(-1)).toBe("scene:ahwa");
      c.dispose();
    });

    it("keeps the knowing look away from something that just went wrong", () => {
      noteTrouble();
      const c = install("/retro");
      expect(c.play()).toBe(true);
      expect(played.at(-1)).toBe("scene:escape");
      c.dispose();
    });
  });
});

describe("someone stuck", () => {
  let acts: MascotReaction[];
  let offers: number;
  let troubles: number;
  let t: number;
  let dispose: () => void;
  const install = (over: Partial<IntentHooks> = {}) => {
    dispose = installIntentSenses({
      act: (r) => acts.push(r),
      allow: () => true,
      busy: () => false,
      path: () => "/retro",
      offerHelp: () => {
        offers++;
        return true;
      },
      suggestStretch: () => undefined,
      isControl: () => false,
      trouble: () => troubles++,
      now: () => t,
      storage: null,
      ...over,
    }).dispose;
  };
  const rage = () => {
    for (let i = 0; i < 3; i++) {
      t += 200;
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 })
      );
    }
  };
  beforeEach(() => {
    vi.useFakeTimers();
    acts = [];
    offers = 0;
    troubles = 0;
    t = 0;
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it("offers a hand at once, and the deadline rabbit's story plays beside it", () => {
    install({ stuckScene: () => "scene:rabbit" });
    rage();
    expect(offers).toBe(1); // help never waits for the story
    expect(acts).toEqual([]);
    vi.advanceTimersByTime(STORY_AFTER_MS);
    expect(acts).toEqual(["scene:rabbit"]);
    expect(troubles).toBe(1);
  });

  it("plays no story of help when the offer can't be shown (Quiet, Focus, quiet hours)", () => {
    install({ stuckScene: () => "scene:rabbit", offerHelp: () => false });
    rage();
    vi.advanceTimersByTime(STORY_AFTER_MS * 3);
    expect(acts).toEqual(["concerned"]);
  });

  it("looks concerned, then offers, when there's no story to play", () => {
    install({ stuckScene: () => null });
    rage();
    expect(acts).toEqual(["concerned"]);
    expect(offers).toBe(0);
    vi.advanceTimersByTime(1300);
    expect(offers).toBe(1);
  });
});

describe("/play", () => {
  beforeEach(() => useMascotStore.getState().reset());

  it("acts out the story asked for, by its name or a plain word for it", () => {
    expect(storyFor("reviewer", null)).toBe("reviewer");
    expect(storyFor("dinosaur", null)).toBe("dino");
    expect(storyFor("sticky", null)).toBe("escape");
    expect(storyFor("bell", null)).toBe("quiet");
  });

  it("takes them in turn when none is named, or the name isn't one", () => {
    const first = storyFor(undefined, null);
    expect(first).toBe(COMPANION_SCENES.play[0]);
    expect(storyFor(undefined, first)).toBe(COMPANION_SCENES.play[1]);
    expect(storyFor("nonsense", COMPANION_SCENES.play.at(-1)!)).toBe(COMPANION_SCENES.play[0]);
  });

  it("never offers the decision: that waits for a real card", () => {
    expect(storyFor("decide", null)).not.toBe("decide");
  });

  it("plays it now, and keeps the command out of the AI chat", () => {
    expect(handleMascotCommand("/play reviewer")).toBe(true);
    expect(useMascotStore.getState().reactionQueue).toEqual(["scene:reviewer"]);
    expect(handleMascotCommand("/PLAY")).toBe(true);
    expect(handleMascotCommand("/playful")).toBe(false);
    for (const s of COMPANION_SCENES.play) expect(shippedScene(s), s).toBeDefined();
  });
});

describe("Quiet Companion", () => {
  type Prefs = Parameters<typeof quietChange>[0];
  const prefs = (over: Partial<Prefs> = {}) =>
    ({ ...DEFAULT_NOTIFICATION_PREFS, ...over }) as unknown as Prefs;

  it("covers the bell only when the visitor chooses Quiet", () => {
    const balanced = prefs({ celebrationLevel: "balanced" });
    const quiet = prefs({ celebrationLevel: "quiet" });
    expect(quietChange(quiet, balanced, true)).toBe("on");
    // The stored setting arriving as the page loads isn't a choice made now.
    expect(quietChange(quiet, balanced, false)).toBeNull();
    // Nor is an old silent mode moved onto Quiet.
    expect(
      quietChange(prefs({ celebrationLevel: "quiet", silentModeAdopted: true }), balanced, true)
    ).toBeNull();
    expect(quietChange(balanced, quiet, false)).toBe("off");
    expect(quietChange(quiet, quiet, true)).toBeNull();
  });

  describe("held", () => {
    const fakeStore = () => {
      const store = create<Prefs>()(() => prefs({ celebrationLevel: "balanced" }));
      return Object.assign(store, { persist: { hasHydrated: () => true } });
    };
    let store: ReturnType<typeof fakeStore>;
    let stop: () => void;
    const holding = () => useMascotStore.getState().holds.includes(QUIET_HOLD);
    beforeEach(() => {
      useMascotStore.getState().reset();
      store = fakeStore();
      stop = watchQuiet(store as never);
    });
    afterEach(() => stop());

    it("while Quiet is still the setting", () => {
      store.setState({ celebrationLevel: "quiet" });
      expect(holding()).toBe(true);
      store.setState({ celebrationLevel: "lively" });
      expect(holding()).toBe(false);
    });

    it("until he's handled", () => {
      store.setState({ celebrationLevel: "quiet" });
      useMascotStore.getState().playNow("poke");
      expect(holding()).toBe(false);
    });

    it("through his own waking (a key pressed while he sat): that isn't the visitor handling him", () => {
      store.setState({ celebrationLevel: "quiet" });
      useMascotStore.getState().playNow("standUp");
      useMascotStore.getState().playNow("wake");
      expect(holding()).toBe(true);
    });

    it("until the page changes (the watch ends)", () => {
      store.setState({ celebrationLevel: "quiet" });
      stop();
      expect(holding()).toBe(false);
      stop = () => undefined;
    });

    it("changes no setting itself", () => {
      store.setState({ celebrationLevel: "quiet" });
      expect(store.getState().celebrationLevel).toBe("quiet");
      useMascotStore.getState().playNow("poke");
      expect(store.getState().celebrationLevel).toBe("quiet");
    });
  });
});
