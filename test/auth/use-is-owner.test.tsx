import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

// The hooks read auth only through useAuthOptional(), so the usual
// auth-provider stub drives them without mounting AuthProvider.
vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { OWNER_SEEN_KEY, useIsOwner, useOwnerState } from "@/lib/auth/use-is-owner";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";

const user = { id: "u1", email: "owner@example.com" } as AuthContextValue["user"];

beforeEach(() => {
  h.auth = null;
});

describe("useIsOwner", () => {
  it("is false with no AuthProvider (guest tree)", () => {
    const { result } = renderHook(() => useIsOwner());
    expect(result.current).toBe(false);
  });

  it("is true only for an authenticated status with a user", () => {
    h.auth = { status: "authenticated", user };
    expect(renderHook(() => useIsOwner()).result.current).toBe(true);

    h.auth = { status: "authenticated", user: null };
    expect(renderHook(() => useIsOwner()).result.current).toBe(false);
  });

  it.each(["loading", "anonymous", "error", "disabled"] as const)("is false while %s", (status) => {
    // Even with a user attached (e.g. the BUG-A6 sign-out error state).
    h.auth = { status, user };
    expect(renderHook(() => useIsOwner()).result.current).toBe(false);
  });
});

describe("useOwnerState", () => {
  it("is settled and not owner with no AuthProvider", () => {
    const { result } = renderHook(() => useOwnerState());
    expect(result.current).toEqual({
      isOwner: false,
      settled: true,
      unverified: false,
      visitor: true,
    });
  });

  it("is unsettled while loading", () => {
    h.auth = { status: "loading", user: null };
    expect(renderHook(() => useOwnerState()).result.current).toEqual({
      isOwner: false,
      settled: false,
      unverified: false,
      visitor: false,
    });
  });

  it("reports the verified owner", () => {
    h.auth = { status: "authenticated", user };
    expect(renderHook(() => useOwnerState()).result.current).toEqual({
      isOwner: true,
      settled: true,
      unverified: false,
      visitor: false,
    });
  });

  it.each(["anonymous", "error", "disabled"] as const)("is a settled visitor when %s", (status) => {
    h.auth = { status, user: null };
    expect(renderHook(() => useOwnerState()).result.current).toEqual({
      isOwner: false,
      settled: true,
      unverified: false,
      visitor: true,
    });
  });

  it("is neither owner nor visitor while an owner check is unanswered", () => {
    h.auth = { status: "error", user: null, error: OWNER_UNVERIFIED };
    expect(renderHook(() => useOwnerState()).result.current).toEqual({
      isOwner: false,
      settled: true,
      unverified: true,
      visitor: false,
    });
  });

  it("keeps the same object while nothing changes", () => {
    h.auth = { status: "authenticated", user };
    const { result, rerender } = renderHook(() => useOwnerState());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

it("re-exports the owner-seen storage key", () => {
  expect(OWNER_SEEN_KEY).toBe("agile-toolkit:owner-seen");
});
