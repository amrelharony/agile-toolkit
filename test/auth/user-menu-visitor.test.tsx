import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthContextValue } from "@/lib/auth/types";

/**
 * The header account menu on the public site: anyone who isn't the
 * verified owner gets the visitor menu (browser-only work, clear data,
 * owner sign in), and the owner menu no longer links the dead
 * /account/privacy page.
 */

const h = vi.hoisted(() => ({
  auth: { status: "anonymous", user: null, profile: null } as Partial<AuthContextValue>,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => h.auth,
  useAuthOptional: () => h.auth,
}));
const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@/lib/utils/toast", () => ({ toast }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import { UserMenu } from "@/components/auth/user-menu";
import { OWNER_SEEN_KEY } from "@/lib/auth/use-is-owner";
import { OWNER_UNVERIFIED } from "@/lib/auth/owner-check";
import { useOwnerSyncGateStore } from "@/lib/sync/owner-sync-gate";

/** Radix opens the menu on keyboard activation of the trigger. */
function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.keyDown(trigger, { key: "Enter" });
}

beforeAll(() => {
  // Radix's popper measures its anchor with ResizeObserver (absent in jsdom).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  toast.warning.mockClear();
  useOwnerSyncGateStore.setState({ decision: "unchecked", promptOpen: false });
  h.auth = { status: "anonymous", user: null, profile: null };
});

describe("UserMenu for visitors", () => {
  it("offers browser-only actions and an owner sign-in that returns here", () => {
    render(<UserMenu />);
    openMenu("Visitor menu");

    expect(screen.getByText(/Your work stays in this browser/)).toBeInTheDocument();
    expect(screen.getByText("AI settings (bring your own key)")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("My history")).toBeInTheDocument();
    expect(screen.getByText("My insights")).toBeInTheDocument();
    expect(screen.getByText("Clear data on this browser…")).toBeInTheDocument();
    expect(screen.getByText("Owner sign in").closest("a")).toHaveAttribute(
      "href",
      "/auth/sign-in?next=%2Fretro"
    );
  });

  it("says 'Sign in to sync' once the owner has used this browser", () => {
    localStorage.setItem(OWNER_SEEN_KEY, "1");
    render(<UserMenu />);
    openMenu("Visitor menu");
    expect(screen.getByText("Sign in to sync")).toBeInTheDocument();
    expect(screen.queryByText("Owner sign in")).not.toBeInTheDocument();
  });

  it("is shown when auth is disabled, without a sign-in item", () => {
    h.auth = { status: "disabled", user: null, profile: null };
    render(<UserMenu />);
    openMenu("Visitor menu");
    expect(screen.getByText("Clear data on this browser…")).toBeInTheDocument();
    expect(screen.queryByText("Owner sign in")).not.toBeInTheDocument();
  });

  it("asks for confirmation before clearing data", () => {
    render(<UserMenu />);
    openMenu("Visitor menu");
    fireEvent.click(screen.getByText("Clear data on this browser…"));
    expect(screen.getByRole("dialog", { name: "Clear data on this browser?" })).toBeVisible();
  });
});

describe("UserMenu for the owner", () => {
  it("drops the dead privacy link and confirms sign-out with a keep-a-copy option", () => {
    h.auth = {
      status: "authenticated",
      user: { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"],
      profile: null,
    };
    render(<UserMenu />);
    openMenu(/Account menu for/);
    expect(screen.queryByText(/Privacy/)).not.toBeInTheDocument();
    expect(screen.getByText("Access tokens")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Sign out…"));
    expect(screen.getByRole("dialog", { name: "Sign out" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Keep a copy on this browser/ })).not.toBeChecked();
  });
});

describe("UserMenu while the owner check is unanswered", () => {
  it("says the session is signed in and offers to sign it out, not visitor copy", () => {
    h.auth = { status: "error", user: null, profile: null, error: OWNER_UNVERIFIED };
    localStorage.setItem(OWNER_SEEN_KEY, "1");
    render(<UserMenu />);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger).toHaveAttribute("title", "Signed in — checking owner access");
    openMenu("Account menu");

    expect(screen.getByText(/Checking owner access/)).toBeInTheDocument();
    expect(screen.queryByText(/Your work stays in this browser/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sign in to sync")).not.toBeInTheDocument();
    expect(screen.queryByText("Owner sign in")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Sign out…"));
    expect(screen.getByRole("dialog", { name: "Sign out" })).toBeVisible();
    // Sync is paused in this state, so clearing would lose unsynced work.
    expect(screen.getByText(/owner access hasn't been confirmed yet/)).toBeInTheDocument();
  });
});

describe("SignOutDialog", () => {
  const owner = { id: "owner-1", email: "owner@example.com" } as AuthContextValue["user"];

  function openSignOut() {
    render(<UserMenu />);
    openMenu(/Account menu for/);
    fireEvent.click(screen.getByText("Sign out…"));
  }

  it("keeps the browser's data and says so when the session couldn't be removed", async () => {
    const signOut = vi.fn(async () => ({ revoked: false, signedOutHere: false }));
    h.auth = { status: "authenticated", user: owner, profile: null, signOut };
    localStorage.setItem("agile-toolkit:retro-board", "{}");
    openSignOut();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/still signed in on this browser/);
    // Not cleared: a reload would only restore the live session.
    expect(localStorage.getItem("agile-toolkit:retro-board")).toBe("{}");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("clears the data when signed out here, and tells the next page the server wasn't reached", async () => {
    const signOut = vi.fn(async () => ({ revoked: false, signedOutHere: true }));
    h.auth = { status: "authenticated", user: owner, profile: null, signOut };
    localStorage.setItem("agile-toolkit:retro-board", "{}");
    // jsdom can't reload; it reports navigation as not implemented.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    openSignOut();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(localStorage.getItem("agile-toolkit:retro-board")).toBeNull();
    expect(sessionStorage.getItem("agile-toolkit:sign-out-unrevoked")).toBe("1");
    consoleError.mockRestore();

    // The next page (as a visitor) shows the notice once.
    h.auth = { status: "anonymous", user: null, profile: null };
    render(<UserMenu />);
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(toast.warning.mock.calls[0][0]).toMatch(/other devices may still be signed in/);
    expect(sessionStorage.getItem("agile-toolkit:sign-out-unrevoked")).toBeNull();
  });

  it("warns that sync is paused while a merge-or-discard answer is outstanding", () => {
    h.auth = { status: "authenticated", user: owner, profile: null };
    useOwnerSyncGateStore.setState({ decision: "pending", promptOpen: false });
    openSignOut();
    expect(screen.getByText(/Cloud sync is paused until you choose/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Your work is saved in your cloud workspace/)
    ).not.toBeInTheDocument();
  });
});
