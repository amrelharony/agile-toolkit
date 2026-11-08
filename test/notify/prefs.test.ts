import { beforeEach, describe, expect, it } from "vitest";
import {
  areCelebrationsPaused,
  DEFAULT_NOTIFICATION_PREFS,
  effectiveCelebrationLevel,
  effectiveQuietHours,
  FOCUS_UNTIL_OFF,
  isFocusActive,
  isWithinQuietHours,
  migrateNotificationPrefs,
  MUTED_KEYS_CAP,
  parseTime,
} from "@/lib/notify/prefs";
import {
  getNotificationPrefsSnapshot,
  NOTIFICATION_PREFS_VERSION,
  useNotificationPrefsStore,
} from "@/lib/stores/notification-prefs-store";

const KEY = "agile-toolkit:notification-prefs";

function store(state: unknown, version?: number) {
  const payload = version === undefined ? { state } : { state, version };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

function stored(): { state: Record<string, unknown>; version: number } {
  return JSON.parse(localStorage.getItem(KEY) ?? "null");
}

beforeEach(() => {
  useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
  localStorage.clear();
});

describe("notification prefs defaults", () => {
  it("match the settings table", () => {
    expect(getNotificationPrefsSnapshot()).toEqual({
      celebrationLevel: "balanced",
      gamificationEnabled: true,
      showXpBar: true,
      confirmationsAsToasts: false,
      focusUntil: null,
      quietHours: { enabled: false, start: "22:00", end: "08:00" },
      celebrationsPausedUntil: null,
      mutedKeys: [],
      silentModeAdopted: false,
    });
  });

  it("persist under their own key, version 1, with a migrate", () => {
    const opts = useNotificationPrefsStore.persist.getOptions();
    expect(opts.name).toBe(KEY);
    expect(NOTIFICATION_PREFS_VERSION).toBe(1);
    expect(opts.version).toBe(1);
    expect(typeof opts.migrate).toBe("function");
  });
});

describe("notification prefs actions", () => {
  it("set the simple switches", () => {
    const s = useNotificationPrefsStore.getState();
    s.setCelebrationLevel("lively");
    s.setGamificationEnabled(false);
    s.setShowXpBar(false);
    s.setConfirmationsAsToasts(true);
    expect(getNotificationPrefsSnapshot()).toMatchObject({
      celebrationLevel: "lively",
      gamificationEnabled: false,
      showXpBar: false,
      confirmationsAsToasts: true,
    });
  });

  it("start Focus for a duration or until turned off, and end it", () => {
    const s = useNotificationPrefsStore.getState();
    s.startFocus(30 * 60_000, 1_000);
    expect(useNotificationPrefsStore.getState().focusUntil).toBe(1_000 + 30 * 60_000);
    s.startFocus(null, 1_000);
    expect(useNotificationPrefsStore.getState().focusUntil).toBe(FOCUS_UNTIL_OFF);
    s.endFocus();
    expect(useNotificationPrefsStore.getState().focusUntil).toBeNull();
  });

  it("update quiet hours and ignore malformed times", () => {
    const s = useNotificationPrefsStore.getState();
    s.setQuietHours({ enabled: true, start: "23:30" });
    s.setQuietHours({ end: "7am" });
    s.setQuietHours({ end: "24:00" });
    expect(useNotificationPrefsStore.getState().quietHours).toEqual({
      enabled: true,
      start: "23:30",
      end: "08:00",
    });
  });

  it("pause and resume celebrations", () => {
    const s = useNotificationPrefsStore.getState();
    s.pauseCelebrations(60 * 60_000, 5_000);
    const paused = useNotificationPrefsStore.getState();
    expect(paused.celebrationsPausedUntil).toBe(5_000 + 60 * 60_000);
    expect(areCelebrationsPaused(paused, 5_000 + 60 * 60_000 - 1)).toBe(true);
    expect(areCelebrationsPaused(paused, 5_000 + 60 * 60_000)).toBe(false);
    s.resumeCelebrations();
    expect(useNotificationPrefsStore.getState().celebrationsPausedUntil).toBeNull();
  });

  it("mute keys without duplicates, capped at 100 (oldest go), and clear them", () => {
    const s = useNotificationPrefsStore.getState();
    for (let i = 0; i < MUTED_KEYS_CAP + 5; i++) s.muteKey(`k${i}`);
    s.muteKey("k10"); // re-muting moves it to the newest end
    const keys = useNotificationPrefsStore.getState().mutedKeys;
    expect(keys).toHaveLength(MUTED_KEYS_CAP);
    expect(keys).not.toContain("k0");
    expect(keys[keys.length - 1]).toBe("k10");
    expect(new Set(keys).size).toBe(keys.length);
    s.clearMutedKeys();
    expect(useNotificationPrefsStore.getState().mutedKeys).toEqual([]);
  });

  it("adopt silent mode once: on maps to Quiet, later calls do nothing", () => {
    const s = useNotificationPrefsStore.getState();
    s.adoptSilentMode(true);
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      celebrationLevel: "quiet",
      silentModeAdopted: true,
    });
    s.setCelebrationLevel("lively");
    s.adoptSilentMode(true);
    expect(useNotificationPrefsStore.getState().celebrationLevel).toBe("lively");
  });

  it("adopt silent mode off: keeps Balanced and never maps later", () => {
    const s = useNotificationPrefsStore.getState();
    s.adoptSilentMode(false);
    s.adoptSilentMode(true);
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      celebrationLevel: "balanced",
      silentModeAdopted: true,
    });
  });

  it("reset to defaults keeps the silent-mode mapping done", () => {
    const s = useNotificationPrefsStore.getState();
    s.adoptSilentMode(true);
    s.resetToDefaults();
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      celebrationLevel: "balanced",
      silentModeAdopted: true,
    });
  });
});

describe("notification prefs persistence", () => {
  it("round-trips through storage", async () => {
    useNotificationPrefsStore.getState().setCelebrationLevel("quiet");
    useNotificationPrefsStore.getState().setQuietHours({ enabled: true });
    expect(stored().version).toBe(1);
    // setState writes through to storage, so put the saved payload back after.
    const saved = localStorage.getItem(KEY) ?? "";
    useNotificationPrefsStore.setState(useNotificationPrefsStore.getInitialState(), true);
    localStorage.setItem(KEY, saved);
    await useNotificationPrefsStore.persist.rehydrate();
    expect(useNotificationPrefsStore.getState()).toMatchObject({
      celebrationLevel: "quiet",
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
    });
  });

  it("loads a newer payload keeping its unknown fields", async () => {
    store({ ...DEFAULT_NOTIFICATION_PREFS, celebrationLevel: "lively", futureFlag: "kept" }, 7);
    await useNotificationPrefsStore.persist.rehydrate();
    const s = useNotificationPrefsStore.getState() as unknown as Record<string, unknown>;
    expect(s.celebrationLevel).toBe("lively");
    expect(s.futureFlag).toBe("kept");
    expect(stored().state.futureFlag).toBe("kept");
  });

  it("keeps a newer build's values for known fields through load and write-back", async () => {
    store(
      {
        ...DEFAULT_NOTIFICATION_PREFS,
        celebrationLevel: "off",
        quietHours: { enabled: true, start: "21:00:00", end: "07:00" },
      },
      2
    );
    await useNotificationPrefsStore.persist.rehydrate();
    // The migration wrote the state straight back, stamped with this version.
    expect(stored().version).toBe(1);
    expect(stored().state.celebrationLevel).toBe("off");
    expect(stored().state.quietHours).toMatchObject({ start: "21:00:00" });
    // A later write keeps them too.
    useNotificationPrefsStore.getState().setShowXpBar(false);
    expect(stored().state.celebrationLevel).toBe("off");
    // Readers normalise what this build doesn't understand.
    const prefs = getNotificationPrefsSnapshot();
    expect(effectiveCelebrationLevel(prefs)).toBe("balanced");
    expect(effectiveQuietHours(prefs.quietHours)).toMatchObject({ start: "22:00", end: "07:00" });
  });

  it("sanitises wrongly typed fields, even in a same-version payload", async () => {
    store(
      {
        celebrationLevel: 3,
        gamificationEnabled: "yes",
        focusUntil: "soon",
        quietHours: { enabled: true, start: 21, end: "06:30" },
        mutedKeys: ["a", 3, "", "a", "b"],
      },
      1
    );
    await useNotificationPrefsStore.persist.rehydrate();
    expect(getNotificationPrefsSnapshot()).toMatchObject({
      celebrationLevel: "balanced",
      gamificationEnabled: true,
      focusUntil: null,
      quietHours: { enabled: true, start: "22:00", end: "06:30" },
      mutedKeys: ["a", "b"],
    });
  });

  it("falls back to defaults for a corrupted payload", async () => {
    store("garbage", 0);
    await useNotificationPrefsStore.persist.rehydrate();
    expect(getNotificationPrefsSnapshot()).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect((useNotificationPrefsStore.getState() as unknown as Record<string, unknown>)["0"]).toBe(
      undefined
    );
  });
});

describe("migrateNotificationPrefs", () => {
  it("is idempotent", () => {
    const once = migrateNotificationPrefs({ celebrationLevel: "quiet", extra: 1 });
    expect(migrateNotificationPrefs(once)).toEqual(once);
    expect(once).toMatchObject({ celebrationLevel: "quiet", extra: 1, showXpBar: true });
  });
});

describe("time checks", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m);
  const overnight = { enabled: true, start: "22:00", end: "08:00" };
  const daytime = { enabled: true, start: "12:00", end: "13:30" };

  it("parses HH:MM", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("22:15")).toBe(22 * 60 + 15);
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("7:00")).toBeNull();
  });

  it.each([
    [21, 59, false],
    [22, 0, true],
    [23, 30, true],
    [0, 0, true],
    [7, 59, true],
    [8, 0, false],
    [12, 0, false],
  ])("overnight quiet hours at %i:%i → %s", (h, m, quiet) => {
    expect(isWithinQuietHours(overnight, at(h, m))).toBe(quiet);
  });

  it.each([
    [11, 59, false],
    [12, 0, true],
    [13, 29, true],
    [13, 30, false],
    [23, 0, false],
  ])("same-day quiet hours at %i:%i → %s", (h, m, quiet) => {
    expect(isWithinQuietHours(daytime, at(h, m))).toBe(quiet);
  });

  it("is never quiet when disabled or when start equals end", () => {
    expect(isWithinQuietHours({ ...overnight, enabled: false }, at(23))).toBe(false);
    expect(isWithinQuietHours({ enabled: true, start: "09:00", end: "09:00" }, at(9))).toBe(false);
  });

  it("Focus is active until its end time", () => {
    expect(isFocusActive({ focusUntil: null }, 0)).toBe(false);
    expect(isFocusActive({ focusUntil: 100 }, 99)).toBe(true);
    expect(isFocusActive({ focusUntil: 100 }, 100)).toBe(false);
    expect(isFocusActive({ focusUntil: FOCUS_UNTIL_OFF }, Date.now() + 10 * 365 * 864e5)).toBe(
      true
    );
  });
});
