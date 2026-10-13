import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

/**
 * The toast stack moves off the bottom on the comic reader, whose page
 * controls live along the bottom of the viewport.
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
    ["/agile-at-work", { y: "top", x: "center" }],
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
