import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ pathname: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import { signInHref, useSignInHref } from "@/lib/auth/sign-in-href";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

/**
 * "Sign in" links come back to the current page — except from a mounted
 * reader page (the private comic), whose token must never ride through the
 * OAuth round-trip. The token below is a dummy, not the real link.
 */

const DUMMY_COMIC_PATH = "/comic/AbCdEf0123456789_-AbCdEf";

beforeEach(() => {
  h.pathname = "/";
  useReaderPageStore.setState({ title: null });
});

describe("signInHref", () => {
  it.each([
    ["/kudos", "/auth/sign-in?next=%2Fkudos"],
    ["/settings/squads", "/auth/sign-in?next=%2Fsettings%2Fsquads"],
    ["/", "/auth/sign-in?next=%2F"],
    ["", "/auth/sign-in?next=%2F"],
    [null, "/auth/sign-in?next=%2F"],
    [undefined, "/auth/sign-in?next=%2F"],
  ])("returns to %j", (pathname, href) => {
    expect(signInHref(pathname)).toBe(href);
  });
});

describe("useSignInHref", () => {
  it("returns to the current page", () => {
    h.pathname = "/kudos";
    const { result } = renderHook(() => useSignInHref());
    expect(result.current).toBe("/auth/sign-in?next=%2Fkudos");
  });

  it("never carries a mounted reader page's path along", () => {
    h.pathname = DUMMY_COMIC_PATH;
    useReaderPageStore.setState({ title: "Agile at Work" });
    const { result } = renderHook(() => useSignInHref());
    expect(result.current).toBe("/auth/sign-in?next=%2F");
    expect(result.current).not.toContain("AbCdEf0123456789");
  });

  it("follows the reader as it mounts and unmounts", () => {
    h.pathname = "/kudos";
    const { result } = renderHook(() => useSignInHref());
    expect(result.current).toBe("/auth/sign-in?next=%2Fkudos");

    act(() => useReaderPageStore.getState().enter("A reader page"));
    expect(result.current).toBe("/auth/sign-in?next=%2F");

    act(() => useReaderPageStore.getState().leave());
    expect(result.current).toBe("/auth/sign-in?next=%2Fkudos");
  });
});
