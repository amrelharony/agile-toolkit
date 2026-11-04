import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPackLoader, DECODE_WAIT_MS } from "@/components/agent/mascot/engine/packs";

/** An image that loads at once and decodes when told to (or never). */
class FakeImage {
  static made: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  resolveDecode: () => void = () => undefined;
  constructor() {
    FakeImage.made.push(this);
  }
  set src(_: string) {
    queueMicrotask(() => this.onload?.());
  }
  decode() {
    return new Promise<void>((r) => (this.resolveDecode = r));
  }
}

describe("the pack loader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeImage.made = [];
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is ready once the pack has decoded", async () => {
    const ready = vi.fn();
    const loader = createPackLoader(false, ready);
    loader.ensure(["touch"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.isReady("touch")).toBe(false);
    FakeImage.made[0].resolveDecode();
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.isReady("touch")).toBe(true);
    await vi.advanceTimersByTimeAsync(DECODE_WAIT_MS);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("doesn't wait for good on a decode that never ends (a page that isn't drawn)", async () => {
    const ready = vi.fn();
    const loader = createPackLoader(false, ready);
    loader.ensure(["touch"]);
    await vi.advanceTimersByTimeAsync(DECODE_WAIT_MS - 1);
    expect(loader.isReady("touch")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(loader.isReady("touch")).toBe(true);
    expect(ready).toHaveBeenCalledWith("touch");
  });

  it("fetches each pack once", () => {
    const loader = createPackLoader(false, () => undefined);
    loader.ensure(["touch", "touch"]);
    loader.ensure(["touch"]);
    expect(FakeImage.made).toHaveLength(1);
  });
});
