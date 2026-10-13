import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AuthContextValue } from "@/lib/auth/types";
import { GuestProfileProvider, type GuestProfile } from "@/lib/auth/guest-profile-provider";

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { useRealtimeAllowed } from "@/lib/realtime/use-realtime-allowed";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

const guest: GuestProfile = {
  id: "guest-1",
  displayName: "Sam",
  color: "#34d399",
  squadId: "squad-1",
  squadOwnerId: "owner-1",
};

function guestWrapper({ children }: { children: ReactNode }) {
  return <GuestProfileProvider profile={guest}>{children}</GuestProfileProvider>;
}

beforeEach(() => {
  h.auth = null;
});

describe("useRealtimeAllowed", () => {
  it("allows the verified owner", () => {
    h.auth = { status: "authenticated", user: owner };
    expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(true);
  });

  it("allows an invited guest (guest tree: no AuthProvider)", () => {
    const { result } = renderHook(() => useRealtimeAllowed(), { wrapper: guestWrapper });
    expect(result.current).toBe(true);
  });

  it("refuses a public visitor with neither", () => {
    h.auth = { status: "anonymous", user: null };
    expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(false);
  });

  it("refuses when no provider is mounted at all", () => {
    expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(false);
  });

  it.each(["loading", "error", "disabled"] as const)("refuses while auth is %s", (status) => {
    h.auth = { status, user: null };
    expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(false);
  });

  it("treats a guest provider with no profile as a visitor", () => {
    const { result } = renderHook(() => useRealtimeAllowed(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <GuestProfileProvider profile={null}>{children}</GuestProfileProvider>
      ),
    });
    expect(result.current).toBe(false);
  });
});
