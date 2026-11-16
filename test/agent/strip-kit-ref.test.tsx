/**
 * The strip kit's holder (chat/strip-kit-ref): empty until a kit is provided,
 * it tells its readers once per new kit and never for the same kit again, so
 * the owner's chat (which imports the kit) and a visitor's runtime (which
 * brings it too) can both provide it and nothing draws twice. Evaluating
 * chat/strip-kit fills it with the real parts.
 */

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  currentStripKit,
  provideStripKit,
  subscribeStripKit,
  useStripKit,
} from "@/components/agent/chat/strip-kit-ref";
import type { StripKit } from "@/components/agent/chat/strip-kit";

/** A stand-in kit: the holder never looks inside one. */
const fakeKit = () => ({}) as unknown as StripKit;

describe("the strip kit's holder", () => {
  it("is empty until a kit is provided, and tells its listeners once per new kit", () => {
    expect(currentStripKit()).toBeNull();
    const listener = vi.fn();
    const stop = subscribeStripKit(listener);
    const kit = fakeKit();

    provideStripKit(kit);
    expect(currentStripKit()).toBe(kit);
    expect(listener).toHaveBeenCalledTimes(1);
    // The same kit again (the owner's chat and a visitor's runtime both
    // provide it): no one is told.
    provideStripKit(kit);
    expect(listener).toHaveBeenCalledTimes(1);

    const next = fakeKit();
    provideStripKit(next);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    provideStripKit(fakeKit());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("draws its readers again as a new kit arrives", () => {
    const seen: (StripKit | null)[] = [];
    function Reader() {
      seen.push(useStripKit());
      return null;
    }
    render(<Reader />);
    const before = currentStripKit();
    expect(seen).toEqual([before]);
    const kit = fakeKit();
    act(() => provideStripKit(kit));
    expect(seen).toEqual([before, kit]);
    act(() => provideStripKit(kit));
    expect(seen).toEqual([before, kit]);
  });

  it("is filled by evaluating the kit, with the parts that draw and read messages", async () => {
    const { STRIP_KIT } = await import("@/components/agent/chat/strip-kit");
    expect(currentStripKit()).toBe(STRIP_KIT);
    expect(Object.isFrozen(STRIP_KIT)).toBe(true);
    expect(Object.keys(STRIP_KIT).sort()).toEqual(
      [
        "ChatItemView",
        "ConfirmCard",
        "cardUnderStep",
        "latestReply",
        "toolLabel",
        "createChatView",
        "turnAnnouncement",
      ].sort()
    );
  });
});
