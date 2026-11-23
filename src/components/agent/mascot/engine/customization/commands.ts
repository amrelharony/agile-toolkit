/**
 * The Konami easter egg, for Amr's every-page chunk (mascot-assistant
 * installs the listener).
 *
 * The vanilla mascot exposed `mascot-aura` / `mascot-game` terminal commands,
 * a "dance" chat command and the Konami code. The toolkit has no terminal:
 * the chat commands are read from the chat's message box before a message
 * reaches the AI, in chat-commands.ts, which only the chat imports; the Konami
 * listener is global.
 */

import { useMascotStore } from "@/lib/agent/mascot/store";

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
