import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

// The bridge only reads the sync gate and calls into cloud-sync/backfill,
// so all three are stubbed: the gate value is flipped per test and the
// side-effect modules are asserted on.
const h = vi.hoisted(() => ({
  gate: false,
  install: vi.fn(),
  uninstall: vi.fn(),
  backfill: vi.fn(async () => {}),
  resetLatch: vi.fn(),
}));

vi.mock("@/lib/sync/owner-sync-gate", () => ({
  useOwnerSyncGate: () => h.gate,
}));
vi.mock("@/lib/kudos/cloud-sync", () => ({
  installKudosCloudSync: h.install,
  uninstallKudosCloudSync: h.uninstall,
}));
vi.mock("@/lib/kudos/backfill", () => ({
  runKudosBackfillIfNeeded: h.backfill,
  resetKudosBackfillLatch: h.resetLatch,
}));

import { KudosOwnerBridge } from "@/lib/kudos/owner-bridge";

/** The backfill is kicked off in a microtask after the effect. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

describe("KudosOwnerBridge", () => {
  beforeEach(() => {
    h.gate = false;
    h.install.mockClear();
    h.uninstall.mockClear();
    h.backfill.mockClear();
    h.resetLatch.mockClear();
  });

  it("does nothing for a visitor", async () => {
    const { container } = render(<KudosOwnerBridge />);
    await flushMicrotasks();
    expect(container.innerHTML).toBe("");
    expect(h.install).not.toHaveBeenCalled();
    expect(h.backfill).not.toHaveBeenCalled();
    expect(h.uninstall).not.toHaveBeenCalled();
  });

  it("installs cloud sync and runs the backfill once the gate opens", async () => {
    const { rerender } = render(<KudosOwnerBridge />);
    h.gate = true;
    rerender(<KudosOwnerBridge />);
    await flushMicrotasks();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.backfill).toHaveBeenCalledTimes(1);
    expect(h.uninstall).not.toHaveBeenCalled();

    // Re-renders with the gate still open don't re-install.
    rerender(<KudosOwnerBridge />);
    await flushMicrotasks();
    expect(h.install).toHaveBeenCalledTimes(1);
    expect(h.backfill).toHaveBeenCalledTimes(1);
  });

  it("uninstalls when the gate closes (owner signed out)", async () => {
    h.gate = true;
    const { rerender } = render(<KudosOwnerBridge />);
    await flushMicrotasks();
    expect(h.install).toHaveBeenCalledTimes(1);

    h.gate = false;
    rerender(<KudosOwnerBridge />);
    expect(h.uninstall).toHaveBeenCalledTimes(1);
    expect(h.install).toHaveBeenCalledTimes(1);
    // Kudos sent while the gate is closed aren't queued: the next opening
    // in this tab session must backfill again, latch or not.
    expect(h.resetLatch).toHaveBeenCalledTimes(1);

    // Signing back in installs again.
    h.gate = true;
    rerender(<KudosOwnerBridge />);
    await flushMicrotasks();
    expect(h.install).toHaveBeenCalledTimes(2);
    expect(h.backfill).toHaveBeenCalledTimes(2);
  });

  it("uninstalls on unmount", async () => {
    h.gate = true;
    const { unmount } = render(<KudosOwnerBridge />);
    await flushMicrotasks();
    unmount();
    expect(h.uninstall).toHaveBeenCalledTimes(1);
  });
});
