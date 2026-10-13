import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAgentBackend } from "@/lib/agent/use-agent-backend";

const SERVER = { mode: "server", provider: "openclaw", model: "m-1" };

describe("useAgentBackend", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => SERVER }));
    vi.stubGlobal("fetch", fetchSpy);
    // Start each test from an empty module cache: a disabled render clears it.
    renderHook(() => useAgentBackend({ enabled: false })).unmount();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no request and returns null when disabled (visitor)", () => {
    const { result } = renderHook(() => useAgentBackend({ enabled: false }));
    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probes the agent route for the owner", async () => {
    const { result } = renderHook(() => useAgentBackend({ enabled: true }));
    await waitFor(() => expect(result.current).toEqual(SERVER));
    expect(fetchSpy).toHaveBeenCalledWith("/api/agent/stream", { method: "GET" });
  });

  it("forgets the owner's answer on sign-out", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAgentBackend({ enabled }), {
      initialProps: { enabled: true },
    });
    await waitFor(() => expect(result.current).toEqual(SERVER));

    rerender({ enabled: false });
    expect(result.current).toBeNull();

    // A later mount (e.g. a visitor's chip) neither sees the cached value
    // nor re-probes.
    fetchSpy.mockClear();
    const visitor = renderHook(() => useAgentBackend({ enabled: false }));
    expect(visitor.result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Signing back in probes again instead of reusing a stale answer.
    rerender({ enabled: true });
    await waitFor(() => expect(result.current).toEqual(SERVER));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
