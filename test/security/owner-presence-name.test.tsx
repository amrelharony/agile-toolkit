/**
 * The owner's presence identity goes to everyone in a Realtime room. It must
 * never carry the owner's email address, which it used to fall back to when
 * there was no display name.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));

import { OwnerPresenceProvider } from "@/components/layout/owner-presence-provider";
import { usePresenceIdentityOverride } from "@/lib/realtime/presence-identity";

function Probe() {
  const id = usePresenceIdentityOverride();
  return <p data-testid="who">{id ? `${id.id}|${id.name}` : "none"}</p>;
}

function whoFor(auth: unknown): string {
  h.auth = auth;
  const { unmount } = render(
    <OwnerPresenceProvider>
      <Probe />
    </OwnerPresenceProvider>
  );
  const text = screen.getByTestId("who").textContent ?? "";
  unmount();
  return text;
}

const user = (meta: Record<string, unknown> = {}) => ({
  id: "owner-1",
  email: "amr@example.com",
  user_metadata: meta,
});

describe("owner presence name", () => {
  it("uses the display name, then the account's full name", () => {
    expect(
      whoFor({ status: "authenticated", user: user(), profile: { display_name: "Amr" } })
    ).toBe("owner-1|Amr");
    expect(
      whoFor({ status: "authenticated", user: user({ full_name: "Amr E." }), profile: null })
    ).toBe("owner-1|Amr E.");
  });

  it("falls back to 'Owner', never the email address", () => {
    const who = whoFor({ status: "authenticated", user: user(), profile: { display_name: "" } });
    expect(who).toBe("owner-1|Owner");
    expect(who).not.toContain("@");
  });

  it("has no identity while signed out", () => {
    expect(whoFor({ status: "anonymous", user: null })).toBe("none");
  });
});
