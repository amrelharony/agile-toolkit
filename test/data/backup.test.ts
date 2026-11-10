import { beforeEach, describe, expect, it } from "vitest";
import {
  backupFilename,
  collectBackup,
  isBackupKey,
  parseBackup,
  restoreBackup,
  serializeBackup,
} from "@/lib/data/backup";
import { INTRO_KINDS, introMarkKey } from "@/lib/comics/intro";
import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
} from "@/components/agent/mascot/visitor-ai-consent";
import { MEMORY_KEY } from "@/lib/agent/mascot/memory";
import { MOTION_ASKED_KEY } from "@/lib/agent/mascot/store";
import { LIVE_ROOM_KEY_PREFIX } from "@/lib/realtime/live-visitor-room";
import { LEGACY_APP_KEYS } from "@/lib/utils/clear-local-data";

beforeEach(() => localStorage.clear());

describe("toolkit backup", () => {
  it("includes tool data and preferences but never secrets or identity", () => {
    expect(isBackupKey("agile-toolkit:workspace")).toBe(true);
    expect(isBackupKey("agile-toolkit:burndown")).toBe(true);
    expect(isBackupKey("ae-theme")).toBe(true);
    expect(isBackupKey("agile-toolkit:llm")).toBe(false);
    expect(isBackupKey("agile-toolkit:user")).toBe(false);
    expect(isBackupKey("agile-toolkit:sync:unsynced-blobs")).toBe(false);
    expect(isBackupKey("someone-else:key")).toBe(false);
  });

  it("keeps the Activity inbox out, so a restore can't bring back stale unread rows", () => {
    expect(isBackupKey("agile-toolkit:activity")).toBe(false);
    // Moments still waiting for Amr belong to this browser too.
    expect(isBackupKey("agile-toolkit:moments")).toBe(false);
    // Notification preferences and the gamification profile do travel.
    expect(isBackupKey("agile-toolkit:notification-prefs")).toBe(true);
    expect(isBackupKey("agile-toolkit:vdna")).toBe(true);
  });

  it("keeps the comics count marks out of a backup, in both directions", () => {
    const mark = "agile-toolkit:comics:entry:poster:12:3";
    expect(isBackupKey(mark)).toBe(false);
    expect(isBackupKey("agile-toolkit:comics:entry:direct")).toBe(false);
    // Which intros this device has seen: another device should still see them.
    for (const kind of INTRO_KINDS) expect(isBackupKey(introMarkKey(kind))).toBe(false);

    localStorage.setItem(mark, "2026-11-01");
    localStorage.setItem("agile-toolkit:retro", "{}");
    expect(Object.keys(collectBackup(localStorage).keys)).toEqual(["agile-toolkit:retro"]);

    localStorage.clear();
    const parsed = parseBackup(
      JSON.stringify({
        format: "agile-toolkit-backup",
        version: 1,
        createdAt: "",
        keys: { [mark]: "2026-11-01" },
      })
    );
    if (!parsed.ok) throw new Error(parsed.error);
    restoreBackup(parsed.backup, localStorage);
    expect(localStorage.getItem(mark)).toBeNull();
  });

  describe("visitor AI consent: each browser is asked for itself", () => {
    it("excludes the same key the consent card writes", () => {
      // backup.ts names the key as a literal. If the card's key changes, this fails.
      expect(VISITOR_AI_CONSENT_KEY).toBe("agile-toolkit:amr-ai-consent");
      expect(isBackupKey(VISITOR_AI_CONSENT_KEY)).toBe(false);
    });

    it("leaves the consent out of an export", () => {
      localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
      localStorage.setItem("agile-toolkit:retro", "{}");
      const backup = collectBackup(localStorage);
      expect(Object.keys(backup.keys)).toEqual(["agile-toolkit:retro"]);
      expect(serializeBackup(backup)).not.toContain(VISITOR_AI_CONSENT_KEY);
    });

    it("drops the consent from a file on restore, so the card still shows", () => {
      const parsed = parseBackup(
        JSON.stringify({
          format: "agile-toolkit-backup",
          version: 1,
          createdAt: "",
          keys: {
            [VISITOR_AI_CONSENT_KEY]: VISITOR_AI_CONSENT_VERSION,
            "agile-toolkit:retro": "{}",
          },
        })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      expect(Object.keys(parsed.backup.keys)).toEqual(["agile-toolkit:retro"]);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBeNull();
      expect(localStorage.getItem("agile-toolkit:retro")).toBe("{}");
    });

    it("keeps this browser's own consent through a restore", () => {
      localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
      const parsed = parseBackup(
        JSON.stringify({ format: "agile-toolkit-backup", version: 1, createdAt: "", keys: {} })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(VISITOR_AI_CONSENT_KEY)).toBe(VISITOR_AI_CONSENT_VERSION);
    });
  });

  describe("a tab's live room stamp: true for a few minutes, in this browser only", () => {
    const stamp = `${LIVE_ROOM_KEY_PREFIX}some-tab`;

    it("excludes the same prefix the room's tab writes", () => {
      // backup.ts names the prefix as a literal. If the stamp's key changes, this fails.
      expect(LIVE_ROOM_KEY_PREFIX).toBe("agile-toolkit:live-room:");
      expect(isBackupKey(stamp)).toBe(false);
    });

    it("leaves the stamp out of an export and drops it from a file", () => {
      localStorage.setItem(stamp, "1");
      localStorage.setItem("agile-toolkit:retro", "{}");
      expect(Object.keys(collectBackup(localStorage).keys)).toEqual(["agile-toolkit:retro"]);

      const parsed = parseBackup(
        JSON.stringify({
          format: "agile-toolkit-backup",
          version: 1,
          createdAt: "",
          keys: { [`${LIVE_ROOM_KEY_PREFIX}old-tab`]: "1", "agile-toolkit:retro": "{}" },
        })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      expect(Object.keys(parsed.backup.keys)).toEqual(["agile-toolkit:retro"]);
    });

    it("keeps another tab's stamp through a restore, so Amr stays without tools", () => {
      localStorage.setItem(stamp, "1");
      const parsed = parseBackup(
        JSON.stringify({ format: "agile-toolkit-backup", version: 1, createdAt: "", keys: {} })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(stamp)).toBe("1");
    });
  });

  describe("what Amr remembers of a visitor: cleared with the rest, never in a backup", () => {
    const memory = JSON.stringify({
      v: 1,
      firstDay: "2026-11-01",
      lastDay: "2026-11-09",
      days: 4,
      streak: 2,
      counts: { pat: 7 },
      recent: ["wave"],
    });

    it("is not a backup key, and neither are his other notes about the browser", () => {
      expect(isBackupKey(MEMORY_KEY)).toBe(false);
      for (const key of ["mascot_last_day", "mascot_greeted", "mascot_helped", "mascot_weather"]) {
        expect(isBackupKey(key)).toBe(false);
      }
      // LEGACY_APP_KEYS is cleared AND backed up, so of Amr's keys only his look belongs on it.
      expect(LEGACY_APP_KEYS.filter((key) => key.startsWith("mascot_"))).toEqual([
        "mascot_appearance",
      ]);
      for (const key of LEGACY_APP_KEYS) expect(isBackupKey(key)).toBe(true);
    });

    it("leaves his memory out of an export and drops it from a file", () => {
      localStorage.setItem(MEMORY_KEY, memory);
      localStorage.setItem("agile-toolkit:retro", "{}");
      const backup = collectBackup(localStorage);
      expect(Object.keys(backup.keys)).toEqual(["agile-toolkit:retro"]);
      expect(serializeBackup(backup)).not.toContain(MEMORY_KEY);

      localStorage.clear();
      const parsed = parseBackup(
        JSON.stringify({
          format: "agile-toolkit-backup",
          version: 1,
          createdAt: "",
          keys: { [MEMORY_KEY]: memory, "agile-toolkit:retro": "{}" },
        })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      expect(Object.keys(parsed.backup.keys)).toEqual(["agile-toolkit:retro"]);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(MEMORY_KEY)).toBeNull();
    });

    it("keeps this browser's own memory through a restore", () => {
      localStorage.setItem(MEMORY_KEY, memory);
      const parsed = parseBackup(
        JSON.stringify({ format: "agile-toolkit-backup", version: 1, createdAt: "", keys: {} })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(MEMORY_KEY)).toBe(memory);
    });
  });

  describe("Amr's offer to feel the phone: each phone is asked for itself", () => {
    const look = { auraColor: "#22d3ee", feelPhone: true };

    it("excludes the same key the mark is kept under", () => {
      // backup.ts names the key as a literal. If the store's key changes, this fails.
      expect(MOTION_ASKED_KEY).toBe("agile-toolkit:mascot:motion-asked");
      expect(isBackupKey(MOTION_ASKED_KEY)).toBe(false);
      // His look and the visitor's answer still travel.
      expect(isBackupKey("mascot_appearance")).toBe(true);
    });

    it("leaves the mark out of an export, the old one inside his appearance too", () => {
      localStorage.setItem(MOTION_ASKED_KEY, "1");
      localStorage.setItem("mascot_appearance", JSON.stringify({ ...look, motionAsked: true }));
      const backup = collectBackup(localStorage);
      expect(backup.keys).toEqual({ mascot_appearance: JSON.stringify(look) });
      expect(serializeBackup(backup)).not.toMatch(/motion-?asked/i);
      // The browser's own copy is not touched by taking a backup.
      expect(JSON.parse(localStorage.getItem("mascot_appearance")!).motionAsked).toBe(true);
    });

    it("drops the mark from a file, old or new, and keeps the rest of his appearance", () => {
      const parsed = parseBackup(
        JSON.stringify({
          format: "agile-toolkit-backup",
          version: 1,
          createdAt: "",
          keys: {
            [MOTION_ASKED_KEY]: "1",
            mascot_appearance: JSON.stringify({ ...look, motionAsked: true }),
          },
        })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.backup.keys).toEqual({ mascot_appearance: JSON.stringify(look) });
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(MOTION_ASKED_KEY)).toBeNull();
      expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toEqual(look);
    });

    it("leaves an appearance it can't read, or one without the mark, as it is", () => {
      localStorage.setItem("mascot_appearance", "not json");
      expect(collectBackup(localStorage).keys.mascot_appearance).toBe("not json");
      localStorage.setItem("mascot_appearance", JSON.stringify(look));
      expect(collectBackup(localStorage).keys.mascot_appearance).toBe(JSON.stringify(look));
      // Only his appearance is looked into: a tool's own field of that name stays.
      localStorage.setItem("agile-toolkit:retro", JSON.stringify({ motionAsked: true }));
      expect(collectBackup(localStorage).keys["agile-toolkit:retro"]).toBe(
        JSON.stringify({ motionAsked: true })
      );
    });

    it("keeps this phone's own mark through a restore", () => {
      localStorage.setItem(MOTION_ASKED_KEY, "1");
      const parsed = parseBackup(
        JSON.stringify({ format: "agile-toolkit-backup", version: 1, createdAt: "", keys: {} })
      );
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      expect(localStorage.getItem(MOTION_ASKED_KEY)).toBe("1");
    });
  });

  it("round-trips the toolkit's data through a file", () => {
    localStorage.setItem("agile-toolkit:workspace", JSON.stringify({ state: { okrs: [1] } }));
    localStorage.setItem("agile-toolkit:burndown", JSON.stringify({ state: { points: 40 } }));
    localStorage.setItem("agile-toolkit:llm", JSON.stringify({ apiKey: "sk-secret" }));
    const file = serializeBackup(collectBackup(localStorage, new Date("2026-10-16T10:00:00Z")));
    expect(file).not.toContain("sk-secret");

    localStorage.clear();
    localStorage.setItem("agile-toolkit:retro", "stale");
    const parsed = parseBackup(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = restoreBackup(parsed.backup, localStorage);
    expect(result).toEqual({ written: 2, removed: 1 });
    expect(JSON.parse(localStorage.getItem("agile-toolkit:workspace")!)).toEqual({
      state: { okrs: [1] },
    });
    expect(localStorage.getItem("agile-toolkit:retro")).toBeNull();
  });

  it("leaves excluded keys alone on restore", () => {
    localStorage.setItem("agile-toolkit:llm", "keep-me");
    const parsed = parseBackup(
      JSON.stringify({ format: "agile-toolkit-backup", version: 1, createdAt: "", keys: {} })
    );
    if (!parsed.ok) throw new Error(parsed.error);
    restoreBackup(parsed.backup, localStorage);
    expect(localStorage.getItem("agile-toolkit:llm")).toBe("keep-me");
  });

  it("rejects files that aren't backups", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(
      parseBackup(JSON.stringify({ format: "agile-toolkit-backup", version: 99, keys: {} })).ok
    ).toBe(false);
  });

  it("drops foreign keys, secrets and prototype-polluting payloads", () => {
    const text = JSON.stringify({
      format: "agile-toolkit-backup",
      version: 1,
      createdAt: "",
      keys: {
        "agile-toolkit:llm": "smuggled",
        "evil:key": "x",
        "agile-toolkit:workspace": '{"__proto__":{"polluted":true},"state":{}}',
      },
    });
    const parsed = parseBackup(text);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(Object.keys(parsed.backup.keys)).toEqual(["agile-toolkit:workspace"]);
    expect(parsed.backup.keys["agile-toolkit:workspace"]).toBe('{"state":{}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("names files by local date", () => {
    expect(backupFilename(new Date(2026, 9, 16, 23, 30))).toBe(
      "agile-toolkit-backup-2026-10-16.json"
    );
  });
});
