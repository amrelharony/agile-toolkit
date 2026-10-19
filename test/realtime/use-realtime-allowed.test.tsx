import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("useRealtimeAllowed({ visitorRoom })", () => {
  it("lets a visitor into a room they opted into when the flag is on", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    h.auth = { status: "anonymous", user: null };
    expect(renderHook(() => useRealtimeAllowed({ visitorRoom: true })).result.current).toBe(true);
  });

  it.each(["", "0", "true", "yes"])("refuses the visitor when the flag is %j", (flag) => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", flag);
    h.auth = { status: "anonymous", user: null };
    expect(renderHook(() => useRealtimeAllowed({ visitorRoom: true })).result.current).toBe(false);
  });

  it("refuses the visitor when the flag is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", undefined);
    h.auth = { status: "anonymous", user: null };
    expect(renderHook(() => useRealtimeAllowed({ visitorRoom: true })).result.current).toBe(false);
  });

  it("refuses a visitor who did not opt in, even with the flag on", () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "1");
    h.auth = { status: "anonymous", user: null };
    expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(false);
    expect(renderHook(() => useRealtimeAllowed({ visitorRoom: false })).result.current).toBe(false);
  });

  it("leaves the owner and an invited guest allowed whatever the flag says", () => {
    for (const flag of ["1", ""]) {
      vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", flag);
      h.auth = { status: "authenticated", user: owner };
      expect(renderHook(() => useRealtimeAllowed()).result.current).toBe(true);
      expect(renderHook(() => useRealtimeAllowed({ visitorRoom: true })).result.current).toBe(true);
      h.auth = null;
      expect(
        renderHook(() => useRealtimeAllowed({ visitorRoom: false }), { wrapper: guestWrapper })
          .result.current
      ).toBe(true);
    }
  });
});
