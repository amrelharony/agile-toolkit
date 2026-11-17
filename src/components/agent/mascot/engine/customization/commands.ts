/**
 * Mascot chat commands + Konami easter egg.
 *
 * The vanilla mascot exposed `mascot-aura` / `mascot-game` terminal commands + a "dance" chat command + the Konami code. The toolkit has
 * no terminal, so the slash commands are intercepted in the agent chat input
 * before the message reaches the agent; the Konami listener is global.
 */

import { useMascotStore } from "@/lib/agent/mascot/store";
import { EXPANSION_SHEETS } from "../expansion-table";
import { COMPANION_SCENES, galleryScene, sceneReaction } from "../scenes";
import { shippedScene } from "../sprite-poses";

/**
 * The Konami sweep's colours, red to violet, as theme tokens rather than pure
 * neon hexes, so each step reads on the comic's paper, at night and in high
 * contrast. A colour typed with /mascot-aura stays a hex; the sprite maps a
 * brand hex onto its token through themed() when it paints the aura.
 * Exported for tests.
 */
export const RAINBOW = [
  "var(--danger)",
  "var(--neon-amber)",
  "var(--warning)",
  "var(--success)",
  "var(--info)",
  "var(--accent3)",
] as const;

/** Names a visitor may give /play, besides the scenes' own (engine/scenes.ts COMPANION_SCENES.play). */
const STORY_NAMES: Readonly<Record<string, string>> = {
  ai: "reviewer",
  review: "reviewer",
  robot: "reviewer",
  dinosaur: "dino",
  priorities: "dino",
  deadline: "rabbit",
  overload: "octopus",
  tea: "ahwa",
  debrief: "ahwa",
  sticky: "escape",
  idea: "comic",
  retry: "retry",
  bell: "quiet",
};

/** An expansion scene asked for by its pack's name (X001–X124), as the Scenes tab plays it; or undefined. */
function expansionFor(name: string): string | undefined {
  const pack = name.toLowerCase();
  if (!EXPANSION_SHEETS.some((s) => s.pack === pack)) return undefined;
  const scene = galleryScene(pack);
  return shippedScene(scene) ? scene : undefined;
}

/** Whether `scene` is one of the companion stories /play takes in turn. */
const isStory = (scene: string) => (COMPANION_SCENES.play as readonly string[]).includes(scene);

/**
 * The story `/play <name>` asks for, or (no name, or one he doesn't know) the
 * next one in turn after `last`. A name can be a companion story's (or a plain
 * word for it) or any expansion scene's pack name (X001 or x001). Only shipped
 * scenes; null when none has shipped.
 */
export function storyFor(name: string | undefined, last: string | null): string | null {
  const expansion = name ? expansionFor(name) : undefined;
  if (expansion) return expansion;
  const stories = COMPANION_SCENES.play.filter((s) => shippedScene(s) !== undefined);
  if (!stories.length) return null;
  const wanted = name ? (STORY_NAMES[name] ?? name) : undefined;
  if (wanted && stories.includes(wanted as (typeof stories)[number])) return wanted;
  const i = last ? stories.indexOf(last as (typeof stories)[number]) : -1;
  return stories[(i + 1) % stories.length];
}

/** The companion story /play last played, so a bare /play takes the next in turn. */
let lastStory: string | null = null;

/**
 * Parse + execute a mascot chat command. Returns true if the text was a mascot
 * command (and should NOT be forwarded to the agent).
 *
 * Supported: `/mascot-aura <#rrggbb|none>`, `/dance`, and `/play [story]`: one of
 * his little companion stories, or any expansion scene by its pack (`/play x001`),
 * acted out because the visitor asked. They are illustrations (the AI reviewer
 * checks nothing; the retry retries nothing; a bookmark saves nothing).
 */
export function handleMascotCommand(text: string): boolean {
  const raw = text.trim();
  const t = raw.toLowerCase();
  const store = useMascotStore.getState();

  const play = t.match(/^\/play(?:\s+([a-z0-9-]+))?$/);
  if (play) {
    const story = storyFor(play[1], lastStory);
    if (story) {
      // An expansion scene leaves the companion stories' turn where it was.
      if (isStory(story)) lastStory = story;
      store.playNow(sceneReaction(story));
    }
    return true;
  }

  if (t === "/dance" || t === "dance") {
    store.queueReaction("wave");
    setTimeout(() => store.queueReaction("excited"), 800);
    setTimeout(() => store.queueReaction("spin"), 1800);
    return true;
  }

  const aura = raw.match(/^\/mascot-aura\s+(#?[0-9a-fA-F]{6}|none|off)$/i);
  if (aura) {
    const v = aura[1].toLowerCase();
    if (v === "none" || v === "off") store.setAuraColor(null);
    else store.setAuraColor(v.startsWith("#") ? v : `#${v}`);
    return true;
  }

  return false;
}

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * Install the Konami-code listener. On the full sequence: spin + a rainbow aura
 * sweep + XP. Returns a cleanup fn.
 */
export function installKonami(onActivate?: () => void): () => void {
  let buf: string[] = [];
  const onKey = (e: KeyboardEvent) => {
    buf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (buf.length > KONAMI.length) buf.shift();
    if (buf.length === KONAMI.length && KONAMI.every((k, i) => buf[i] === k)) {
      buf = [];
      konamiAction();
      onActivate?.();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

let rainbowIv: ReturnType<typeof setInterval> | null = null;

function konamiAction(): void {
  const store = useMascotStore.getState();
  store.queueReaction("spin");
  // Rainbow aura sweep, then revert to the mood colour. Cancel any in-flight
  // sweep first so a rapid second Konami doesn't race two intervals.
  if (rainbowIv) clearInterval(rainbowIv);
  let i = 0;
  rainbowIv = setInterval(() => {
    if (i >= RAINBOW.length) {
      if (rainbowIv) clearInterval(rainbowIv);
      rainbowIv = null;
      store.setAuraColor(null);
      return;
    }
    store.setAuraColor(RAINBOW[i]);
    i++;
  }, 200);
}
