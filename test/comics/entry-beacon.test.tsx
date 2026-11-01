import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { EntryBeacon } from "@/app/(tools)/comics/components/entry-beacon";
import { isDirectArrival, sendEntryBeacon } from "@/lib/comics/entry-beacon";

const sendBeacon = vi.fn(() => true);

function setReferrer(value: string) {
  Object.defineProperty(document, "referrer", { value, configurable: true });
}

async function sentBody(call = 0): Promise<unknown> {
  const [url, blob] = sendBeacon.mock.calls[call] as unknown as [string, Blob];
  expect(url).toBe("/api/comics/hit");
  return JSON.parse(await blob.text());
}

beforeEach(() => {
  sendBeacon.mockClear();
  sendBeacon.mockReturnValue(true);
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  localStorage.clear();
  setReferrer("");
  window.history.replaceState(null, "", "/comics");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the poster beacon", () => {
  it("reads the building from the address and sends only allowlisted values", async () => {
    window.history.replaceState(null, "", "/comics?ep=12&b=03");
    render(<EntryBeacon entry="poster" ep={12} />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(await sentBody()).toEqual({ entry: "poster", ep: 12, b: 3 });
  });

  it("sends nothing without a valid building", () => {
    window.history.replaceState(null, "", "/comics?ep=12&b=99");
    render(<EntryBeacon entry="poster" ep={12} />);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("counts each poster once a day on this device", () => {
    window.history.replaceState(null, "", "/comics?ep=12&b=03");
    render(<EntryBeacon entry="poster" ep={12} />);
    render(<EntryBeacon entry="poster" ep={12} />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    window.history.replaceState(null, "", "/comics?ep=12&b=04");
    render(<EntryBeacon entry="poster" ep={12} />);
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("counts again the next day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    expect(sendEntryBeacon({ entry: "direct" })).toBe(true);
    expect(sendEntryBeacon({ entry: "direct" })).toBe(false);
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    expect(sendEntryBeacon({ entry: "direct" })).toBe(true);
  });

  it("keeps its mark under the prefix Clear data removes", () => {
    sendEntryBeacon({ entry: "poster", ep: 12, b: 3 });
    const keys = Object.keys(localStorage);
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith("agile-toolkit:")).toBe(true);
  });

  it("doesn't mark a beacon the browser refused to queue", () => {
    sendBeacon.mockReturnValue(false);
    expect(sendEntryBeacon({ entry: "direct" })).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(sendEntryBeacon({ entry: "direct" })).toBe(true);
  });
});

describe("the direct count", () => {
  it("counts the plain address with no referrer", async () => {
    render(<EntryBeacon entry="direct" />);
    expect(await sentBody()).toEqual({ entry: "direct" });
  });

  it("counts an arrival from another site", () => {
    setReferrer("https://www.example.com/page");
    expect(isDirectArrival()).toBe(true);
  });

  it("doesn't count someone already on this site", () => {
    setReferrer(`${window.location.origin}/retro`);
    render(<EntryBeacon entry="direct" />);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("doesn't count a client navigation, which keeps the first page's referrer", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${window.location.origin}/retro` } as PerformanceEntry,
    ]);
    expect(isDirectArrival()).toBe(false);
  });

  it("doesn't count arriving at a story, then opening the gallery", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${window.location.origin}/comics?ep=12` } as PerformanceEntry,
    ]);
    expect(isDirectArrival()).toBe(false);
  });

  it("counts a document that began at the plain address", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${window.location.origin}/comics` } as PerformanceEntry,
    ]);
    expect(isDirectArrival()).toBe(true);
  });

  it("doesn't count an address with a query", () => {
    window.history.replaceState(null, "", "/comics?ep=abc");
    expect(isDirectArrival()).toBe(false);
  });
});
