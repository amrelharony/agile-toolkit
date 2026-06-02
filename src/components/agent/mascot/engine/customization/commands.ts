/**
 * Mascot chat commands + Konami easter egg.
 *
 * The vanilla mascot exposed `mascot-hat` / `mascot-aura` / `mascot-game`
 * terminal commands + a "dance" chat command + the Konami code. The toolkit has
 * no terminal, so the slash commands are intercepted in the agent chat input
 * before the message reaches the agent; the Konami listener is global.
 */

import { useMascotStore, type HatId } from "@/lib/agent/mascot/store";

const HATS: HatId[] = ["topHat", "partyHat", "crown"];
const RAINBOW = ["#ff0000", "#ff8800", "#ffff00", "#00ff00", "#0088ff", "#8800ff"];

/**
 * Parse + execute a mascot chat command. Returns true if the text was a mascot
 * command (and should NOT be forwarded to the agent).
 *
 * Supported: `/mascot-hat <topHat|partyHat|crown|none>`,
 * `/mascot-aura <#rrggbb|none>`, `/dance`.
 */
export function handleMascotCommand(text: string): boolean {
  const raw = text.trim();
  const t = raw.toLowerCase();
  const store = useMascotStore.getState();

  if (t === "/dance" || t === "dance") {
    store.queueReaction("wave");
    setTimeout(() => store.queueReaction("excited"), 800);
    setTimeout(() => store.queueReaction("spin"), 1800);
    return true;
  }

  const hat = t.match(/^\/mascot-hat\s+(\w+)/);
  if (hat) {
    const id = hat[1];
    if (id === "none" || id === "off") store.setHat(null);
    else if ((HATS as string[]).includes(id)) store.setHat(id as HatId);
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
export function installKonami(onActivate: () => void): () => void {
  let buf: string[] = [];
  const onKey = (e: KeyboardEvent) => {
    buf.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (buf.length > KONAMI.length) buf.shift();
    if (buf.length === KONAMI.length && KONAMI.every((k, i) => buf[i] === k)) {
      buf = [];
      konamiAction();
      onActivate();
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
