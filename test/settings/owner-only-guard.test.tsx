import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

const h = vi.hoisted(() => ({ auth: null as Partial<AuthContextValue> | null }));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
}));

import { AccessTokensClient } from "@/app/settings/access-tokens/access-tokens-client";
import { SquadsClient } from "@/app/settings/squads/squads-client";

const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

const pages = [
  {
    name: "access tokens",
    Client: AccessTokensClient,
    api: "/api/access-tokens",
    path: "/settings/access-tokens",
    body: { tokens: [] },
  },
  {
    name: "squads",
    Client: SquadsClient,
    api: "/api/squads",
    path: "/settings/squads",
    body: { squads: [] },
  },
];

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.auth = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(pages)("$name page guard", ({ Client, api, path, body }) => {
  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("shows a settled visitor the owner-only notice without calling the API", () => {
    h.auth = { status: "anonymous", user: null };
    render(<Client />);

    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Owner sign in" })).toHaveAttribute(
      "href",
      `/auth/sign-in?next=${encodeURIComponent(path)}`
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not fetch or show the notice while auth is still loading", () => {
    h.auth = { status: "loading", user: null };
    render(<Client />);

    expect(screen.queryByText("Owner only")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads for the verified owner", async () => {
    h.auth = { status: "authenticated", user: owner };
    render(<Client />);

    expect(screen.queryByText("Owner only")).toBeNull();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(api));
  });

  it("starts loading once the owner check settles", async () => {
    h.auth = { status: "loading", user: null };
    const { rerender } = render(<Client />);
    expect(fetchSpy).not.toHaveBeenCalled();

    h.auth = { status: "authenticated", user: owner };
    rerender(<Client />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(api));
  });
});

describe("owner-only page metadata", () => {
  it("keeps both pages out of search indexes", async () => {
    const tokens = await import("@/app/settings/access-tokens/page");
    const squads = await import("@/app/settings/squads/page");
    for (const mod of [tokens, squads]) {
      expect(mod.metadata.robots).toEqual({ index: false, follow: false });
    }
  });
});
