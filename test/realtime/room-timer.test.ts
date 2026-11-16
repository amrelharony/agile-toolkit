import { describe, expect, it } from "vitest";
import {
  ROOM_TIMER_MAX_OVERTIME_SECONDS,
  ROOM_TIMER_MAX_SECONDS,
  ROOM_TIMER_VERSION,
  addRoomTimerSeconds,
  anchorRoomTimer,
  formatRoomClock,
  isRoomTimerUp,
  pauseRoomTimer,
  readRoomTimer,
  readRoomTimerMessage,
  resumeRoomTimer,
  roomTimerInput,
  roomTimerLeft,
  roomTimerOvertime,
  sameRoomTimer,
  spokenDuration,
  startRoomTimer,
  type RoomTimer,
} from "@/lib/realtime/room-timer";

/**
 * The room countdown: every screen counts from the end time by itself, so
 * the host sends a timer only when it changes. Receivers move the end time
 * onto their own clock, so a phone whose clock is minutes off still shows
 * the right time left.
 */

const T0 = Date.parse("2026-11-12T10:00:00Z");
const BY = "host_member_id16";
const SIG = "s".repeat(86);

function timer(overrides: Partial<RoomTimer> = {}): RoomTimer {
  return { ...startRoomTimer(300, T0, { label: "Discuss" })!, ...overrides };
}

describe("the timer's own clock", () => {
  it("counts down from the end time, rounding up", () => {
    const t = timer();
    expect(t.endsAt).toBe(T0 + 300_000);
    expect(roomTimerLeft(t, T0)).toBe(300);
    expect(roomTimerLeft(t, T0 + 400)).toBe(300);
    expect(roomTimerLeft(t, T0 + 1000)).toBe(299);
    expect(roomTimerLeft(t, T0 + 299_001)).toBe(1);
    expect(roomTimerLeft(t, T0 + 300_000)).toBe(0);
  });

  it("is up at the end time and then counts the overtime up, to a cap", () => {
    const t = timer();
    expect(isRoomTimerUp(t, T0 + 299_999)).toBe(false);
    expect(isRoomTimerUp(t, T0 + 300_000)).toBe(true);
    expect(roomTimerOvertime(t, T0 + 299_000)).toBe(0);
    expect(roomTimerOvertime(t, T0 + 300_000 + 65_500)).toBe(65);
    expect(roomTimerOvertime(t, T0 + 300_000 + 9e9)).toBe(ROOM_TIMER_MAX_OVERTIME_SECONDS);
  });

  it("pauses where it is, resumes from what was left, and is never up while paused", () => {
    const paused = pauseRoomTimer(timer(), T0 + 100_000);
    expect(paused).toMatchObject({ endsAt: null, pausedSeconds: 200 });
    expect(roomTimerLeft(paused, T0 + 9e9)).toBe(200);
    expect(isRoomTimerUp(paused, T0 + 9e9)).toBe(false);
    const resumed = resumeRoomTimer(paused, T0 + 500_000);
    expect(resumed.endsAt).toBe(T0 + 700_000);
    // A timer already up can't be paused; a running one can't be resumed.
    const up = timer();
    expect(pauseRoomTimer(up, T0 + 301_000)).toBe(up);
    expect(resumeRoomTimer(up, T0)).toBe(up);
  });

  it("adds time: to a running timer, a paused one, and restarts one that ran out", () => {
    const t = timer();
    expect(roomTimerLeft(addRoomTimerSeconds(t, 60, T0 + 10_000), T0 + 10_000)).toBe(350);
    const paused = addRoomTimerSeconds(pauseRoomTimer(t, T0), 60, T0);
    expect(paused).toMatchObject({ endsAt: null, pausedSeconds: 360 });
    const again = addRoomTimerSeconds(t, 60, T0 + 400_000);
    expect(again.endsAt).toBe(T0 + 460_000);
    expect(isRoomTimerUp(again, T0 + 400_000)).toBe(false);
  });

  it("refuses an empty length and caps a long one at the room's 3 hours", () => {
    expect(startRoomTimer(0, T0)).toBeNull();
    expect(startRoomTimer(Number.NaN, T0)).toBeNull();
    expect(startRoomTimer(10 * 60 * 60, T0)?.totalSeconds).toBe(ROOM_TIMER_MAX_SECONDS);
  });

  it("formats and says the time", () => {
    expect(formatRoomClock(305)).toBe("5:05");
    expect(formatRoomClock(3723)).toBe("1:02:03");
    expect(spokenDuration(90)).toBe("1 minute 30 seconds");
    expect(spokenDuration(120)).toBe("2 minutes");
    expect(spokenDuration(1)).toBe("1 second");
    expect(spokenDuration(0)).toBe("0 seconds");
  });
});

describe("syncing from the end time", () => {
  it("moves the end time onto the receiver's clock, whatever its skew", () => {
    const t = timer();
    const sentAt = T0 + 20_000; // the host's clock: 280 s left
    for (const skew of [-180_000, -1500, 0, 2500, 600_000]) {
      const latency = 120;
      const receivedAt = sentAt + skew + latency;
      const local = anchorRoomTimer(t, sentAt, receivedAt);
      // On the receiver's clock it ends 280 s after it arrived.
      expect(roomTimerLeft(local, receivedAt)).toBe(280);
      expect(roomTimerLeft(local, receivedAt + 30_000)).toBe(250);
      expect(isRoomTimerUp(local, receivedAt + 280_000)).toBe(true);
    }
  });

  it("leaves a paused timer as it is", () => {
    const paused = pauseRoomTimer(timer(), T0 + 1000);
    expect(anchorRoomTimer(paused, T0, T0 + 99_999)).toBe(paused);
  });

  it("treats a keepalive re-anchored a little differently as the same timer", () => {
    const a = anchorRoomTimer(timer(), T0, T0 + 100);
    const b = anchorRoomTimer(timer(), T0 + 30_000, T0 + 30_000 + 700);
    expect(sameRoomTimer(a, b)).toBe(true);
    expect(sameRoomTimer(a, { ...b, endsAt: (b.endsAt ?? 0) + 5000 })).toBe(false);
    expect(sameRoomTimer(a, { ...a, label: "Vote" })).toBe(false);
    expect(sameRoomTimer(null, null)).toBe(true);
    expect(sameRoomTimer(a, null)).toBe(false);
  });
});

describe("the wire", () => {
  const msg = { v: ROOM_TIMER_VERSION, by: BY, seq: 3, at: T0, timer: timer() };

  it("reads a well-formed message back field by field, dropping anything extra", () => {
    const got = readRoomTimerMessage({ ...msg, sig: SIG, extra: "x" });
    expect(got).toEqual({ ...msg, sig: SIG });
    expect(readRoomTimerMessage({ ...msg, timer: null })).toEqual({ ...msg, timer: null });
  });

  it("refuses a malformed message", () => {
    const cases: unknown[] = [
      null,
      { ...msg, v: 2 },
      { ...msg, by: "has spaces" },
      { ...msg, seq: -1 },
      { ...msg, seq: 1.5 },
      { ...msg, at: "now" },
      { ...msg, sig: "short" },
      { ...msg, timer: { ...msg.timer, totalSeconds: 0 } },
      { ...msg, timer: { ...msg.timer, pausedSeconds: ROOM_TIMER_MAX_SECONDS + 1 } },
      { ...msg, timer: { ...msg.timer, autoReveal: "yes" } },
      { ...msg, timer: { ...msg.timer, label: "bad‮label" } },
      { ...msg, timer: { ...msg.timer, label: "x".repeat(61) } },
      // An end time far beyond any timer the host could set, or long past.
      { ...msg, timer: { ...msg.timer, endsAt: T0 + (ROOM_TIMER_MAX_SECONDS + 60) * 1000 } },
      { ...msg, timer: { ...msg.timer, endsAt: T0 - 3 * 60 * 60 * 1000 } },
      { ...msg, timer: { ...msg.timer, endsAt: Number.POSITIVE_INFINITY } },
      { ...msg, label: "x".repeat(700) },
    ];
    for (const raw of cases) expect(readRoomTimerMessage(raw), JSON.stringify(raw)).toBeNull();
  });

  it("checks the label is exactly what a receiver would show", () => {
    expect(readRoomTimer({ ...msg.timer, label: "  spaced  " }, T0)).toBeNull();
    expect(readRoomTimer({ ...msg.timer, label: "" }, T0)?.label).toBe("");
  });

  it("signs a text bound to the room, the host, the order and every field", () => {
    const base = roomTimerInput("quick-vote", "ABCD2345EFGH", msg);
    expect(roomTimerInput("quick-vote", "ABCD2345EFGH", { ...msg })).toBe(base);
    const variants = [
      roomTimerInput("picker", "ABCD2345EFGH", msg),
      roomTimerInput("quick-vote", "ABCD2345EFGJ", msg),
      roomTimerInput("quick-vote", "ABCD2345EFGH", { ...msg, by: "other_member_id1" }),
      roomTimerInput("quick-vote", "ABCD2345EFGH", { ...msg, seq: 4 }),
      roomTimerInput("quick-vote", "ABCD2345EFGH", { ...msg, at: T0 + 1 }),
      roomTimerInput("quick-vote", "ABCD2345EFGH", { ...msg, timer: null }),
      roomTimerInput("quick-vote", "ABCD2345EFGH", {
        ...msg,
        timer: { ...msg.timer, autoReveal: true },
      }),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(JSON.parse(base)[0]).toBe("agile-toolkit:room-timer:v1");
  });
});
