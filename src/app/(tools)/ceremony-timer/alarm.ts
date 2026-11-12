/**
 * How the timer says "time's up" beyond the screen: the chime, the buzz and
 * the flashing tab title. They live in lib/celebrate/chime.ts, shared with
 * the other timers, and are re-exported here so the Ceremony Timer (and its
 * tests, which stand in for this module) keep importing them from "./alarm".
 */
export { flashTitle, playChime, vibrate } from "@/lib/celebrate/chime";
