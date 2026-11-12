import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toast } from "sonner";

/**
 * The toast stack while Amr's chat panel is open (design §1.3 item 9,
 * "Toasts"; audit critic1-9). In the phone's full-height sheet it goes over
 * the site header, one toast at a time, and ends above the sheet's own header
 * whatever the notch; with the floating card or the side panel it takes the
 * corner across from Amr. Closed, it is where it always was
 * (test/comics/app-toaster.test.tsx).
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));

import {
  AppToaster,
  COMICS_OFFSET,
  DESKTOP_OFFSET,
  PHONE_OFFSET,
  SHEET_OFFSET,
  toasterLayout,
} from "@/components/layout/app-toaster";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { readVisibleArea } from "@/lib/layout/use-visible-area";
import { sheetPos, visibleBox } from "@/components/agent/mascot/amr-geometry";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  useMascotStore.getState().reset();
});

describe("toasterLayout in Amr's phone sheet", () => {
  it("goes to the top, over the site header, one at a time; swipe up or aside", () => {
    const l = toasterLayout("/retro", true, { layout: "sheet", side: "right", edge: "bottom" });
    expect(l).toMatchObject({
      position: "top-center",
      offset: SHEET_OFFSET,
      mobileOffset: SHEET_OFFSET,
      visibleToasts: 1,
    });
    expect(l.swipeDirections).toEqual(["top", "left", "right"]);
    expect(SHEET_OFFSET).toMatchObject({ top: "max(8px, env(safe-area-inset-top, 0px))" });
  });

  it("wins over /comics' place under the header, which the sheet covers", () => {
    const l = toasterLayout("/comics/ep/3", true, { layout: "sheet", side: "left", edge: "top" });
    expect(l).toMatchObject({ position: "top-center", offset: SHEET_OFFSET, visibleToasts: 1 });
  });

  describe("never reaches the sheet's header", () => {
    // The tallest one-row toast in the sheet: a 44 px Undo button on touch
    // (ui/sonner's TOUCH_BUTTON) between the trimmed padding, and sonner's
    // 1 px border top and bottom.
    const css = read("src/app/globals.css");
    const rule = css.match(
      /html\[data-amr-sheet\] \[data-sonner-toast\]\[data-styled="true"\]\s*\{([^}]*)\}/
    );
    const padding = Number(rule?.[1].match(/padding-block:\s*(\d+)px/)?.[1]);
    const TOAST_ROW = 44 + 2 * padding + 2;
    const HEADER_ROW = 56;

    it("trims the toast's padding to fit the header's row around a 44 px Undo", () => {
      expect(rule).not.toBeNull();
      expect(read("src/components/ui/sonner.tsx")).toContain("pointer-coarse:min-h-11");
      expect(css).toMatch(/--header-h:\s*calc\(3\.5rem \+ env\(safe-area-inset-top, 0px\)\)/);
      expect(TOAST_ROW).toBeLessThanOrEqual(HEADER_ROW);
    });

    it.each([0, 20, 34, 47, 59])("with a %i px top inset", (inset) => {
      // Where the sheet starts: under the header (its row plus the inset), as
      // the panel works it out from the visible area at 375×812.
      const area = readVisibleArea({
        clientHeight: 812,
        viewport: { height: 812, offsetTop: 0, scale: 1 },
        headerBottom: HEADER_ROW + inset,
        safeTop: inset,
        safeBottom: 34,
      });
      const sheetTop = sheetPos(visibleBox({ width: 375, height: 812 }, area), {
        compact: false,
        viewTop: area.viewTop,
      }).top;
      // SHEET_OFFSET's top: max(8px, the inset).
      const toastTop = Math.max(8, inset);
      expect(toastTop + TOAST_ROW).toBeLessThanOrEqual(sheetTop);
      // And it doesn't sit in the notch.
      expect(toastTop).toBeGreaterThanOrEqual(inset);
    });
  });
});

describe("toasterLayout beside the floating card or the side panel", () => {
  it.each([
    // layout, Amr's side and edge, phone → position, offset
    ["float", "right", "bottom", false, "top-left", COMICS_OFFSET],
    ["float", "left", "bottom", false, "top-right", COMICS_OFFSET],
    ["float", "right", "top", false, "bottom-left", DESKTOP_OFFSET],
    ["float", "left", "top", false, "bottom-right", DESKTOP_OFFSET],
    ["side", "right", "bottom", true, "top-left", COMICS_OFFSET],
    ["side", "left", "top", true, "bottom-right", PHONE_OFFSET],
  ] as const)(
    "%s with Amr %s-%s (phone %s): the corner across, %s",
    (layout, side, edge, phone, position, offset) => {
      const l = toasterLayout("/retro", phone, { layout, side, edge });
      expect(l).toMatchObject({ position, offset, mobileOffset: offset });
      const [y, x] = position.split("-");
      expect(l.swipeDirections).toEqual([y, x]);
      expect(l.visibleToasts).toBe(phone ? 2 : 3);
    }
  );

  it("closed, nothing changes", () => {
    expect(toasterLayout("/retro", false, null)).toEqual(toasterLayout("/retro", false));
    expect(toasterLayout("/retro", false)).toMatchObject({ position: "bottom-center" });
  });
});

describe("AppToaster follows Amr's panel", () => {
  function stackPosition() {
    const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    return {
      y: list?.getAttribute("data-y-position") ?? null,
      x: list?.getAttribute("data-x-position") ?? null,
    };
  }

  it("moves as the panel opens in the sheet or floats, and back as it closes", async () => {
    render(<AppToaster />);
    act(() => {
      toast("Saved");
    });
    await vi.waitFor(() => expect(stackPosition()).toEqual({ y: "bottom", x: "center" }));

    act(() => useMascotStore.getState().setPanel("sheet"));
    await vi.waitFor(() => expect(stackPosition()).toEqual({ y: "top", x: "center" }));

    act(() => {
      useMascotStore.getState().setPlacement({ side: "left", edge: "top" }, 0);
      useMascotStore.getState().setPanel("float");
    });
    await vi.waitFor(() => expect(stackPosition()).toEqual({ y: "bottom", x: "right" }));

    act(() => useMascotStore.getState().setPanel(null));
    await vi.waitFor(() => expect(stackPosition()).toEqual({ y: "bottom", x: "center" }));
  });
});
