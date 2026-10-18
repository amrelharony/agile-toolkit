import { beforeEach, describe, expect, it } from "vitest";
import { isBackupKey } from "@/lib/data/backup";
import {
  BACKUP_STALE_MS,
  MIN_WORK_BYTES,
  REMIND_GAP_MS,
  backupReminderDue,
  recordBackupReminder,
  shouldRemindBackup,
} from "@/lib/data/backup-reminder";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-18T12:00:00Z");

beforeEach(() => localStorage.clear());

describe("shouldRemindBackup", () => {
  const base = {
    now: NOW,
    firstSeenAt: NOW - 30 * DAY,
    lastBackupAt: null,
    lastRemindedAt: null,
    workBytes: MIN_WORK_BYTES,
  };

  it("reminds once there is work and no recent backup", () => {
    expect(shouldRemindBackup(base)).toBe(true);
  });

  it("stays quiet with too little work to lose", () => {
    expect(shouldRemindBackup({ ...base, workBytes: MIN_WORK_BYTES - 1 })).toBe(false);
  });

  it("waits two weeks after the first visit or the last backup", () => {
    expect(shouldRemindBackup({ ...base, firstSeenAt: NOW - BACKUP_STALE_MS + DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - 3 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastBackupAt: NOW - BACKUP_STALE_MS })).toBe(true);
  });

  it("reminds at most once a week", () => {
    expect(shouldRemindBackup({ ...base, lastRemindedAt: NOW - 2 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastRemindedAt: NOW - REMIND_GAP_MS })).toBe(true);
  });
});

describe("backupReminderDue", () => {
  const work = JSON.stringify({ state: { items: "x".repeat(MIN_WORK_BYTES) } });

  it("records the first visit and does not remind on it", () => {
    localStorage.setItem("agile-toolkit:workspace", work);
    expect(backupReminderDue(localStorage, NOW)).toBe(false);
    expect(localStorage.getItem("agile-toolkit:backup:first-seen")).toBe(String(NOW));
  });

  it("reminds two weeks later, then not again for a week", () => {
    localStorage.setItem("agile-toolkit:workspace", work);
    backupReminderDue(localStorage, NOW);
    const later = NOW + BACKUP_STALE_MS;
    expect(backupReminderDue(localStorage, later)).toBe(true);
    recordBackupReminder(localStorage, later);
    expect(backupReminderDue(localStorage, later + DAY)).toBe(false);
  });

  it("counts a backup taken since (ISO timestamp from the backup dialog)", () => {
    localStorage.setItem("agile-toolkit:workspace", work);
    localStorage.setItem("agile-toolkit:backup:first-seen", String(NOW - 60 * DAY));
    localStorage.setItem("agile-toolkit:backup:last", new Date(NOW - DAY).toISOString());
    expect(backupReminderDue(localStorage, NOW)).toBe(false);
  });

  it("keeps its bookkeeping out of backup files", () => {
    expect(isBackupKey("agile-toolkit:backup:first-seen")).toBe(false);
    expect(isBackupKey("agile-toolkit:backup:last")).toBe(false);
  });
});
