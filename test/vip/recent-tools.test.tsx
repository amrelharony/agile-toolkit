/** A lock panel isn't a visit: it stays out of a visitor's recent tools. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import { RecentToolTracker, useToolPrefs } from "@/lib/tools/tool-prefs";
import { clearVipHint, setVipHint } from "@/lib/vip/hint";

const recentIds = () => renderHook(() => useToolPrefs()).result.current.recent.map((r) => r.id);

beforeEach(() => {
  clearVipHint();
});
afterEach(() => {
  clearVipHint();
  cleanup();
});

describe("recent tools", () => {
  it("skips a VIP tool without the hint", async () => {
    h.pathname = "/meet-the-cast";
    render(<RecentToolTracker />);
    h.pathname = "/retro";
    render(<RecentToolTracker />);
    await waitFor(() => expect(recentIds()).toContain("retro"));
    expect(recentIds()).not.toContain("meet-the-cast");
  });

  it("records it with the hint", async () => {
    setVipHint();
    h.pathname = "/squad-session";
    render(<RecentToolTracker />);
    await waitFor(() => expect(recentIds()).toContain("squad-session"));
  });
});
