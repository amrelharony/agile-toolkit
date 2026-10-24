/**
 * How the timer says "time's up" beyond the screen.
 *
 * The page itself always shows it (the count-up turns the warning colour
 * and says "over") and announces it to screen readers. A backgrounded tab
 * also gets a flashing title, since many facilitators start a long retro
 * and switch tabs. Sound and vibration are opt-in (the team's "Chime when
 * time is up" switch): the toolkit keeps sound off unless someone turns it
 * on. The toolkit-wide sound effects (`sonify`) stay separate and follow
 * the header's sound toggle.
 */

/**
 * `beeps` short 880 Hz tones, 0.3 s apart, on a fresh AudioContext (so a
 * suspended shared engine can't swallow them), closed after the last one.
 * Browsers only play audio after a gesture; the team pressed Start.
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
