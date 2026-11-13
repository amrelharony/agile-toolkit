/**
 * How a timer says "time's up" beyond the screen, for every tool that runs
 * one (the Ceremony Timer, the facilitator timers, a room countdown).
 *
 * The page itself always shows it and announces it to screen readers. A
 * backgrounded tab also gets a flashing title, since many facilitators start
 * a long session and switch tabs. Sound and vibration are opt-in (a tool's
 * own "Chime when time is up" switch): the toolkit keeps sound off unless
 * someone turns it on. The toolkit-wide sound effects (`sonify`) stay separate
 * and follow the header's sound toggle.
 *
 * Moved here from the Ceremony Timer (app/(tools)/ceremony-timer/alarm.ts,
 * which re-exports these), unchanged, so every timer sounds the same.
 * `timesUp` rings all three for every other timer.
 */

import { useAlarmPrefs } from "./alarm-prefs";

/**
 * `beeps` short 880 Hz tones, 0.3 s apart, on a fresh AudioContext (so a
 * suspended shared engine can't swallow them), closed after the last one.
 * Browsers only play audio after a gesture; the person pressed Start.
 */
export function playChime(beeps = 3): void {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    for (let i = 0; i < beeps; i++) {
      const offset = i * 0.3;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
      // A short envelope avoids the click of an instant on and off.
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    }
    setTimeout(() => void ctx.close().catch(() => undefined), beeps * 300 + 250);
  } catch {
    /* No audio here (sandboxed iframe, blocked context): the screen still says it. */
  }
}

/** A buzz on phones that support it (iOS Safari has no vibration API). */
export function vibrate(pattern: number[] = [200, 100, 200, 100, 400]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* not allowed here */
  }
}

/**
 * The tab title says time's up until the tab gets focus again or five
 * seconds pass, for a timer running in a background tab.
 */
export function flashTitle(text: string): void {
  if (typeof document === "undefined") return;
  const original = document.title;
  const flashed = `⏰ ${text} — Agile Toolkit`;
  document.title = flashed;
  const restore = () => {
    if (document.title === flashed) document.title = original;
  };
  const timer = setTimeout(restore, 5000);
  window.addEventListener(
    "focus",
    () => {
      restore();
      clearTimeout(timer);
    },
    { once: true }
  );
}

export interface TimesUpOptions {
  /** What the tab title says while it flashes. Default "Time's up". */
  title?: string;
  /** Also chime and buzz. Default: the shared "Chime when time is up" setting (`alarm-prefs.ts`). */
  sound?: boolean;
}

/**
 * The one time's-up alarm every timer rings when it reaches zero: the room
 * countdowns, the Retro board's timer, the step timer and the docked timer
 * (the Ceremony Timer rings the same three signals itself, with its own
 * switch). The tab title flashes; three beeps and a buzz follow only when
 * sound is on, which it isn't unless the person turned it on. The page
 * still shows and announces time's up itself, then counts the overtime up
 * (`overtimeText`).
 */
export function timesUp(opts: TimesUpOptions = {}): void {
  const sound = opts.sound ?? useAlarmPrefs.getState().sound;
  flashTitle(opts.title ?? "Time's up");
  if (sound) {
    playChime(3);
    vibrate();
  }
}

/** "+1:05 over": how far past zero a timer has counted. */
export function overtimeText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `+${h}:${String(m).padStart(2, "0")}:${sec} over` : `+${m}:${sec} over`;
}
