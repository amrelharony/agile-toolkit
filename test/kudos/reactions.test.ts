import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock the auth provider before importing the hook. The provider's .tsx
// file makes vitest's import-analysis stumble (it ships TSX that vite's
// transform doesn't fully chew through under our jsx=preserve config),
// and the hook (plus `useIsOwner`, which reads the same function) only
// needs `useAuthOptional()` to return either a value or null. Each test
// picks the owner context or null (a visitor: "anon" identity, no
// network) through the hoisted holder.
const h = vi.hoisted(() => ({
  auth: null as { status: string; user: { id: string } | null } | null,
}));
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

// Sonner toast does its own dynamic imports under the hood. Stub it
// inert so a rollback path that fires `toast.error(...)` doesn't
// touch the audio engine and slow the test down.
vi.mock("@/lib/utils/toast", () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  },
}));

import { useKudosReactions } from "@/app/(tools)/kudos/use-kudos-reactions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { toast } from "@/lib/utils/toast";
import type { Kudos } from "@/lib/stores/workspace-types";

function freshKudos(overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kud_${Math.random().toString(36).slice(2, 14)}`,
    theme: "thank-you",
    toName: "Alice",
    fromName: "Bob",
    message: "great review",
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

const OWNER = { status: "authenticated", user: { id: "u1" } };

describe("useKudosReactions", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    h.auth = OWNER;
    useWorkspaceStore.setState({ kudos: [] });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    useWorkspaceStore.setState({ kudos: [] });
    vi.unstubAllGlobals();
  });

  it("optimistically appends the reaction and POSTs to /api/kudos/[id]/reactions", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });

    const { result } = renderHook(() => useKudosReactions());
    await act(async () => {
      await result.current.addReaction(k.id, "🎉");
    });

    const state = useWorkspaceStore.getState().kudos ?? [];
    expect(state[0].reactions?.length).toBe(1);
    expect(state[0].reactions?.[0].emoji).toBe("🎉");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/kudos/${encodeURIComponent(k.id)}/reactions`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string).emoji).toBe("🎉");
  });

  it("rolls back the optimistic append on a non-200 response", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });

    const { result } = renderHook(() => useKudosReactions());
    await act(async () => {
      await result.current.addReaction(k.id, "🚀");
    });

    await waitFor(() => {
      const state = useWorkspaceStore.getState().kudos ?? [];
      // After the failed POST, reactions reverts to its original (undefined).
      expect(state[0].reactions ?? []).toEqual([]);
    });
  });

  it("is a no-op when the same viewer reacts twice with the same emoji", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const k = freshKudos({
      reactions: [{ emoji: "👏", byProfileId: "u1", at: new Date().toISOString() }],
    });
    useWorkspaceStore.setState({ kudos: [k] });

    const { result } = renderHook(() => useKudosReactions());
    await act(async () => {
      await result.current.addReaction(k.id, "👏");
    });

    // No network call because client-side idempotency short-circuits.
    expect(fetchSpy).not.toHaveBeenCalled();
    const state = useWorkspaceStore.getState().kudos ?? [];
    expect(state[0].reactions?.length).toBe(1);
  });

  it("groups multiple emoji on the same kudos under separate entries", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    const k = freshKudos();
    useWorkspaceStore.setState({ kudos: [k] });

    const { result } = renderHook(() => useKudosReactions());
    await act(async () => {
      await result.current.addReaction(k.id, "🎉");
    });
    await act(async () => {
      await result.current.addReaction(k.id, "🚀");
    });

    const state = useWorkspaceStore.getState().kudos ?? [];
    const emojis = state[0].reactions?.map((r) => r.emoji);
    expect(emojis).toEqual(["🎉", "🚀"]);
  });

  it("does nothing when the kudos id is missing from the store", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });
    useWorkspaceStore.setState({ kudos: [] });

    const { result } = renderHook(() => useKudosReactions());
    await act(async () => {
      await result.current.addReaction("kud_missing", "🎉");
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("as a visitor", () => {
    it.each([
      ["no AuthProvider", null],
      ["anonymous", { status: "anonymous", user: null }],
      // A session the server hasn't confirmed as the owner yet.
      ["loading", { status: "loading", user: null }],
    ])("keeps the reaction in this browser without a POST (%s)", async (_label, auth) => {
      h.auth = auth;
      const k = freshKudos();
      useWorkspaceStore.setState({ kudos: [k] });

      const { result } = renderHook(() => useKudosReactions());
      await act(async () => {
        await result.current.addReaction(k.id, "🎉");
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      const state = useWorkspaceStore.getState().kudos ?? [];
      expect(state[0].reactions).toEqual([
        expect.objectContaining({ emoji: "🎉", byProfileId: "anon" }),
      ]);
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("is a no-op for a repeat of the visitor's own reaction", async () => {
      h.auth = null;
      const k = freshKudos({
        reactions: [{ emoji: "👏", byProfileId: "anon", at: new Date().toISOString() }],
      });
      useWorkspaceStore.setState({ kudos: [k] });

      const { result } = renderHook(() => useKudosReactions());
      await act(async () => {
        await result.current.addReaction(k.id, "👏");
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().kudos?.[0].reactions?.length).toBe(1);
    });
  });
});
