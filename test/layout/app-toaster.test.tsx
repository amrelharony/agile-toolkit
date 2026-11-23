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
  SIDE_TOAST_STYLE,
  toasterLayout,
} from "@/components/layout/app-toaster";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { readVisibleArea } from "@/lib/layout/use-visible-area";
import {
  BUTTON_SIDE,
  SIDE_TOAST_MIN_W,
  TOAST_GAP,
  compactSheetToastTop,
  sheetPos,
  sidePos,
  sideToastRoom,
  visibleBox,
  type AmrCorner,
} from "@/components/agent/mascot/amr-geometry";
import { AMR_TOAST_ROOM_VAR, AMR_TOAST_TOP_VAR } from "@/lib/layout/amr-sheet";

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
    // From the notch down, unless the compact sheet has published its own top.
    expect(SHEET_OFFSET).toMatchObject({
      top: `var(${AMR_TOAST_TOP_VAR}, max(8px, env(safe-area-inset-top, 0px)))`,
    });
    expect(l.style).toBeUndefined();
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

describe("in the compact sheet: under its one header row", () => {
  // The tallest one-row toast in the sheet (as above): a 44 px Undo between
  // 5 px of padding and sonner's 1 px border.
  const TOAST_ROW = 44 + 2 * 5 + 2;
  /** The CSS the panel publishes, worked out at 16 px text, its 2 px line and 1.5 px rule. */
  function evaluate(css: string): number {
    const terms = /^calc\((.*)\)$/.exec(css)![1].split(" + ");
    const value: Record<string, number> = {
      "var(--panel-w, 2px)": 2,
      "var(--line-w, 1px)": 1.5,
    };
    return terms.reduce((sum, t) => {
      if (t in value) return sum + value[t];
      const rem = /^([\d.]+)rem$/.exec(t);
      if (rem) return sum + Number(rem[1]) * 16;
      const px = /^([\d.]+)px$/.exec(t);
      if (!px) throw new Error(`can't evaluate ${t}`);
      return sum + Number(px[1]);
    }, 0);
  }

  it.each([
    [0, 0],
    [34, 0],
    [47, 0],
    [47, 180],
    [0, 120],
  ])("with a %i px top inset and the page panned %i px down to the field", (inset, pan) => {
    const kb = 336;
    const vh = 812 - pan - kb;
    const area = readVisibleArea({
      clientHeight: 812,
      viewport: { height: vh, offsetTop: pan, scale: 1 },
      headerBottom: 56 + inset,
      safeTop: inset,
      safeBottom: 34,
    });
    expect(area.keyboardUp).toBe(true);
    const sheet = sheetPos(visibleBox({ width: 375, height: 812 }, area), {
      compact: true,
      viewTop: area.viewTop,
    });
    const toastTop = evaluate(compactSheetToastTop(sheet.top));
    // Below the sheet's line, frame, one 44 px header row and its rule: never on Close.
    expect(toastTop).toBeGreaterThanOrEqual(sheet.top + 2 + 6 + 44 + 1.5);
    expect(toastTop - (sheet.top + 2 + 6 + 44 + 1.5)).toBe(TOAST_GAP);
    // Inside what can be seen, above the keyboard, the pan and notch included.
    expect(toastTop).toBeGreaterThanOrEqual(area.viewTop);
    expect(toastTop + TOAST_ROW).toBeLessThanOrEqual(pan + vh);
  });

  it("is read from the published top, the same props as the sheet otherwise", () => {
    const l = toasterLayout("/retro", true, { layout: "sheet", side: "right", edge: "bottom" });
    expect(String(l.offset && (l.offset as { top?: string }).top)).toContain(AMR_TOAST_TOP_VAR);
    expect(l.visibleToasts).toBe(1);
  });
});

describe("beside the side panel: the strip it leaves, or held", () => {
  const TOAST_W = 356;
  for (const s of [
    { w: 568, h: 320, phone: true, fits: false },
    { w: 667, h: 375, phone: false, fits: false },
    { w: 812, h: 375, phone: false, fits: true },
    { w: 844, h: 390, phone: false, fits: true },
  ]) {
    for (const corner of ["bottomRight", "topLeft"] as AmrCorner[]) {
      it(`${s.w}x${s.h}, Amr ${corner}: ${s.fits ? "a toast clears the panel's inner edge" : "too little room: held"}`, () => {
        const area = readVisibleArea({
          clientHeight: s.h,
          viewport: { height: s.h, offsetTop: 0, scale: 1 },
          headerBottom: 56,
        });
        const box = visibleBox({ width: s.w, height: s.h }, area);
        const pos = sidePos(
          corner,
          box,
          { phone: s.phone, figure: true },
          {
            compact: true,
            viewTop: area.viewTop,
          }
        );
        const room = sideToastRoom(s.w, box, pos);
        expect(room >= SIDE_TOAST_MIN_W).toBe(s.fits);
        if (!s.fits) return;
        // The toast, in the far corner at the toaster's 8 px gutter, as wide
        // as SIDE_TOAST_STYLE lets it be...
        const width = Math.min(TOAST_W, room);
        const inline = pos.left ?? pos.right!;
        const panelInner = inline + pos.width; // from Amr's side
        const toastInner = s.w - BUTTON_SIDE - width; // from Amr's side too
        // ...stops TOAST_GAP short of the panel.
        expect(toastInner - panelInner).toBeGreaterThanOrEqual(TOAST_GAP);
      });
    }
  }

  it("caps the toast's width at the room the panel publishes, sonner's width without it", () => {
    const l = toasterLayout("/retro", false, { layout: "side", side: "right", edge: "bottom" });
    expect(l.style).toBe(SIDE_TOAST_STYLE);
    expect((SIDE_TOAST_STYLE as Record<string, string>)["--width"]).toBe(
      `min(${TOAST_W}px, var(${AMR_TOAST_ROOM_VAR}, ${TOAST_W}px))`
    );
    expect(
      toasterLayout("/retro", false, { layout: "float", side: "right", edge: "bottom" }).style
    ).toBeUndefined();
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

  it("keeps to the strip beside the side panel, and lets go of it as the panel closes", async () => {
    render(<AppToaster />);
    act(() => {
      toast("Saved");
    });
    const list = () => document.querySelector<HTMLElement>("[data-sonner-toaster]");
    await vi.waitFor(() => expect(list()).not.toBeNull());
    expect(list()!.style.getPropertyValue("--width")).toBe(`${356}px`);
    act(() => useMascotStore.getState().setPanel("side"));
    await vi.waitFor(() =>
      expect(list()!.style.getPropertyValue("--width")).toContain(AMR_TOAST_ROOM_VAR)
    );
    act(() => useMascotStore.getState().setPanel(null));
    await vi.waitFor(() => expect(list()!.style.getPropertyValue("--width")).toBe("356px"));
  });
});
