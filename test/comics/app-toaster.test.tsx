import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

/**
 * The toast stack moves off the bottom under /comics, where it would sit over
 * panels and story controls and swallow taps.
 */

const h = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import { AppToaster } from "@/components/layout/app-toaster";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

function stackPosition(): { y: string | null; x: string | null } {
  const list = document.querySelector("[data-sonner-toaster]");
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
    ["/kudos", { y: "bottom", x: "right" }],
  ])("on %s stacks toasts at %j", async (pathname, expected) => {
    h.pathname = pathname;
    render(<AppToaster />);
    act(() => {
      toast("Achievement: First Contact");
    });
    await vi.waitFor(() => expect(stackPosition()).toEqual(expected));
  });
});
