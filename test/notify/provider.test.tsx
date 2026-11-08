import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NotifyProvider reports the route to the executor and asks held toasts
 * again when the route, presenting mode or the intro changes. It holds one
 * attention lease while mounted and polls nothing.
 */

const h = vi.hoisted(() => ({
  pathname: "/",
  flushPending: vi.fn(),
  setNotifyPathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));
vi.mock("@/lib/notify/notify", () => ({
  flushPending: h.flushPending,
  setNotifyPathname: h.setNotifyPathname,
}));

import { NotifyProvider } from "@/lib/notify/provider";
import { __resetAttentionForTests, isAttentionInstalled } from "@/lib/notify/attention";

beforeEach(() => {
  vi.clearAllMocks();
  __resetAttentionForTests();
  h.pathname = "/";
});

afterEach(() => {
  delete document.documentElement.dataset.presenting;
});

describe("NotifyProvider", () => {
  it("reports the route and flushes on every change", () => {
    const { rerender } = render(<NotifyProvider />);
    expect(h.setNotifyPathname).toHaveBeenLastCalledWith("/");
    const before = h.flushPending.mock.calls.length;
    h.pathname = "/retro";
    rerender(<NotifyProvider />);
    expect(h.setNotifyPathname).toHaveBeenLastCalledWith("/retro");
    expect(h.flushPending.mock.calls.length).toBe(before + 1);
  });

  it("holds an attention lease while mounted and adds no interval", () => {
    const interval = vi.spyOn(window, "setInterval");
    const { unmount } = render(<NotifyProvider />);
    expect(isAttentionInstalled()).toBe(true);
    unmount();
    expect(isAttentionInstalled()).toBe(false);
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
  });

  it("flushes when presenting mode ends", async () => {
    render(<NotifyProvider />);
    h.flushPending.mockClear();
    document.documentElement.dataset.presenting = "true";
    await vi.waitFor(() => expect(h.flushPending).toHaveBeenCalled());
  });
});
