/**
 * What Amr says beside himself: one short line at a time, sometimes with an
 * answer or two; and his one offer to feel the phone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MascotBubble } from "@/components/agent/mascot/mascot-bubble";
import {
  MOTION_INVITE_ID,
  inviteMotion,
  shouldInviteMotion,
} from "@/components/agent/mascot/motion-invite";
import { BUBBLE_ASK_MS, BUBBLE_MS, useBubbleStore } from "@/lib/agent/mascot/bubble";
import { MOTION_INVITE } from "@/lib/agent/mascot/lines";
import { MOTION_ASKED_KEY, useMascotStore } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import { collectBackup, parseBackup, restoreBackup, serializeBackup } from "@/lib/data/backup";
import { useMomentStore } from "@/lib/notify/moment-scheduler";

function stubMedia(matching: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matching(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useBubbleStore.setState({ current: null });
  useMascotStore.getState().reset();
  useMomentStore.setState({ current: null });
  useAgentStore.setState({ open: false });
  stubMedia(() => false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useBubbleStore.setState({ current: null });
  useMascotStore.getState().reset();
  useMomentStore.setState({ current: null });
});

const bubble = () => document.querySelector("[data-amr-bubble]");

describe("<MascotBubble />", () => {
  it("says a line beside him, then lets it go", () => {
    render(<MascotBubble />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(screen.getByRole("status")).toHaveTextContent("Welcome back");
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS + 10);
    });
    expect(bubble()).toBeNull();
  });

  it("waits longer for an answer, and stays while it's held", () => {
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [{ label: "Yes", run: () => {} }],
        onIgnore,
      })
    );
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS + 10);
    });
    expect(bubble()).not.toBeNull();
    fireEvent.pointerEnter(bubble()!);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_ASK_MS * 2);
    });
    expect(bubble()).not.toBeNull();
    fireEvent.pointerLeave(bubble()!);
    act(() => {
      vi.advanceTimersByTime(BUBBLE_ASK_MS + 10);
    });
    expect(bubble()).toBeNull();
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });

  it("runs the answer from the tap itself, and that isn't being ignored", () => {
    const run = vi.fn();
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [
          { label: "Yes", run },
          { label: "No thanks", run: () => {} },
        ],
        onIgnore,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
    expect(onIgnore).not.toHaveBeenCalled();
  });

  it("lets a line with no answers be tapped", () => {
    const onTap = vi.fn();
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "help", text: "Need a hand?", onTap }));
    fireEvent.click(screen.getByRole("button", { name: "Need a hand?" }));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
  });

  it("waits its turn behind a moment chip and his open panel, its clock too", () => {
    render(<MascotBubble />);
    act(() => useMomentStore.setState({ current: { id: "m" } as never }));
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Welcome back" }));
    expect(bubble()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(BUBBLE_MS * 3);
    });
    act(() => useMomentStore.setState({ current: null }));
    expect(bubble()).not.toBeNull();
    act(() => useAgentStore.setState({ open: true }));
    expect(bubble()).toBeNull();
    act(() => useAgentStore.setState({ open: false }));
    expect(bubble()).not.toBeNull();
  });

  it("replaces the line showing with a new one, which counts as ignoring the old", () => {
    const onIgnore = vi.fn();
    render(<MascotBubble />);
    act(() => useBubbleStore.getState().show({ id: "a", text: "One", onIgnore }));
    act(() => useBubbleStore.getState().show({ id: "b", text: "Two" }));
    expect(screen.getByRole("status")).toHaveTextContent("Two");
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });
});

describe("his offer to feel the phone", () => {
  let ask: ReturnType<typeof vi.fn>;

  /** A phone that asks before it sends motion (as iOS does). */
  function askingPhone(answer: "granted" | "denied" = "granted") {
    ask = vi.fn(async () => answer);
    stubMedia((q) => q.includes("pointer: coarse"));
    vi.stubGlobal(
      "DeviceOrientationEvent",
      class {
        static requestPermission = ask;
      }
    );
    useMascotStore.getState().setReady(true);
  }

  it("is made once, on a phone that needs asking", () => {
    askingPhone();
    expect(shouldInviteMotion()).toBe(true);
    expect(inviteMotion()).toBe(true);
    expect(useBubbleStore.getState().current).toMatchObject({
      id: MOTION_INVITE_ID,
      text: MOTION_INVITE.text,
    });
    expect(ask).not.toHaveBeenCalled(); // only a tap may raise the browser's prompt
    // Left alone or answered, he doesn't ask again: not now, not on another visit.
    useBubbleStore.getState().dismiss();
    expect(inviteMotion()).toBe(false);
    useMascotStore.getState().reset();
    useMascotStore.getState().hydrateAppearance();
    useMascotStore.getState().setReady(true);
    expect(useMascotStore.getState().motionAsked).toBe(true);
    expect(inviteMotion()).toBe(false);
  });

  it("notes that he asked under a key of its own, not in his appearance", () => {
    askingPhone();
    useMascotStore.getState().setAuraColor("#22d3ee");
    expect(inviteMotion()).toBe(true);
    expect(localStorage.getItem(MOTION_ASKED_KEY)).not.toBeNull();
    // Later changes to his appearance don't write the mark into it either.
    useMascotStore.getState().setAuraColor("#f59e0b");
    expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toEqual({
      auraColor: "#f59e0b",
      feelPhone: null,
    });
  });

  it("still knows he asked on a phone that noted it the old way, inside his appearance", () => {
    localStorage.setItem(
      "mascot_appearance",
      JSON.stringify({ auraColor: "#22d3ee", feelPhone: null, motionAsked: true })
    );
    askingPhone();
    useMascotStore.getState().hydrateAppearance();
    expect(useMascotStore.getState().motionAsked).toBe(true);
    expect(inviteMotion()).toBe(false);
    // Moved across once: the mark has its own key, and his appearance no longer carries it.
    expect(localStorage.getItem(MOTION_ASKED_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toEqual({
      auraColor: "#22d3ee",
      feelPhone: null,
    });
  });

  describe("on a phone restored from another phone's backup", () => {
    /** Wipe this "phone", restore the file into it, and load the page again. */
    function restoreOnAnotherPhone(file: string) {
      localStorage.clear();
      useBubbleStore.setState({ current: null });
      const parsed = parseBackup(file);
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      useMascotStore.getState().reset();
      useMascotStore.getState().hydrateAppearance();
      askingPhone();
    }

    it("is still made, though the first phone was asked", () => {
      askingPhone();
      useMascotStore.getState().setAuraColor("#22d3ee");
      expect(inviteMotion()).toBe(true); // asked, and the bubble left alone
      const file = serializeBackup(collectBackup(localStorage));
      expect(file).not.toMatch(/motion-?asked/i);

      restoreOnAnotherPhone(file);
      expect(useMascotStore.getState().auraColor).toBe("#22d3ee"); // his look did travel
      expect(useMascotStore.getState().motionAsked).toBe(false);
      expect(shouldInviteMotion()).toBe(true);
      expect(inviteMotion()).toBe(true);
    });

    it("is still made from an older backup that carries the mark inside his appearance", () => {
      const file = JSON.stringify({
        format: "agile-toolkit-backup",
        version: 1,
        createdAt: "2026-11-09T10:00:00.000Z",
        keys: {
          mascot_appearance: JSON.stringify({
            auraColor: "#22d3ee",
            feelPhone: null,
            motionAsked: true,
          }),
          [MOTION_ASKED_KEY]: "1", // a hand-edited file can't bring the new mark in either
        },
      });

      restoreOnAnotherPhone(file);
      expect(localStorage.getItem(MOTION_ASKED_KEY)).toBeNull();
      expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toEqual({
        auraColor: "#22d3ee",
        feelPhone: null,
      });
      expect(useMascotStore.getState().auraColor).toBe("#22d3ee");
      expect(shouldInviteMotion()).toBe(true);
    });

    it("isn't made again on the same phone, which keeps its own mark through a restore", () => {
      askingPhone();
      expect(inviteMotion()).toBe(true);
      const file = serializeBackup(collectBackup(localStorage));

      // The same phone: nothing wiped, the backup restored over what's there.
      const parsed = parseBackup(file);
      if (!parsed.ok) throw new Error(parsed.error);
      restoreBackup(parsed.backup, localStorage);
      useBubbleStore.setState({ current: null });
      useMascotStore.getState().reset();
      useMascotStore.getState().hydrateAppearance();
      askingPhone();
      expect(shouldInviteMotion()).toBe(false);
    });

    it("isn't made when the backup carries an answer: a choice travels", () => {
      askingPhone();
      useMascotStore.getState().setFeelPhone(false); // "No thanks", or the switch in his panel
      const file = serializeBackup(collectBackup(localStorage));

      restoreOnAnotherPhone(file);
      expect(useMascotStore.getState().feelPhone).toBe(false);
      expect(shouldInviteMotion()).toBe(false);
    });
  });

  it("isn't made where motion needs no asking, on a desktop, or under reduced motion", () => {
    // No prompt to raise: he feels the phone from the start.
    stubMedia((q) => q.includes("pointer: coarse"));
    vi.stubGlobal("DeviceOrientationEvent", class {});
    useMascotStore.getState().setReady(true);
    expect(shouldInviteMotion()).toBe(false);

    askingPhone();
    stubMedia(() => false); // a mouse
    expect(shouldInviteMotion()).toBe(false);

    stubMedia(() => true); // coarse, and reduced motion too
    expect(shouldInviteMotion()).toBe(false);

    askingPhone();
    useMascotStore.getState().setFeelPhone(false); // already answered in the panel
    expect(shouldInviteMotion()).toBe(false);
  });

  it("raises the browser's prompt on Allow and keeps the answer", async () => {
    askingPhone("granted");
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.allow }));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(bubble()).toBeNull();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useMascotStore.getState().feelPhone).toBe(true);
    expect(useMascotStore.getState().reactionQueue).toEqual(["startle"]);
    expect(JSON.parse(localStorage.getItem("mascot_appearance")!)).toEqual({
      auraColor: null,
      feelPhone: true,
    });
    expect(localStorage.getItem(MOTION_ASKED_KEY)).not.toBeNull();
  });

  it("takes No thanks for an answer", () => {
    askingPhone();
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.decline }));
    expect(ask).not.toHaveBeenCalled();
    expect(useMascotStore.getState().feelPhone).toBe(false);
    expect(bubble()).toBeNull();
  });

  it("keeps a refusal at the browser's prompt as a no", async () => {
    askingPhone("denied");
    render(<MascotBubble />);
    act(() => void inviteMotion());
    fireEvent.click(screen.getByRole("button", { name: MOTION_INVITE.allow }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useMascotStore.getState().feelPhone).toBe(false);
    expect(useMascotStore.getState().reactionQueue).toEqual([]);
  });
});
