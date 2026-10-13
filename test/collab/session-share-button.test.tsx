import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { SessionShareButton } from "@/components/collab/session-share-button";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

beforeEach(() => {
  h.auth = null;
});

describe("SessionShareButton", () => {
  it("renders the invite button for the verified owner", () => {
    h.auth = { status: "authenticated", user: owner };
    render(<SessionShareButton toolId="planning-poker" entityId="ABC123" />);
    expect(screen.getByRole("button", { name: "Invite squad" })).toBeInTheDocument();
  });

  it.each(["anonymous", "loading", "error"] as const)("renders nothing while %s", (status) => {
    h.auth = { status, user: null };
    const { container } = render(<SessionShareButton toolId="planning-poker" entityId="ABC123" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("survives the owner check settling without a hooks-order crash", () => {
    h.auth = { status: "loading", user: null };
    const { rerender } = render(<SessionShareButton toolId="kudos" entityId="k1" />);
    expect(screen.queryByRole("button")).toBeNull();

    h.auth = { status: "authenticated", user: owner };
    rerender(<SessionShareButton toolId="kudos" entityId="k1" />);
    expect(screen.getByRole("button", { name: "Invite squad" })).toBeInTheDocument();
  });
});
