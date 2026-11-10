/**
 * The calendar download: the iCalendar text is saved as it is (its CRLF line
 * endings, no byte-order mark in front of BEGIN:VCALENDAR) under a safe
 * `.ics` name, and is not counted as an export.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ saveAs: vi.fn(), dispatch: vi.fn() }));
vi.mock("html-to-image", () => ({ toPng: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: h.saveAs }));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: h.dispatch }));

import { exportToICS } from "@/lib/utils/export";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nSUMMARY:Daily Scrum · Sprint 1\r\nEND:VCALENDAR\r\n";

const readText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

beforeEach(() => {
  h.saveAs.mockReset();
  h.dispatch.mockReset();
});

describe("exportToICS", () => {
  it("saves the text unchanged as a calendar file", async () => {
    exportToICS(ICS, "sprint-1-ceremonies");
    expect(h.saveAs).toHaveBeenCalledTimes(1);
    const [blob, name] = h.saveAs.mock.calls[0] as [Blob, string];
    expect(name).toBe("sprint-1-ceremonies.ics");
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    // UTF-8, with nothing added in front or between the lines.
    expect(blob.size).toBe(new TextEncoder().encode(ICS).length);
    expect(await readText(blob)).toBe(ICS);
  });

  it("keeps the name inside its folder", () => {
    exportToICS(ICS, "../sprint 1/2: ceremonies");
    expect(h.saveAs.mock.calls[0][1]).toBe("_sprint 1_2_ ceremonies.ics");
  });

  it("is not counted as an export", async () => {
    exportToICS(ICS, "sprint-1-ceremonies");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
