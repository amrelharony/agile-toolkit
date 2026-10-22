import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

/**
 * The toast stack moves off the bottom while the comic reader is mounted
 * (lib/stores/reader-page-store): its page controls live along the bottom
 * of the viewport. The URL plays no part, so a /comic/ path alone changes
 * nothing.
 */

const h = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname }));

import { AppToaster } from "@/components/layout/app-toaster";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  useReaderPageStore.setState({ title: null });
  h.pathname = "/";
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
    [
      "the reader mounted",
      "Agile at Work",
      "/comic/AbCdEf0123456789_-AbCdEf",
      { y: "top", x: "center" },
    ],
    ["a tool page", null, "/kudos", { y: "bottom", x: "right" }],
    [
      "a /comic/ path but no reader",
      null,
      "/comic/AbCdEf0123456789_-AbCdEf",
      { y: "bottom", x: "right" },
    ],
  ])("with %s stacks toasts at %j", async (_label, title, pathname, expected) => {
    h.pathname = pathname;
    useReaderPageStore.setState({ title });
    render(<AppToaster />);
    act(() => {
      toast("Achievement: First Contact");
    });
    await vi.waitFor(() => expect(stackPosition()).toEqual(expected));
  });
});
