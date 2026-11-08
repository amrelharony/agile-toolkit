import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * CopyButton + useFlash: a copy is confirmed in place ("Copied ✓"), heard by
 * screen readers, and reaches the notification policy as an `echo`, which
 * shows no toast and plays no sound unless the user turned on confirmations
 * as pop-ups. A failed copy still gets `toast.error`. sonner and the
 * feedback call are mocked; the real wrapper, executor and policy run.
 */

const h = vi.hoisted(() => {
  const fn = () => vi.fn((_m: unknown, o?: { id?: string | number }) => o?.id ?? "x");
  const sonner = Object.assign(fn(), {
    success: fn(),
    error: fn(),
    info: fn(),
    warning: fn(),
    message: fn(),
    loading: fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  });
  return { sonner, emitFeedback: vi.fn(), copy: vi.fn(async (text: string) => text.length >= 0) };
});

vi.mock("sonner", () => ({ toast: h.sonner }));
vi.mock("@/lib/sonification/emit", () => ({ emitFeedback: h.emitFeedback }));
vi.mock("@/lib/utils/export", () => ({ copyToClipboard: h.copy }));

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { CopyButton } from "@/components/ui/copy-button";
import { FLASH_MS, useFlash } from "@/hooks/use-flash";
import { __resetNotifyForTests, __setPolicyContextForTests } from "@/lib/notify/notify";

function renderButton(props: Partial<React.ComponentProps<typeof CopyButton>> = {}) {
  return render(
    <LiveAnnouncerProvider>
      <CopyButton text="https://example.test/x" confirmMs={80} {...props} />
    </LiveAnnouncerProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.copy.mockImplementation(async () => true);
  __resetNotifyForTests();
  __setPolicyContextForTests({
    quiet: { quiet: false, reason: null },
    dialogOpen: false,
    typing: false,
    phone: true,
    touch: true,
    confirmationsAsToasts: false,
    mutedKeys: [],
  });
});

afterEach(() => {
  __setPolicyContextForTests(null);
});

describe("CopyButton", () => {
  it("defaults to a 1.5 s confirmation", () => {
    expect(FLASH_MS).toBe(1500);
  });

  it("copies, reads Copied, then goes back to Copy", async () => {
    renderButton();
    const button = screen.getByRole("button", { name: "Copy" });
    fireEvent.click(button);
    await screen.findByRole("button", { name: "Copied" });
    expect(h.copy).toHaveBeenCalledWith("https://example.test/x");
    expect(button.getAttribute("data-copied")).toBe("true");
    await screen.findByRole("button", { name: "Copy" }, { timeout: 2000 });
  });

  it("shows no toast and plays no sound or haptic", async () => {
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByRole("button", { name: "Copied" });
    for (const f of [h.sonner, h.sonner.success, h.sonner.info, h.sonner.message]) {
      expect(f).not.toHaveBeenCalled();
    }
    expect(h.emitFeedback).not.toHaveBeenCalled();
  });

  it("announces the copy to screen readers", async () => {
    renderButton({ announcement: "Invite link copied" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(screen.getByTestId("live-polite").textContent).toBe("Invite link copied")
    );
  });

  it("shows a pop-up when the user asked for confirmations as pop-ups", async () => {
    __setPolicyContextForTests({ confirmationsAsToasts: true });
    renderButton({ announcement: "Link copied" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(h.sonner.success).toHaveBeenCalledTimes(1));
    expect(h.sonner.success.mock.calls[0][0]).toBe("Link copied");
    // An echo is never loud, even as a pop-up.
    expect(h.emitFeedback).not.toHaveBeenCalled();
  });

  it("keeps a toast.error when the copy fails, and stays on Copy", async () => {
    h.copy.mockImplementation(async () => false);
    renderButton({ errorMessage: "Couldn't copy" });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(h.sonner.error).toHaveBeenCalledTimes(1));
    expect(h.sonner.error.mock.calls[0][0]).toBe("Couldn't copy");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("builds the text lazily and reports onCopied", async () => {
    const onCopied = vi.fn();
    renderButton({ text: async () => "built", onCopied });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    expect(h.copy).toHaveBeenCalledWith("built");
  });

  it("treats a throwing text builder as a failure", async () => {
    renderButton({
      text: () => {
        throw new Error("nope");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(h.sonner.error).toHaveBeenCalledTimes(1));
  });
});

function Two() {
  const { flash, isFlashing } = useFlash(80);
  return (
    <>
      <button onClick={() => flash("A copied", "a")}>{isFlashing("a") ? "A done" : "A"}</button>
      <button onClick={() => flash("B copied", "b")}>{isFlashing("b") ? "B done" : "B"}</button>
    </>
  );
}

describe("useFlash", () => {
  it("tells keyed controls apart: only the latest one confirms", async () => {
    render(<Two />);
    act(() => screen.getByRole("button", { name: "A" }).click());
    expect(screen.getByRole("button", { name: "A done" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: "B" }).click());
    expect(screen.getByRole("button", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "B done" })).toBeTruthy();
    await screen.findByRole("button", { name: "B" }, { timeout: 2000 });
  });

  it("leaves no timer behind when it unmounts", () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Two />);
      act(() => screen.getByRole("button", { name: "A" }).click());
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
