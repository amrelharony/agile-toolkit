import { describe, expect, it } from "vitest";
import { FRAMES, PACKS, type PackId } from "@/components/agent/mascot/mascot-packs";
import {
  ACT_CLIPS,
  HOLD_CLIPS,
  LIFTED_CLIP,
  STROLL_FROM_LEFT,
  STROLL_FROM_RIGHT,
  TALK_CLIP,
  clipFrameAt,
  clipFrames,
  clipMs,
  type Clip,
} from "@/components/agent/mascot/engine/clips";
import {
  POSES,
  SHEET,
  chooseShot,
  clipPacks,
  pointToward,
  reactionSeconds,
  type ShotInput,
} from "@/components/agent/mascot/engine/sprite-poses";
import { createTalker } from "@/components/agent/mascot/engine/talk";
import { SCENES } from "@/components/agent/mascot/engine/scenes";

const ALL: Clip[] = [
  ...Object.values(ACT_CLIPS),
  ...Object.values(HOLD_CLIPS),
  TALK_CLIP,
  LIFTED_CLIP,
  STROLL_FROM_LEFT,
];

const CALM: ShotInput = {
  drag: null,
  reaction: null,
  micro: null,
  talking: false,
  look: null,
  reducedMotion: false,
  speed: 1,
};
const LOADED: ShotInput = { ...CALM, ready: () => true };

describe("the clips", () => {
  it.each(ALL.map((c) => [c.name, c] as const))("%s shows only frames that exist", (_n, c) => {
    for (const f of clipFrames(c)) {
      if (f.startsWith("base:")) {
        const [, row, col] = f.split(":").map(Number);
        expect(row).toBeLessThan(SHEET.rows);
        expect(col).toBeLessThan(SHEET.columns);
      } else {
        expect(FRAMES).toHaveProperty([f]);
      }
    }
    expect(POSES).toHaveProperty([c.fallback]);
  });

  it("gives every pack a use: the core packs in the clips, each context pack in a scene", () => {
    const used = new Set([...ALL, ...Object.values(SCENES)].flatMap(clipPacks));
    expect(Array.from(used).sort()).toEqual((Object.keys(PACKS) as PackId[]).sort());
  });

  it("times a reaction by its clip", () => {
    expect(reactionSeconds("poke")).toBeCloseTo(1.1);
    expect(clipMs(ACT_CLIPS.land)).toBe(170 + 280 + 650);
    // The live-sheet reactions keep their loops.
    expect(reactionSeconds("wave")).toBeCloseTo(2);
  });

  it("steps through a reaction and keeps its last frame", () => {
    expect(clipFrameAt(ACT_CLIPS.poke, 0).f).toBe("touch.poke");
    expect(clipFrameAt(ACT_CLIPS.poke, 339).f).toBe("touch.poke");
    expect(clipFrameAt(ACT_CLIPS.poke, 340).f).toBe("touch.giggle");
    expect(clipFrameAt(ACT_CLIPS.poke, 99_999).f).toBe("touch.giggle");
  });

  it("loops a hold for as long as it lasts", () => {
    const doze = HOLD_CLIPS.dozing;
    expect(clipFrameAt(doze, 0).f).toBe("rest.doze-a");
    expect(clipFrameAt(doze, 1600).f).toBe("rest.doze-b");
    expect(clipFrameAt(doze, 3200 * 10 + 100).f).toBe("rest.doze-a");
    // Sitting down first, then sitting.
    expect(clipFrameAt(HOLD_CLIPS.sitting, 0).f).toBe("rest.sit-down");
    expect(clipFrameAt(HOLD_CLIPS.sitting, 5000).f).toBe("rest.sitting");
  });

  it("brings him back from a stroll to where he started", () => {
    for (const c of [STROLL_FROM_RIGHT, STROLL_FROM_LEFT]) {
      const end = clipFrameAt(c, clipMs(c) - 1);
      expect(Math.abs(end.x)).toBeLessThan(0.5);
      // Halfway, he's out along the bottom, the right way.
      const mid = clipFrameAt(c, clipMs(c) / 2);
      expect(Math.abs(mid.x)).toBeGreaterThan(100);
    }
    expect(clipFrameAt(STROLL_FROM_RIGHT, clipMs(STROLL_FROM_RIGHT) / 2).x).toBeLessThan(0);
    expect(clipFrameAt(STROLL_FROM_LEFT, clipMs(STROLL_FROM_LEFT) / 2).x).toBeGreaterThan(0);
    // Walking left shows the watch side, right the band side.
    expect(clipFrameAt(STROLL_FROM_RIGHT, 300).f).toMatch(/^stroll\.l-/);
    expect(clipFrameAt(STROLL_FROM_LEFT, 300).f).toMatch(/^stroll\.r-/);
  });
});

describe("choosing a shot with the packs", () => {
  it("stands in a live-sheet pose until the clip's pack loads, and asks for it", () => {
    const shot = chooseShot({ ...CALM, reaction: "poke" });
    expect(shot.anim).toBe("frames");
    expect(shot.row).toBe(POSES.jumping.row);
    expect(shot.needs).toEqual(["touch"]);
    const ready = chooseShot({ ...LOADED, reaction: "poke" });
    expect(ready).toMatchObject({ anim: "clip", key: "clip:poke" });
    expect(ready.clip).toBe(ACT_CLIPS.poke);
    expect(ready.needs).toBeUndefined();
  });

  it("dangles when carried, over everything", () => {
    const shot = chooseShot({ ...LOADED, drag: { vx: 0, at: 0 }, reaction: "wave" });
    expect(shot.clip).toBe(LIFTED_CLIP);
  });

  it("lets a long-press and a flight beat a reaction, and a reaction beat the rest", () => {
    expect(chooseShot({ ...LOADED, holds: ["highFive"], reaction: "poke" }).clip).toBe(
      HOLD_CLIPS.highFive
    );
    expect(chooseShot({ ...LOADED, holds: ["flying"], reaction: "poke" }).clip).toBe(
      HOLD_CLIPS.flying
    );
    expect(chooseShot({ ...LOADED, holds: ["wind"], reaction: "poke" }).clip).toBe(ACT_CLIPS.poke);
    expect(chooseShot({ ...LOADED, holds: ["wind"], talking: true }).clip).toBe(HOLD_CLIPS.wind);
    // The most important hold wins.
    expect(chooseShot({ ...LOADED, holds: ["sitting", "whoa", "wind"] }).clip).toBe(
      HOLD_CLIPS.whoa
    );
  });

  it("talks with the talking clip once its packs are in, the review pose before", () => {
    expect(chooseShot({ ...CALM, talking: true }).row).toBe(POSES.review.row);
    expect(chooseShot({ ...CALM, talking: true }).needs).toEqual(["faces", "talk"]);
    expect(chooseShot({ ...LOADED, talking: true }).clip).toBe(TALK_CLIP);
  });

  it("strolls the way his corner calls for", () => {
    const shot = chooseShot({ ...LOADED, reaction: "stroll", stroll: STROLL_FROM_LEFT });
    expect(shot.clip).toBe(STROLL_FROM_LEFT);
  });

  it("shows a clip's still frame under reduced motion", () => {
    const shot = chooseShot({ ...LOADED, reducedMotion: true, reaction: "tickle" });
    expect(shot).toMatchObject({ anim: "clip", still: true });
    expect(ACT_CLIPS.tickle.still).toBe("touch.giggle");
  });
});

describe("pointing", () => {
  it("aims one of seven directions", () => {
    expect(pointToward(0, -300)).toBe("pointUp");
    expect(pointToward(-200, -200)).toBe("pointUpLeft");
    expect(pointToward(200, -200)).toBe("pointUpRight");
    expect(pointToward(-300, 10)).toBe("pointLeft");
    expect(pointToward(300, 10)).toBe("pointRight");
    expect(pointToward(-100, 300)).toBe("pointDownLeft");
    expect(pointToward(100, 300)).toBe("pointDownRight");
  });

  it("points up at a panel standing above him in the corner", () => {
    expect(pointToward(-110, -330)).toBe("pointUp");
    expect(pointToward(-130, -300)).toBe("pointUpLeft");
  });
});

describe("lip-sync", () => {
  it("moves the mouth while chunks arrive and smiles between words", () => {
    let r = 0;
    const talker = createTalker(() => (r = (r + 0.37) % 1));
    const seen = new Set<string>();
    let pulse = 0;
    for (let t = 0; t < 2000; t += 40) {
      if (t % 80 === 0) pulse++;
      seen.add(talker.frame(t, pulse));
    }
    const mouths = Array.from(seen).map((f) => f.replace(/^.*[.-]/, ""));
    expect(new Set(mouths).size).toBeGreaterThan(2);
    // Silence: the default smile.
    expect(talker.frame(3000, pulse)).toMatch(/(face\.default|-default)$/);
  });

  it("changes gesture every couple of seconds, keeping one head", () => {
    let r = 0;
    const talker = createTalker(() => (r = (r + 0.61) % 1));
    const gestures = new Set<string>();
    for (let t = 0; t < 20_000; t += 100) {
      const f = talker.frame(t, t);
      gestures.add(f.startsWith("face.") ? "stance" : f.split("-")[0]);
    }
    expect(gestures.size).toBeGreaterThan(3);
    for (const g of Array.from(gestures))
      expect(g === "stance" || g.startsWith("talk.")).toBe(true);
  });
});
