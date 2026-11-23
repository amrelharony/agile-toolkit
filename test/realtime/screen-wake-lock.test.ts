import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { holdScreenAwake } from "@/lib/realtime/screen-wake-lock";

/**
 * The screen wake lock a visitor live room holds (screen-wake-lock.ts):
 * asked for when a room opens, asked for again when the page becomes
 * visible, let go when the last room closes, and silent where the browser
 * has none or refuses.
 */

interface FakeSentinel {
  released: boolean;
  release: ReturnType<typeof vi.fn>;
  addEventListener: (type: "release", listener: () => void) => void;
  /** What the browser does when the page is hidden. */
  dropByBrowser: () => void;
}

function fakeSentinel(): FakeSentinel {
  const listeners: (() => void)[] = [];
  const s: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      if (s.released) return;
      s.released = true;
      listeners.forEach((l) => l());
    }),
    addEventListener: (_type, listener) => listeners.push(listener),
    dropByBrowser: () => {
      s.released = true;
      listeners.forEach((l) => l());
    },
  };
  return s;
}

let visibility: DocumentVisibilityState = "visible";
let sentinels: FakeSentinel[] = [];
const request = vi.fn<(type: string) => Promise<FakeSentinel>>(async () => {
  const s = fakeSentinel();
  sentinels.push(s);
  return s;
});

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Let the request's promise settle. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  visibility = "visible";
  sentinels = [];
  request.mockClear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "wakeLock");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("holdScreenAwake", () => {
  it("asks for a screen wake lock when a room opens and lets it go when it closes", async () => {
    const release = holdScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("screen");
    expect(sentinels[0].release).not.toHaveBeenCalled();

    release();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    // Twice is safe.
    release();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("shares one lock between two rooms and lets go after the last", async () => {
    const first = holdScreenAwake();
    const second = holdScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    first();
    expect(sentinels[0].release).not.toHaveBeenCalled();
    second();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("asks again when the page becomes visible after the browser let go", async () => {
    const release = holdScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    // Hidden: the browser drops the lock, and nothing is asked while hidden.
    sentinels[0].dropByBrowser();
    setVisibility("hidden");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(2);

    release();
    expect(sentinels[1].release).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask twice while a lock is still held", async () => {
    const release = holdScreenAwake();
    await settle();
    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    release();
  });

  it("waits for the page to be visible before asking", async () => {
    visibility = "hidden";
    const release = holdScreenAwake();
    await settle();
    expect(request).not.toHaveBeenCalled();

    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    release();
  });

  it("stops listening once the room closes", async () => {
    const release = holdScreenAwake();
    await settle();
    release();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("lets go of a lock that arrives after the room closed", async () => {
    let grant: (s: FakeSentinel) => void = () => {};
    request.mockImplementationOnce(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          grant = resolve;
        })
    );
    const release = holdScreenAwake();
    release();
    const late = fakeSentinel();
    grant(late);
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it("carries on silently when the browser refuses", async () => {
    request.mockImplementationOnce(async () => {
      throw new DOMException("Battery saver is on", "NotAllowedError");
    });
    const release = holdScreenAwake();
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    // The next time the page is shown, it asks again.
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    release();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("carries on silently when the request throws straight away", async () => {
    request.mockImplementationOnce(() => {
      throw new TypeError("not supported");
    });
    const release = holdScreenAwake();
    await settle();
    expect(() => release()).not.toThrow();
  });

  it("does nothing where the browser has no wake lock", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");
    const release = holdScreenAwake();
    await settle();
    setVisibility("visible");
    await settle();
    expect(request).not.toHaveBeenCalled();
    expect(() => release()).not.toThrow();
  });
});
