/**
 * Amr's chat commands: words typed in the chat's message box that Amr acts
 * out himself, here, instead of sending them to the AI (so a visitor's
 * allowance is never spent on one, and nothing is saved with the chat).
 *
 *   /dance, dance             he waves, gets excited and spins
 *   /play [story]             he acts out one of his little companion stories,
 *                             or any expansion scene by its pack (/play x001)
 *   /mascot-aura <#rrggbb>    his aura takes that colour (the sprite themes it)
 *   /mascot-aura none | off   his aura goes back to his mood's
 *
 * The /play scenes are illustrations, acted out because the visitor asked
 * (the AI reviewer checks nothing; the retry retries nothing; a bookmark
 * saves nothing).
 *
 * A command answers with a note: the narrator's line for the composer's
 * status row ("Amr dances"), in the third person, never Amr's own words and
 * never sent to the model. The message box empties as for a send, so the
 * note is what shows the command ran: under reduced motion his pose barely
 * changes, and on a phone with the keyboard up he may be out of sight.
 *
 * Chat code only (both chats' composer): kept out of commands.ts, which
 * Amr's every-page chunk imports for the Konami listener, so none of this
 * ships on every page (webpack keeps every export a chunk uses inside the
 * module that holds it).
 */

import { useMascotStore } from "@/lib/agent/mascot/store";
import { EXPANSION_SHEETS } from "../expansion-table";
import { COMPANION_SCENES, galleryScene, sceneReaction } from "../scenes";
import { shippedScene } from "../sprite-poses";

/** What a command left for the composer's status row. */
export interface MascotCommandResult {
  /** The narrator's line: what Amr did, in the third person. */
  note: string;
}

/** The notes, exported for tests. */
export const DANCE_NOTE = "Amr dances";
export const AURA_ON_NOTE = "Amr's aura changes colour";
export const AURA_OFF_NOTE = "Amr's aura is back to his mood";
export const PLAY_NOTE = "Amr acts out a scene";
export const NO_SCENE_NOTE = "Amr has no scene to act out yet";

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
 * Runs `text` as a chat command when it is one, and says what happened; null
 * when it is not one, so the message goes to the AI as usual. Anything it
 * doesn't know (the retired /mascot-hat among them) is not a command.
 */
export function handleMascotCommand(text: string): MascotCommandResult | null {
  const raw = text.trim();
  const t = raw.toLowerCase();
  const store = useMascotStore.getState();

  const play = t.match(/^\/play(?:\s+([a-z0-9-]+))?$/);
  if (play) {
    const story = storyFor(play[1], lastStory);
    if (!story) return { note: NO_SCENE_NOTE };
    // An expansion scene leaves the companion stories' turn where it was.
    if (isStory(story)) lastStory = story;
    store.playNow(sceneReaction(story));
    return { note: PLAY_NOTE };
  }

  if (t === "/dance" || t === "dance") {
    store.queueReaction("wave");
    setTimeout(() => store.queueReaction("excited"), 800);
    setTimeout(() => store.queueReaction("spin"), 1800);
    return { note: DANCE_NOTE };
  }

  const aura = raw.match(/^\/mascot-aura\s+(#?[0-9a-fA-F]{6}|none|off)$/i);
  if (aura) {
    const v = aura[1].toLowerCase();
    if (v === "none" || v === "off") {
      store.setAuraColor(null);
      return { note: AURA_OFF_NOTE };
    }
    store.setAuraColor(v.startsWith("#") ? v : `#${v}`);
    return { note: AURA_ON_NOTE };
  }

  return null;
}
