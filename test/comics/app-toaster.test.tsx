import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toast } from "sonner";

/**
 * Where the toast stack sits. Bottom-centre everywhere but /comics: on phones
 * just above Amr's band (which already includes the home indicator), 24 px up
 * on larger screens, so it clears every corner Amr can be dragged to. Under
 * /comics it moves to the top, below the header and the notch, where it can't
 * sit over panels and story controls and swallow taps.
 */

const h = vi.hoisted(() => ({ pathname: "/", phone: false }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import {
  AppToaster,
  COMICS_OFFSET,
  DESKTOP_OFFSET,
  PHONE_OFFSET,
  toasterLayout,
} from "@/components/layout/app-toaster";

const realMatchMedia = window.matchMedia;

function stubViewport(phone: boolean) {
  h.phone = phone;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width: 639px") ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  window.matchMedia = realMatchMedia;
});

function stack(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-sonner-toaster]");
}

function stackPosition(): { y: string | null; x: string | null } {
  const list = stack();
  return {
    y: list?.getAttribute("data-y-position") ?? null,
    x: list?.getAttribute("data-x-position") ?? null,
  };
}

describe("AppToaster", () => {
  it.each([
    ["/comics", { y: "top", x: "center" }],
    // A rewritten story page is prerendered at its internal path.
    ["/comics/ep/27", { y: "top", x: "center" }],
    ["/kudos", { y: "bottom", x: "center" }],
  ])("on %s stacks toasts at %j", async (pathname, expected) => {
    stubViewport(false);
    h.pathname = pathname;
    render(<AppToaster />);
    act(() => {
      toast("Achievement: First Contact");
    });
    await vi.waitFor(() => expect(stackPosition()).toEqual(expected));
  });

  it("on a phone the stack clears Amr's band and the home indicator", async () => {
    stubViewport(true);
    h.pathname = "/kudos";
    render(<AppToaster />);
    act(() => {
      toast("Saved");
    });
    await vi.waitFor(() => expect(stack()).not.toBeNull());
    const style = stack()!.style;
    // Both the desktop and sonner's own ≤600 px offsets get the same value.
    for (const prefix of ["--offset", "--mobile-offset"]) {
      expect(style.getPropertyValue(`${prefix}-bottom`)).toContain("var(--amr-band-bottom");
      expect(style.getPropertyValue(`${prefix}-bottom`)).toContain("safe-area-inset-bottom");
      expect(style.getPropertyValue(`${prefix}-left`)).toContain("safe-area-inset-left");
    }
  });
});

describe("toasterLayout", () => {
  it("phones: bottom-centre above Amr, 2 visible, swipe left/right/down", () => {
    const l = toasterLayout("/", true);
    expect(l).toMatchObject({
      position: "bottom-center",
      offset: PHONE_OFFSET,
      mobileOffset: PHONE_OFFSET,
      visibleToasts: 2,
    });
    expect(l.swipeDirections).toEqual(expect.arrayContaining(["left", "right", "bottom"]));
    expect(PHONE_OFFSET).toMatchObject({
      bottom: "calc(8px + var(--amr-band-bottom, env(safe-area-inset-bottom, 0px)))",
    });
  });

  it("larger screens: bottom-centre 24 px up, 3 visible", () => {
    const l = toasterLayout("/retro", false);
    expect(l).toMatchObject({
      position: "bottom-center",
      offset: DESKTOP_OFFSET,
      mobileOffset: DESKTOP_OFFSET,
      visibleToasts: 3,
    });
    expect(DESKTOP_OFFSET).toMatchObject({ bottom: "24px" });
  });

  it("/comics: top-centre under the header, notch and top band; swipe up", () => {
    const l = toasterLayout("/comics/ep/3", true);
    expect(l).toMatchObject({ position: "top-center", offset: COMICS_OFFSET });
    expect(l.swipeDirections).toContain("top");
    const top = (COMICS_OFFSET as { top: string }).top;
    expect(top).toContain("var(--header-h");
    expect(top).toContain("var(--amr-band-top");
    expect(top).toContain("safe-area-inset-top");
  });
});

describe("toaster stacking (globals.css + tailwind token)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const tw = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");

  it("uses the toast z-index token (990), above the header and below modals", () => {
    expect(tw).toMatch(/toast:\s*"990"/);
    expect(css).toMatch(/\[data-sonner-toaster\]\s*\{\s*z-index:\s*theme\("zIndex\.toast"\)/);
  });

  it("raises toasts over an open dialog, hand-built modals and the z-[9999] card detail", () => {
    expect(css).toMatch(
      /body:has\(\[role="dialog"\]\[data-state="open"\][^)]*\)\)\s*\[data-sonner-toaster\][^{]*\{\s*z-index:\s*10000/
    );
    expect(css).toContain('body:has([role="dialog"][aria-modal="true"]) [data-sonner-toaster]');
  });

  it("keeps the intro hide rule and gives the close button a 44 px touch target", () => {
    expect(css).toContain("html[data-intro] [data-sonner-toaster]");
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\[data-close-button\]::after[\s\S]*inset:\s*-12px/
    );
  });
});
