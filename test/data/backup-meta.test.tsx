import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("@/lib/gamification/signal", () => ({ signalGamification: vi.fn() }));

import { saveAs } from "file-saver";
import {
  LAST_BACKUP_AGE_WIDEST,
  LAST_BACKUP_KEY,
  daysSinceBackup,
  lastBackupAge,
  lastBackupText,
  readLastBackupAt,
  recordBackup,
  subscribeLastBackup,
} from "@/lib/data/backup-meta";
import { downloadBackup } from "@/lib/data/download-backup";
import { useLastBackupAt } from "@/lib/data/use-last-backup";

/**
 * The last backup's day: how it is worded, and that a download anywhere on
 * the page (or in another tab) reaches whoever shows it.
 */

beforeEach(() => {
  localStorage.clear();
  vi.mocked(saveAs).mockClear();
});

describe("how old the last backup is", () => {
  const now = new Date("2026-11-10T09:00:00");

  it("counts calendar days, not 24-hour spans", () => {
    expect(daysSinceBackup("2026-11-10T00:05:00", now)).toBe(0);
    // Late last night is yesterday, though under ten hours ago.
    expect(daysSinceBackup("2026-11-09T23:30:00", now)).toBe(1);
    expect(daysSinceBackup("2026-10-27T12:00:00", now)).toBe(14);
  });

  it("has no age without a backup, or with a time it can't read", () => {
    expect(daysSinceBackup(null, now)).toBeNull();
    expect(daysSinceBackup("", now)).toBeNull();
    expect(daysSinceBackup("not a date", now)).toBeNull();
  });

  it("reads a backup dated ahead of the clock as today", () => {
    expect(daysSinceBackup("2026-11-12T09:00:00", now)).toBe(0);
  });

  it("says it in words", () => {
    expect(lastBackupText(null, now)).toBe("No backup yet");
    expect(lastBackupText("2026-11-10T08:00:00", now)).toBe("Last backup: today");
    expect(lastBackupText("2026-11-09T08:00:00", now)).toBe("Last backup: yesterday");
    expect(lastBackupText("2026-11-07T08:00:00", now)).toBe("Last backup: 3 days ago");
    expect(lastBackupText("2025-01-01T08:00:00", now)).toBe("Last backup: 678 days ago");
  });

  it("says a very old backup in years, so the age never outgrows three digits", () => {
    expect(lastBackupAge("2024-02-15T08:00:00", now)).toBe("999 days ago");
    expect(lastBackupAge("2024-02-14T08:00:00", now)).toBe("2 years ago");
    expect(lastBackupAge("2000-01-01T08:00:00", now)).toBe("26 years ago");
    expect(lastBackupAge(null, now)).toBeNull();
  });

  it("never writes an age longer than the width a control reserves for it", () => {
    const stamps = [
      "2026-11-10T08:00:00",
      "2026-11-09T08:00:00",
      "2026-08-02T08:00:00",
      "2024-02-15T08:00:00",
      "2000-01-01T08:00:00",
      "1930-01-01T08:00:00",
    ];
    for (const iso of stamps) {
      expect(lastBackupAge(iso, now)!.length).toBeLessThanOrEqual(LAST_BACKUP_AGE_WIDEST.length);
    }
  });
});

describe("following the last backup", () => {
  it("tells a listener when a backup is recorded in this tab", () => {
    const onChange = vi.fn();
    const stop = subscribeLastBackup(onChange);
    recordBackup(new Date("2026-11-10T09:00:00Z"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(readLastBackupAt()).toBe("2026-11-10T09:00:00.000Z");
    stop();
    recordBackup();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("tells a listener when another tab records one, and ignores other keys", () => {
    const onChange = vi.fn();
    const stop = subscribeLastBackup(onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: "agile-toolkit:workspace" }));
    expect(onChange).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: LAST_BACKUP_KEY }));
    // A cleared storage has no key.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("re-renders a reader the moment a backup is downloaded", () => {
    function Reader() {
      return <p>{useLastBackupAt() ?? "never"}</p>;
    }
    render(<Reader />);
    expect(screen.getByText("never")).toBeInTheDocument();
    act(() => recordBackup(new Date("2026-11-10T09:00:00Z")));
    expect(screen.getByText("2026-11-10T09:00:00.000Z")).toBeInTheDocument();
  });
});

describe("downloadBackup", () => {
  it("saves one file with everything, remembers when, and says how much it holds", () => {
    localStorage.setItem("agile-toolkit:workspace", "{}");
    localStorage.setItem("agile-toolkit:retro", "{}");
    // Never in a backup.
    localStorage.setItem("agile-toolkit:llm", "secret");
    expect(readLastBackupAt()).toBeNull();

    expect(downloadBackup()).toBe(2);
    expect(saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(saveAs).mock.calls[0] as [Blob, string];
    expect(blob.type).toBe("application/json");
    expect(name).toMatch(/\.json$/);
    expect(readLastBackupAt()).not.toBeNull();
  });
});
