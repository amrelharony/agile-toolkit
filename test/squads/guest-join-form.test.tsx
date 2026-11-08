import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * /guest/join on a phone: the squad code is a case-sensitive 32-character
 * base64url string, so iOS must not capitalise or correct it, and both
 * fields keep 16 px text and 44 px height on touch at any width (a landscape
 * phone is wider than md; iOS zooms on a focused field under 16 px).
 */

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push, refresh, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));

import { JoinClient } from "@/app/(guest)/guest/join/join-client";

const classes = (el: Element) => el.getAttribute("class")!.split(/\s+/);

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
});

describe("Guest join form", () => {
  it("does not let iOS capitalise or correct the squad code", () => {
    render(<JoinClient initialCode="" nextUrl="/guest" />);
    const code = screen.getByPlaceholderText("Paste your invite code");
    expect(code).toHaveAttribute("autocapitalize", "none");
    expect(code).toHaveAttribute("autocorrect", "off");
    expect(code).toHaveAttribute("spellcheck", "false");
    expect(code).toHaveAttribute("autocomplete", "off");
    expect(code).toHaveAttribute("inputmode", "text");
  });

  it("keeps both fields at the phone size on touch, at any width", () => {
    render(<JoinClient initialCode="" nextUrl="/guest" />);
    for (const field of [
      screen.getByPlaceholderText("Paste your invite code"),
      screen.getByPlaceholderText("How others will see you"),
    ]) {
      const c = classes(field);
      expect(c).toEqual(expect.arrayContaining(["h-11", "text-base"]));
      expect(c).toEqual(expect.arrayContaining(["pointer-fine:md:h-9", "pointer-fine:md:text-sm"]));
      expect(c).not.toContain("md:h-9");
      expect(c).not.toContain("md:text-sm");
    }
  });

  it("centres in the visible viewport, not 100vh", () => {
    const { container } = render(<JoinClient initialCode="" nextUrl="/guest" />);
    const main = container.querySelector("main")!;
    expect(classes(main)).toContain("min-h-screen-dvh");
    expect(classes(main)).not.toContain("min-h-screen");
  });

  it("drops whitespace a paste brought into the code", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const code = "abcdEFGH_ijkl-MNOPqrstUVWX12345z";
    render(<JoinClient initialCode={` ${code.slice(0, 16)}\n ${code.slice(16)} `} nextUrl="/x" />);
    fireEvent.change(screen.getByPlaceholderText("How others will see you"), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join squad" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ code, displayName: "Sam" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/x"));
  });
});
