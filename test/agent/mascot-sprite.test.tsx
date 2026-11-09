import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import MascotSprite from "@/components/agent/mascot/mascot-sprite";
import { FX_FADE_MS } from "@/components/agent/mascot/mascot-fx";
import {
  chooseShot,
  lookCell,
  lookIndex,
  reactionSeconds,
  POSES,
  SHEET,
  type ShotInput,
} from "@/components/agent/mascot/engine/sprite-poses";
import { MOOD_SPEED, moodFor } from "@/components/agent/mascot/engine/mood";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";

const CALM: ShotInput = {
  drag: null,
  reaction: null,
  micro: null,
  talking: false,
  look: null,
  reducedMotion: false,
  speed: 1,
};

describe("the sheet's layout", () => {
  it("matches the pack's rows and frame counts", () => {
    const rows = Object.values(POSES).map((p) => [p.row, p.frames]);
    expect(rows).toEqual([
      [0, 6],
      [1, 8],
      [2, 8],
      [3, 4],
      [4, 5],
      [5, 8],
      [6, 6],
      [7, 6],
      [8, 6],
    ]);
    expect(SHEET).toEqual({ columns: 8, rows: 11, cellW: 192, cellH: 208 });
  });
});

describe("pose mapping", () => {
  const POSE_FOR: [MascotReaction, keyof typeof POSES][] = [
    ["wave", "waving"],
    ["excited", "jumping"],
    ["dance", "jumping"],
    ["confused", "failed"],
    ["headShake", "failed"],
    ["listening", "waiting"],
    ["thinking", "running"],
    ["talking", "review"],
    ["nod", "review"],
  ];

  it.each(POSE_FOR)("%s plays %s", (reaction, pose) => {
    const shot = chooseShot({ ...CALM, reaction });
    expect(shot.row).toBe(POSES[pose].row);
    expect(shot.frames).toBe(POSES[pose].frames);
    expect(shot.anim).toBe("frames");
  });

  it("is idle when nothing is going on", () => {
    expect(chooseShot(CALM)).toMatchObject({ row: 0, anim: "idle", frames: 6 });
  });

  it("holds the review pose while talking", () => {
    expect(chooseShot({ ...CALM, talking: true }).row).toBe(POSES.review.row);
  });

  it("runs the way he's dragged, over any reaction, until the dangle has loaded", () => {
    expect(chooseShot({ ...CALM, drag: { vx: -300, at: 0 }, reaction: "wave" }).row).toBe(
      POSES["running-left"].row
    );
    expect(chooseShot({ ...CALM, drag: { vx: 300, at: 0 } }).row).toBe(POSES["running-right"].row);
  });

  it("gives a reaction time for whole loops", () => {
    expect(reactionSeconds("wave")).toBeCloseTo(2);
    expect(reactionSeconds("confused")).toBeCloseTo(8 / 6);
    // A livelier mood plays faster.
    expect(reactionSeconds("wave", 2)).toBeCloseTo(1);
  });

  it("turns spin and wiggle into their own animations", () => {
    expect(chooseShot({ ...CALM, reaction: "spin" }).anim).toBe("spin");
    expect(chooseShot({ ...CALM, reaction: "wiggle" }).anim).toBe("wiggle");
  });

  it("restarts the loop when the mood's speed changes the timing", () => {
    expect(chooseShot({ ...CALM, speed: 1.3 }).seconds).toBeLessThan(chooseShot(CALM).seconds);
  });
});

describe("cursor tracking", () => {
  it("numbers the 16 directions clockwise from up", () => {
    expect(lookIndex(0, -200)).toBe(0);
    expect(lookIndex(200, -200)).toBe(2);
    expect(lookIndex(200, 0)).toBe(4);
    expect(lookIndex(0, 200)).toBe(8);
    expect(lookIndex(-200, 0)).toBe(12);
    expect(lookIndex(-200, -200)).toBe(14);
    // Just left of straight up rounds back to 0, not 16.
    expect(lookIndex(-1, -200)).toBe(0);
  });

  it("faces the viewer when the cursor is on top of him", () => {
    expect(lookIndex(5, 5)).toBeNull();
  });

  it("maps a direction onto the two look rows", () => {
    expect(lookCell(0)).toEqual({ row: 9, col: 0 });
    expect(lookCell(7)).toEqual({ row: 9, col: 7 });
    expect(lookCell(8)).toEqual({ row: 10, col: 0 });
    expect(lookCell(15)).toEqual({ row: 10, col: 7 });
  });

  it("looks only when he has nothing else to do", () => {
    expect(chooseShot({ ...CALM, look: 4 })).toMatchObject({ row: 9, col: 4, anim: "none" });
    expect(chooseShot({ ...CALM, look: 4, talking: true }).row).toBe(POSES.review.row);
    expect(chooseShot({ ...CALM, look: 4, reaction: "wave" }).row).toBe(POSES.waving.row);
  });
});

describe("reduced motion", () => {
  const STILL: ShotInput = { ...CALM, reducedMotion: true };

  it("shows a still frame for every state", () => {
    expect(chooseShot(STILL).anim).toBe("none");
    expect(chooseShot({ ...STILL, reaction: "wave" })).toMatchObject({
      anim: "none",
      row: POSES.waving.row,
      col: POSES.waving.still,
    });
    expect(chooseShot({ ...STILL, reaction: "spin" })).toMatchObject({ anim: "none", row: 0 });
    expect(chooseShot({ ...STILL, reaction: "wiggle" })).toMatchObject({ anim: "none", row: 0 });
    expect(chooseShot({ ...STILL, drag: { vx: -1, at: 0 } }).anim).toBe("none");
    expect(chooseShot({ ...STILL, talking: true }).anim).toBe("none");
  });

  it("doesn't track the cursor", () => {
    expect(chooseShot({ ...STILL, look: 4 }).row).toBe(0);
  });
});

describe("mood", () => {
  it("speeds him up when the mood is lively and slows him when it's calm", () => {
    expect(MOOD_SPEED[moodFor(0.8, 0.8)]).toBeGreaterThan(1);
    expect(MOOD_SPEED[moodFor(0.5, 0.2)]).toBeLessThan(1);
    expect(moodFor(0.5, 0.5)).toBe("neutral");
  });
});

/** An Image that loads (or fails) when told to. */
function stubImage() {
  const made: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = "";
      constructor() {
        made.push(this);
      }
    }
  );
  return made;
}

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("<MascotSprite />", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMascotStore.getState().reset();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useMascotStore.getState().reset();
  });

  const shotOf = (c: HTMLElement) =>
    c.querySelector<HTMLElement>("[data-amr-shot]")!.dataset.amrShot;

  it("calls setReady once the sheet loads, and clears it on unmount", () => {
    const images = stubImage();
    const { unmount } = render(<MascotSprite />);
    expect(images[0].src).toMatch(/\/mascot\/amr\.[0-9a-f]{8}\.webp$/);
    expect(useMascotStore.getState().ready).toBe(false);
    act(() => images[0].onload?.());
    expect(useMascotStore.getState().ready).toBe(true);
    unmount();
    expect(useMascotStore.getState().ready).toBe(false);
  });

  it("reports a sheet that can't load and stays not ready", () => {
    const images = stubImage();
    const onLoadError = vi.fn();
    render(<MascotSprite onLoadError={onLoadError} />);
    act(() => images[0].onerror?.());
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(useMascotStore.getState().ready).toBe(false);
  });

  it("plays queued reactions one at a time, then settles back to idle", () => {
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());
    expect(shotOf(container)).toMatch(/^idle/);

    act(() => {
      useMascotStore.getState().queueReaction("wave");
      useMascotStore.getState().queueReaction("nod");
    });
    expect(shotOf(container)).toMatch(/^waving/);
    expect(useMascotStore.getState().reactionQueue).toEqual(["nod"]);

    act(() => {
      vi.advanceTimersByTime(reactionSeconds("wave") * 1000 + 1);
    });
    expect(shotOf(container)).toMatch(/^review/);

    act(() => {
      vi.advanceTimersByTime(reactionSeconds("nod") * 1000 + 1);
    });
    expect(shotOf(container)).toMatch(/^idle/);
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });

  it("follows the talking flag and the drag direction (before the packs load)", () => {
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());

    act(() => useMascotStore.getState().setTalking(true));
    expect(shotOf(container)).toMatch(/^review/);
    act(() => useMascotStore.getState().setDrag(-400));
    expect(shotOf(container)).toMatch(/^running-left/);
    act(() => useMascotStore.getState().setDrag(null));
    act(() => useMascotStore.getState().setTalking(false));
    expect(shotOf(container)).toMatch(/^idle/);
  });

  it("looks at the cursor", () => {
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 0 }));
    });
    // jsdom's box sits at the origin, so this cursor is to his right.
    expect(shotOf(container)).toBe("look-4");
  });

  it("is a still frame under reduced motion, draining the queue without tracking", () => {
    stubReducedMotion(true);
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());
    expect(shotOf(container)).toBe("idle");
    expect(container.querySelector("[style*='--frames: 1']")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 500, clientY: 0 }));
    });
    expect(shotOf(container)).toBe("idle");

    act(() => useMascotStore.getState().queueReaction("wave"));
    expect(shotOf(container)).toBe("waving");
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });

  it("leans against the phone's tilt, from his feet, and looks where it tips", () => {
    // A touch screen that sends its tilt without asking.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("DeviceOrientationEvent", class {});
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());
    const lean = container.querySelector<HTMLElement>("[data-amr-lean]")!;
    expect(lean.style.transformOrigin).toMatch(/^50% 97\./); // his floor row
    expect(lean.style.transform).toBe("");

    act(() => {
      for (let i = 0; i < 30; i++) {
        window.dispatchEvent(
          Object.assign(new Event("deviceorientation"), { beta: 0, gamma: i === 0 ? 0 : 12 })
        );
        vi.advanceTimersByTime(34);
      }
    });
    // Right side down: he leans left to stay upright, about half the tilt.
    expect(lean.style.transform).toMatch(/^rotate\(-[3-6]\./);
    expect(shotOf(container)).toBe("look-4");
    expect(
      container.querySelector<HTMLElement>("[data-amr-shot]")!.style.getPropertyValue("--amr-roll")
    ).toMatch(/^(9|10|11)deg$/);
  });

  it("shows the aura only when one is set", () => {
    const images = stubImage();
    const { container } = render(<MascotSprite />);
    act(() => images[0].onload?.());
    const body = container.querySelector<HTMLElement>("[data-amr-lean] > div")!;
    expect(body.style.filter).toBe("");
    act(() => useMascotStore.getState().setAuraColor("#ff8800"));
    expect(body.style.filter).toContain("#ff8800");
  });
});

describe("<MascotSprite /> with the packs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useMascotStore.getState().reset();
    stubReducedMotion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    useMascotStore.getState().reset();
  });

  const shotOf = (c: HTMLElement) =>
    c.querySelector<HTMLElement>("[data-amr-shot]")!.dataset.amrShot;
  const clipLayer = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-amr-clip]")!;

  /** Mount, load the sheet, let the idle prefetch ask for the core packs and load them. */
  function mountLoaded() {
    const images = stubImage();
    const utils = render(<MascotSprite />);
    act(() => images[0].onload?.());
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const packs = images.slice(1);
    act(() => packs.forEach((img) => img.onload?.()));
    return { ...utils, images };
  }

  it("fetches the core packs once the page is idle", () => {
    const { images } = mountLoaded();
    const srcs = images.slice(1).map((i) => i.src);
    expect(srcs.some((s) => /\/mascot\/amr-touch\.[0-9a-f]{8}\.webp$/.test(s))).toBe(true);
    expect(srcs.some((s) => /amr-faces\./.test(s))).toBe(true);
    expect(srcs.some((s) => /amr-lifted\./.test(s))).toBe(true);
  });

  it("plays a reaction's clip from its pack, painted on the clip layer", () => {
    const { container } = mountLoaded();
    act(() => useMascotStore.getState().playNow("poke"));
    expect(shotOf(container)).toBe("clip:poke");
    const layer = clipLayer(container);
    expect(layer.style.visibility).toBe("");
    expect(layer.style.backgroundImage).toMatch(/amr-touch\./);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(shotOf(container)).toMatch(/^idle/);
    expect(clipLayer(container).style.visibility).toBe("hidden");
  });

  it("stands the clip layer on his floor, as tall as the cell it paints", () => {
    const { container } = mountLoaded();
    // A pack's cell has 16 rows of headroom over the live sheet's 208: 143 → 154 px.
    act(() => useMascotStore.getState().playNow("poke"));
    const layer = clipLayer(container);
    expect(layer.style.height).toBe("154px");
    expect(layer.style.backgroundSize).toBe("1056px 154px");
    // A clip of live-sheet cells paints them at the sheet's own height.
    act(() => useMascotStore.getState().playNow("thumbsUp"));
    expect(shotOf(container)).toBe("clip:thumbsUp");
    expect(layer.style.height).toBe("143px");
    expect(layer.style.backgroundSize).toBe("1056px 1573px");
    expect(layer.style.backgroundPosition).toBe("-528px -1144px");
  });

  it("sets the air around him for a weather scene, behind him, and clears it after", () => {
    const { container, images } = mountLoaded();
    act(() => useMascotStore.getState().playNow("scene:rain"));
    act(() => images.find((i) => /amr-rain\./.test(i.src))?.onload?.());
    expect(shotOf(container)).toBe("clip:scene:rain");
    const fx = container.querySelector<HTMLElement>("[data-amr-fx]")!;
    expect(fx.dataset.amrFx).toBe("rain");
    expect(fx.children).toHaveLength(14);
    // Before the figure in his box, so it's drawn behind him.
    expect(fx.nextElementSibling?.contains(clipLayer(container))).toBe(true);
    act(() => {
      vi.advanceTimersByTime(reactionSeconds("scene:rain") * 1000 + 100);
    });
    expect(shotOf(container)).toMatch(/^idle/);
    expect(container.querySelector("[data-amr-fx]")).not.toBeNull(); // clearing
    act(() => {
      vi.advanceTimersByTime(FX_FADE_MS);
    });
    expect(container.querySelector("[data-amr-fx]")).toBeNull();
  });

  it("sets no air for a scene without weather, or a reaction", () => {
    const { container, images } = mountLoaded();
    act(() => useMascotStore.getState().playNow("scene:sun"));
    act(() => images.find((i) => /amr-sun\./.test(i.src))?.onload?.());
    expect(shotOf(container)).toBe("clip:scene:sun");
    expect(container.querySelector("[data-amr-fx]")).toBeNull();
    act(() => useMascotStore.getState().playNow("poke"));
    expect(container.querySelector("[data-amr-fx]")).toBeNull();
  });

  it("cuts a reaction short for one played now", () => {
    const { container } = mountLoaded();
    act(() => {
      useMascotStore.getState().queueReaction("wave");
      useMascotStore.getState().queueReaction("nod");
    });
    expect(shotOf(container)).toMatch(/^waving/);
    act(() => useMascotStore.getState().playNow("poke"));
    expect(shotOf(container)).toBe("clip:poke");
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });

  it("stands in a live-sheet pose for a clip whose pack isn't in yet, and fetches it", () => {
    const { container, images } = mountLoaded();
    const before = images.length;
    act(() => useMascotStore.getState().queueReaction("bow"));
    expect(shotOf(container)).toMatch(/^waving/);
    expect(images.length).toBe(before + 1);
    expect(images.at(-1)!.src).toMatch(/amr-social\./);
  });

  it("dangles while carried", () => {
    const { container } = mountLoaded();
    act(() => useMascotStore.getState().setDrag(0));
    expect(shotOf(container)).toBe("clip:lifted");
    expect(clipLayer(container).style.backgroundImage).toMatch(/amr-lifted\./);
  });

  it("lets a held pose go and shows the Zzz while he dozes", () => {
    const { container, images } = mountLoaded();
    act(() => useMascotStore.getState().setHold("dozing", true));
    act(() => images.find((i) => /amr-rest\./.test(i.src))?.onload?.());
    expect(shotOf(container)).toBe("clip:hold.dozing");
    expect(container.textContent).toContain("Z");
    act(() => useMascotStore.getState().setHold("dozing", false));
    expect(shotOf(container)).toMatch(/^idle/);
    expect(container.textContent).not.toContain("Z");
  });
});
