import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CSSProperties } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Where Amr stands (mobile audit, 8 November 2026):
 * - Data Saver visitors got only the round launcher for the whole visit; he now
 *   arrives on their first interaction, and his space is kept for him all along.
 * - He keeps clear of a landscape iPhone's notch and home indicator.
 * - On touch screens he steps aside when his figure sits on a control
 *   (the helper itself is covered in mascot-nudge.test.ts).
 * - His panel is his balloon (the chat revamp): a tail on the edge facing his
 *   figure, none while he's carried or the launcher stands in for him; its
 *   size comes from PANEL_SIZE, and Enlarge (md and up) is remembered.
 * - On phones (chat revamp PR 8): upright, the panel is a full-height sheet in
 *   the visible box and he docks in its bottom corner, his phone size, still
 *   carried; a short screen gets the panel down one side beside him; the page
 *   behind the sheet holds still; he never leaves the page while a field has
 *   the keyboard.
 * - Beside the app's rail (end-to-end check after PR 12): from md the rail
 *   (layout/sidebar) painted over him and his panel in a left corner. Now
 *   everything on his left counts from its right edge (--app-rail), which
 *   takes the left safe area's place; his right corners are as they were.
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
// The sprite stand-in; with `sprite.fail` set its sheet can't load (the launcher stays).
const sprite = vi.hoisted(() => ({ fail: false }));
vi.mock("@/components/agent/mascot/mascot-sprite", async () => {
  const { useEffect } = await import("react");
  return {
    default: function SpriteStandIn({
      onLoadError,
      width,
      height,
    }: {
      onLoadError?: () => void;
      width?: number;
      height?: number;
    }) {
      useEffect(() => {
        if (sprite.fail) onLoadError?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      // The size he is drawn at, for the dock's "never scaled".
      return <div data-testid="mascot-sprite" data-w={width} data-h={height} />;
    },
  };
});

import {
  FIGURE_RETRY_MS,
  MascotAssistant,
  PANEL_SIZE_KEY,
  panelPos,
  type Corner,
} from "@/components/agent/mascot/mascot-assistant";
import {
  BUTTON_SIDE,
  COMPACT_TOP,
  DOCK_GAP,
  DOCK_INSET,
  FEET_TRIM,
  HIT_SIDE,
  LAUNCHER_PLATE,
  MASCOT_BOX,
  MASCOT_BOX_PHONE,
  PANEL_GAP,
  PANEL_SIDE,
  PANEL_SIZE,
  SIDE_PANEL_MAX_W,
  SIDE_TOAST_MIN_W,
  TOAST_GAP,
  dockInsets,
  type AmrCorner,
  type PanelSizeName,
} from "@/components/agent/mascot/amr-geometry";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "@/components/agent/mascot/engine/figure-metrics";
import { DOCK_END_FULL } from "@/components/agent/mascot/panel-context";
import {
  VISITOR_AI_CONSENT_KEY,
  VISITOR_AI_CONSENT_VERSION,
} from "@/components/agent/mascot/visitor-ai-consent";
import { VISIBLE_GAP } from "@/lib/layout/use-visible-area";
import { APP_RAIL_EVENT, APP_RAIL_VAR } from "@/lib/layout/amr-sheet";
import { momentChipPosition } from "@/components/notify/moment-chip";
import { useAgentStore } from "@/lib/agent/store";
import { useBubbleStore } from "@/lib/agent/mascot/bubble";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { EVENT_SCENES } from "@/components/agent/mascot/engine/scenes";

const HEADER_H = 56;

/**
 * jsdom has no layout, so the panel's CSS offsets are worked out here for a
 * given screen: 100% and vh against its height, the header at 56 px, the home
 * indicator's inset as given and the other safe areas at 0.
 */
function cssPx(expr: string, screenH: number, insetBottom = 0): number {
  const js = expr
    .replace(/env\(\s*safe-area-inset-bottom[^)]*\)/g, `${insetBottom}px`)
    .replace(/env\([^)]*\)/g, "0px")
    .replace(/var\(--header-h, 56px\)/g, `${HEADER_H}px`)
    .replace(/100%/g, `${screenH}px`)
    .replace(/(\d+(?:\.\d+)?)vh/g, (_, n: string) => `${(Number(n) * screenH) / 100}px`)
    .replace(/(\d+(?:\.\d+)?(?:e-?\d+)?)px/g, "$1")
    .replace(/calc\(/g, "(")
    .replace(/min\(/g, "Math.min(")
    .replace(/max\(/g, "Math.max(");
  if (!/^[\d\s.e+\-*/(),]*$/.test(js.replace(/Math\.m(in|ax)\(/g, "(")))
    throw new Error(`can't evaluate: ${expr}`);
  return Number(new Function(`return ${js};`)());
}

/**
 * A side offset or a width as the browser works it out on a screen `width`
 * wide: var(--app-rail, …) is the rail's right edge where the sidebar keeps one
 * (`rail`), else its fallback; the side safe areas as given; 100% and vw the
 * screen's width (a fixed box's containing block).
 */
function inlinePx(
  expr: string,
  s: { width: number; rail?: number; left?: number; right?: number }
): number {
  const js = expr
    .replace(/var\(--app-rail,\s*(env\([^)]*\)|[^()]*)\)/g, (_, fallback: string) =>
      s.rail === undefined ? fallback : `${s.rail}px`
    )
    .replace(/env\(\s*safe-area-inset-left[^)]*\)/g, `${s.left ?? 0}px`)
    .replace(/env\(\s*safe-area-inset-right[^)]*\)/g, `${s.right ?? 0}px`)
    .replace(/100%/g, `${s.width}px`)
    .replace(/(\d+(?:\.\d+)?)vw/g, (_, n: string) => `${(Number(n) * s.width) / 100}px`)
    .replace(/(\d+(?:\.\d+)?(?:e-?\d+)?)px/g, "$1")
    .replace(/calc\(/g, "(")
    .replace(/min\(/g, "Math.min(")
    .replace(/max\(/g, "Math.max(");
  if (!/^[\d\s.e+\-*/(),]*$/.test(js.replace(/Math\.m(in|ax)\(/g, "(")))
    throw new Error(`can't evaluate: ${expr}`);
  return Number(new Function(`return ${js};`)());
}

/**
 * What a `var(--name, fallback)` style holds before usePanelViewport's first
 * reading writes `--name`: its fallback.
 */
function beforeReading(expr: string, name: string): string {
  const head = `var(${name},`;
  if (!expr.startsWith(head) || !expr.endsWith(")"))
    throw new Error(`no ${name} fallback: ${expr}`);
  return expr.slice(head.length, -1).trim();
}

/**
 * His offset on the right as it always was, `px` past the notch's inset, read
 * back the way jsdom reads a style it has set (it garbles env()).
 */
function rightAsItWas(px: number): string {
  const el = document.createElement("div");
  el.style.right = `calc(${px}px + env(safe-area-inset-right, 0px))`;
  return el.style.right;
}

/** The sidebar keeping its right edge on <html> (layout/sidebar), or taking it off. */
function setRail(px: number | null) {
  if (px === null) document.documentElement.style.removeProperty(APP_RAIL_VAR);
  else document.documentElement.style.setProperty(APP_RAIL_VAR, `${px}px`);
}

/**
 * The panel's box on a screen `screenH` tall: its PANEL_SIZE height (the one
 * its style sets), capped by its max-height.
 */
function panelBox(
  style: CSSProperties,
  screenH: number,
  insetBottom = 0,
  size: PanelSizeName = "normal"
) {
  const height = Math.min(
    cssPx(PANEL_SIZE[size].height, screenH, insetBottom),
    cssPx(String(style.maxHeight), screenH, insetBottom)
  );
  if (style.bottom !== undefined) {
    const bottom = screenH - cssPx(String(style.bottom), screenH, insetBottom);
    return { top: bottom - height, bottom, height };
  }
  const top = cssPx(String(style.top), screenH, insetBottom);
  return { top, bottom: top + height, height };
}

function stubScreen({
  phone,
  coarse = phone,
  wide = false,
}: {
  phone: boolean;
  coarse?: boolean;
  /** md and wider (Enlarge's min-width query). */
  wide?: boolean;
}) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width")
      ? phone
      : query.includes("min-width")
        ? wide
        : query.includes("coarse")
          ? coarse
          : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function setSaveData(on: boolean | undefined) {
  Object.defineProperty(navigator, "connection", {
    value: on === undefined ? undefined : { saveData: on },
    configurable: true,
  });
}

const amrButton = () => screen.getByRole("button", { name: "Ask Amr" });

beforeEach(() => {
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setSaveData(undefined);
  useMascotStore.setState({ ready: false });
  document.documentElement.style.removeProperty("--amr-band-bottom");
  setRail(null);
  window.localStorage.removeItem(PANEL_SIZE_KEY);
});

describe("Data Saver", () => {
  it("starts his figure on the first interaction, not on a timer", async () => {
    stubScreen({ phone: true });
    setSaveData(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<MascotAssistant />);
    // Long after load, nobody has touched the page: still the launcher.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("mascot-sprite")).toBeNull();

    // The first tap brings him (after an idle moment).
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("without Data Saver he still arrives on his own a moment after load", async () => {
    stubScreen({ phone: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<MascotAssistant />);
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    vi.useRealTimers();
    expect(await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it("keeps his full space on phones, not a launcher-sized sliver", () => {
    stubScreen({ phone: true });
    setSaveData(true);
    useMascotStore.setState({ ready: false });
    render(<MascotAssistant />);
    const published = document.documentElement.style.getPropertyValue("--amr-band-bottom");
    expect(parseInt(published.match(/\d+/)![0], 10)).toBeGreaterThan(80);
  });
});

describe("safe areas", () => {
  it("keeps clear of a landscape iPhone's notch and home indicator", () => {
    stubScreen({ phone: false, coarse: true });
    render(<MascotAssistant />);
    const button = amrButton();
    // (jsdom garbles env() when it reads the value back; the string set is
    // calc(8px + env(safe-area-inset-right, 0px)).)
    expect(button.style.right).toMatch(/^calc\(8px \+ env\(.*safe-area-inset-right/);
    expect(button.style.bottom).toContain("safe-area-inset-bottom");
  });

  it("keeps the side inset on phones too", () => {
    stubScreen({ phone: true });
    render(<MascotAssistant />);
    expect(amrButton().style.right).toMatch(/^calc\(8px \+ env\(.*safe-area-inset-right/);
  });
});

describe("his panel stays on screen when he has stepped aside", () => {
  // [screen, phone?, box height]: the phone figure is 96×104, larger screens 132×143.
  const screens = [
    { name: "360x640", h: 640, phone: true, boxH: 104 },
    { name: "375x812", h: 812, phone: true, boxH: 104 },
    { name: "812x375 landscape", h: 375, phone: false, boxH: 143 },
    { name: "768x1024 tablet", h: 1024, phone: false, boxH: 143 },
  ];
  const lifts = [0, 48, 96, 144];

  for (const s of screens) {
    for (const insetBottom of [0, 21]) {
      it(`${s.name}${insetBottom ? " with a home indicator" : ""}: below the header, above the edge`, () => {
        for (const lift of lifts) {
          for (const corner of ["bottomRight", "bottomLeft", "topRight", "topLeft"] as Corner[]) {
            const box = panelBox(panelPos(corner, true, s.boxH, s.phone, lift), s.h, insetBottom);
            const where = `${corner} lift ${lift}`;
            // Its title row (Close, New chat, History) clears the header...
            expect(box.top, where).toBeGreaterThanOrEqual(HEADER_H + 8 - 0.01);
            // ...its input or footer stays on screen, past the home indicator...
            expect(box.bottom, where).toBeLessThanOrEqual(s.h - insetBottom + 0.01);
            // ...and it's never squeezed below its title row and a few lines.
            expect(box.height, where).toBeGreaterThanOrEqual(Math.min(0.68 * s.h, 160) - 0.01);
          }
        }
      });
    }
  }

  it("follows him up while there's room, getting shorter instead of leaving the screen", () => {
    // 360x640, bottom right: at home the panel is its usual height above his head.
    const home = panelBox(panelPos("bottomRight", true, 104, true, 0), 640);
    expect(home.height).toBeCloseTo(0.68 * 640);
    // Stepped up 144 px: still right above his head (it moved up 144 px), only shorter.
    const lifted = panelBox(panelPos("bottomRight", true, 104, true, 144), 640);
    expect(lifted.bottom).toBeCloseTo(home.bottom - 144);
    expect(lifted.top).toBeCloseTo(HEADER_H + 8);
    expect(lifted.height).toBeLessThan(home.height);
  });

  it("is unchanged on a desktop and on phones at home", () => {
    // 1440x900 desktop: the usual 560 px panel right above him, as before.
    const desktop = panelBox(panelPos("bottomRight", true, 143, false, 0), 900);
    expect(desktop.height).toBe(560);
    expect(900 - desktop.bottom).toBeCloseTo(131.6875);
    // Phones at home: the usual min(68vh, 560px).
    expect(panelBox(panelPos("bottomRight", true, 104, true, 0), 640).height).toBeCloseTo(
      0.68 * 640
    );
    expect(panelBox(panelPos("bottomRight", true, 104, true, 0), 915).height).toBe(560);
  });

  it("takes its usual size from PANEL_SIZE, the one source for its style and its room", () => {
    // The usual card, as before the revamp (the numbers above rest on it).
    expect(PANEL_SIZE.normal).toEqual({ width: "min(92vw, 380px)", height: "min(68vh, 560px)" });
    // Enlarged on a 1440x900 desktop: still right above him, as tall as fits under the header.
    const large = panelBox(panelPos("bottomRight", true, 143, false, 0, "large"), 900, 0, "large");
    expect(900 - large.bottom).toBeCloseTo(131.6875);
    expect(large.top).toBeCloseTo(HEADER_H + 8);
    expect(large.height).toBeGreaterThan(560);
  });

  for (const s of [
    { name: "768x1024 tablet", h: 1024 },
    { name: "1280x720 laptop", h: 720 },
    { name: "1440x900 desktop", h: 900 },
  ]) {
    it(`${s.name}: the enlarged panel stays below the header and on screen`, () => {
      for (const lift of [0, 48, 144]) {
        for (const corner of ["bottomRight", "bottomLeft", "topRight", "topLeft"] as Corner[]) {
          const box = panelBox(panelPos(corner, true, 143, false, lift, "large"), s.h, 0, "large");
          const where = `${corner} lift ${lift}`;
          expect(box.top, where).toBeGreaterThanOrEqual(HEADER_H + 8 - 0.01);
          expect(box.bottom, where).toBeLessThanOrEqual(s.h + 0.01);
          expect(box.height, where).toBeGreaterThanOrEqual(160 - 0.01);
        }
      }
    });
  }
});

describe("stepping aside", () => {
  const VW = 360;
  const VH = 640;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;
  /** The screen's side safe areas, as his probe reads them (jsdom can't resolve env()). */
  let insets = { left: 0, right: 0 };
  /** The app's rail's right edge, where the sidebar keeps one (md and up). */
  let rail: number | null = null;

  beforeEach(() => {
    insets = { left: 0, right: 0 };
    rail = null;
    vi.stubGlobal("innerWidth", VW);
    vi.stubGlobal("innerHeight", VH);
    // jsdom has no layout: give Amr's button (96×104) and his hit box (42×89,
    // 27 px in, 12 px down) their phone sizes.
    for (const prop of OFFSETS) {
      saved.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          if (this.hasAttribute("data-mascot-hit"))
            return { offsetLeft: 27, offsetTop: 12, offsetWidth: 42, offsetHeight: 89 }[prop];
          if (this.title.startsWith("Ask Amr"))
            return { offsetLeft: 0, offsetTop: 0, offsetWidth: 96, offsetHeight: 104 }[prop];
          return 0;
        },
      });
    }
    // His used position, from his inline style (anchored right or left, 8 px in
    // past that side's safe area), and the safe areas his probe is padded by.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo);
      if (!(el instanceof HTMLElement)) return cs;
      let used: Record<string, string>;
      if (el.hasAttribute("data-amr-inset-probe")) {
        used = { paddingLeft: `${insets.left}px`, paddingRight: `${insets.right}px` };
      } else if (el.title.startsWith("Ask Amr")) {
        used = {
          top: "auto",
          bottom: `${parseFloat(el.style.bottom.replace(/^calc\(/, ""))}px`,
          // On his left the rail stands in for the inset (it covers it).
          left: el.style.left ? `${8 + (rail ?? insets.left)}px` : "auto",
          right: el.style.right ? `${8 + insets.right}px` : "auto",
        };
      } else return cs;
      return new Proxy(cs, {
        get(target, prop) {
          if (typeof prop === "string" && prop in used) return used[prop];
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    });
  });

  afterEach(() => {
    for (const prop of OFFSETS) {
      const d = saved.get(prop);
      if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    }
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    document.querySelectorAll("[data-test-control]").forEach((n) => n.remove());
  });

  it("moves off the retro timer's Start button, and comes home once it's gone", async () => {
    stubScreen({ phone: true });
    // The timer's Start, where his figure stands at 360x640: [278,547,45x44].
    const start = document.createElement("button");
    start.setAttribute("data-test-control", "");
    start.textContent = "Start";
    const box = { left: 278, top: 547, width: 45, height: 44 };
    vi.spyOn(start, "getBoundingClientRect").mockReturnValue({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(start);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) =>
        start.isConnected &&
        x >= box.left &&
        x <= box.left + box.width &&
        y >= box.top &&
        y <= box.top + box.height
          ? [start, document.body]
          : [document.body],
    });

    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    expect(amrButton().style.right).toContain("safe-area-inset-right");

    // A step up still covers Start; the other side is clear.
    await waitFor(() => expect(amrButton().style.left).toContain("safe-area-inset-left"), {
      timeout: 2000,
    });
    expect(amrButton().style.right).toBe("");
    // He stays visible: still the figure, same size, same height.
    expect(amrButton().querySelector("[data-mascot-hit]")).not.toBeNull();

    // Start goes away (the page changed): he goes home.
    act(() => start.remove());
    await waitFor(() => expect(amrButton().style.right).toContain("safe-area-inset-right"), {
      timeout: 2000,
    });
  });

  it("stepped up 144 px at 360x640, he docks in the sheet's bottom corner, and steps up again once it closes", async () => {
    stubScreen({ phone: true });
    // A tall control down the right edge covers home and the first two steps up;
    // another down the left edge covers the other side: only 144 px up is clear.
    const boxes = [
      { left: 280, top: 495, width: 50, height: 145 },
      { left: 30, top: 380, width: 50, height: 260 },
    ];
    const controls = boxes.map((box) => {
      const el = document.createElement("button");
      el.setAttribute("data-test-control", "");
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        ...box,
        x: box.left,
        y: box.top,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => ({}),
      } as DOMRect);
      document.body.appendChild(el);
      return { el, box };
    });
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) => [
        ...controls
          .filter(
            ({ box }) =>
              x >= box.left &&
              x <= box.left + box.width &&
              y >= box.top &&
              y <= box.top + box.height
          )
          .map(({ el }) => el),
        document.body,
      ],
    });

    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    // 1 px from the bottom at home, 145 once he has stepped up 144.
    await waitFor(
      () => expect(parseFloat(amrButton().style.bottom.replace(/^calc\(/, ""))).toBe(145),
      { timeout: 2000 }
    );

    // His bubble and the moment chip learn where he is: stepped up 144 px, same side.
    expect(useMascotStore.getState().placed).toEqual({ side: "right", edge: "bottom" });
    expect(useMascotStore.getState().lift).toBe(144);

    // A phone held upright: the panel opens as the full-height sheet, from
    // under the header to above the home indicator, and he docks in its
    // bottom corner on his side (the sheet covers the controls he had
    // stepped up for), so nothing beside him follows the lift meanwhile.
    act(() => useAgentStore.setState({ open: true }));
    const panel = screen.getByRole("dialog", { name: "Amr" });
    expect(panel).toHaveAttribute("data-amr-layout", "sheet");
    expect(parseFloat(panel.style.getPropertyValue("--amr-vv-top"))).toBeGreaterThanOrEqual(8);
    expect(amrButton()).toHaveAttribute("data-amr-docked");
    expect(amrButton().style.bottom).toContain("--amr-dock-bottom");
    expect(useMascotStore.getState().placed).toEqual({ side: "right", edge: "bottom" });
    expect(useMascotStore.getState().lift).toBe(0);

    // Closed, he is back where he stepped up to.
    act(() => useAgentStore.setState({ open: false }));
    expect(amrButton()).not.toHaveAttribute("data-amr-docked");
    expect(parseFloat(amrButton().style.bottom.replace(/^calc\(/, ""))).toBe(145);
    expect(useMascotStore.getState().lift).toBe(144);
  });

  it("with a cutout on one side, finds his way home from the other side", async () => {
    stubScreen({ phone: true });
    // A camera cutout on the left only: the left side is 8 px past 30 px.
    insets = { left: 30, right: 0 };
    const start = document.createElement("button");
    start.setAttribute("data-test-control", "");
    const box = { left: 278, top: 547, width: 45, height: 44 };
    vi.spyOn(start, "getBoundingClientRect").mockReturnValue({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(start);
    const asked: number[] = [];
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) => {
        asked.push(Math.round(x));
        return x >= box.left &&
          x <= box.left + box.width &&
          y >= box.top &&
          y <= box.top + box.height
          ? [start, document.body]
          : [document.body];
      },
    });

    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    await waitFor(() => expect(amrButton().style.left).toContain("safe-area-inset-left"), {
      timeout: 2000,
    });

    // He looks again from the left (a resize): home is where it really is,
    // 283-325 on the right, not 30 px off; the left is where he really stands.
    asked.length = 0;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(asked).toContain(286);
    expect(asked).not.toContain(256);
    expect(asked).toContain(68);
    // Start is still at home, so he stays on the left.
    expect(amrButton().style.left).toContain("safe-area-inset-left");
  });

  it("on a touch tablet beside the app's rail, steps aside to the left past it, and finds his way home", async () => {
    // 1024 wide at md: the rail's right edge at 64 px.
    vi.stubGlobal("innerWidth", 1024);
    stubScreen({ phone: false, coarse: true });
    rail = 64;
    setRail(64);
    // A tall control down the right edge covers his home and every step up
    // (his hit box at home is 947-989: 1024 - 8 - 96 + 27), so he crosses over.
    const start = document.createElement("button");
    start.setAttribute("data-test-control", "");
    const box = { left: 930, top: 100, width: 80, height: 540 };
    vi.spyOn(start, "getBoundingClientRect").mockReturnValue({
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(start);
    const asked: number[] = [];
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) => {
        asked.push(Math.round(x));
        return x >= box.left &&
          x <= box.left + box.width &&
          y >= box.top &&
          y <= box.top + box.height
          ? [start, document.body]
          : [document.body];
      },
    });

    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    await waitFor(() => expect(amrButton().style.left).toContain("--app-rail"), {
      timeout: 2000,
    });
    // It looked at the left past the rail (his hit box from 99: 8 + 64 + 27),
    // never under it (from 35).
    expect(asked).toContain(102);
    expect(asked).not.toContain(38);

    // He looks again (a resize): home is where it really is, not the rail's
    // width off (883), and the left is where he really stands.
    asked.length = 0;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(asked).toContain(950);
    expect(asked).not.toContain(886);
    expect(asked).toContain(102);
    expect(amrButton().style.left).toContain("--app-rail");
  });

  it("doesn't step aside for his own bubble's answers or the moment chip beside him", async () => {
    stubScreen({ phone: true });
    // A moment chip's button, in the chip's region, where his figure stands.
    const chip = document.createElement("div");
    chip.setAttribute("data-moment-region", "");
    chip.setAttribute("data-test-control", "");
    const chipButton = document.createElement("button");
    chip.appendChild(chipButton);
    document.body.appendChild(chip);
    const box = { left: 278, top: 547, width: 45, height: 44 };
    // Laid out where his figure stands, as the timer's Start is above.
    const laidOut = (el: Element) =>
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        ...box,
        x: box.left,
        y: box.top,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => ({}),
      } as DOMRect);
    laidOut(chipButton);
    let under: Element[] = [chipButton];
    const looked = vi.fn();
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: (x: number, y: number) => {
        looked();
        return x >= box.left &&
          x <= box.left + box.width &&
          y >= box.top &&
          y <= box.top + box.height
          ? [...under, document.body]
          : [document.body];
      },
    });

    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    await waitFor(() => expect(looked).toHaveBeenCalled(), { timeout: 2000 });
    expect(amrButton().style.right).toContain("safe-area-inset-right");

    // His bubble asks beside him: its answer is his own too, not a page control.
    act(() =>
      useBubbleStore.getState().show({
        id: "q",
        text: "Need a hand?",
        actions: [{ label: "Yes", run: () => {} }],
      })
    );
    const yes = screen.getByRole("button", { name: "Yes" });
    laidOut(yes);
    under = [yes, chipButton];
    looked.mockClear();
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await waitFor(() => expect(looked).toHaveBeenCalled(), { timeout: 2000 });
    expect(amrButton().style.right).toContain("safe-area-inset-right");
    expect(amrButton().style.left).toBe("");
    expect(useMascotStore.getState().placed).toEqual({ side: "right", edge: "bottom" });
    expect(useMascotStore.getState().lift).toBe(0);
    act(() => useBubbleStore.setState({ current: null }));
  });

  it("leaves a desktop with a mouse alone", async () => {
    stubScreen({ phone: false, coarse: false });
    const elementsFromPoint = vi.fn(() => [document.body]);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: elementsFromPoint,
    });
    render(<MascotAssistant />);
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 900));
    expect(elementsFromPoint).not.toHaveBeenCalled();
  });
});

describe("choosing his corner (X108)", () => {
  /** Pick him up at (300, 600) and let go at (x, y): a drag, not a tap. */
  const drag = (x: number, y: number) => {
    act(() => {
      fireEvent.pointerDown(amrButton(), { button: 0, clientX: 300, clientY: 600 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: x, clientY: y });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: x, clientY: y });
    });
  };
  const queue = () => useMascotStore.getState().reactionQueue;
  const corner = `scene:${EVENT_SCENES.corner}`;

  beforeEach(() => useMascotStore.setState({ reactionQueue: [] }));

  it("shows the corner chosen once he has landed in it, never over the landing", () => {
    stubScreen({ phone: false });
    render(<MascotAssistant />);
    // From the bottom right he stands in to the bottom left: the move the sheet draws.
    drag(20, 1300);
    expect(queue()).toEqual(["land", corner]);
  });

  it("plays nothing for a move the sheet doesn't draw, which leaves the page's once unspent", () => {
    stubScreen({ phone: false });
    render(<MascotAssistant />);
    // Its marker only ever leaves the lower-right cup for the lower-left one.
    drag(20, 20); // the top left
    expect(queue()).toEqual(["land"]);
    drag(1000, 20); // the top right
    expect(queue()).toEqual(["land"]);
    drag(20, 1300); // the bottom left, but from the top right
    expect(queue()).toEqual(["land"]);
    drag(1000, 1300); // back to the bottom right
    expect(queue()).toEqual(["land"]);
    drag(20, 1300); // and now the move it draws
    expect(queue()).toEqual(["land", corner]);
  });

  it("plays nothing when he's dropped back in the corner he stood in", () => {
    stubScreen({ phone: false });
    render(<MascotAssistant />);
    drag(1000, 1300);
    expect(queue()).toEqual(["land"]);
  });

  it("once a page: the same move again just lands", () => {
    stubScreen({ phone: false });
    render(<MascotAssistant />);
    drag(20, 1300);
    expect(queue()).toEqual(["land", corner]);
    drag(1000, 1300);
    expect(queue()).toEqual(["land"]);
    // The bottom right to the bottom left again, but this page has had the scene.
    drag(20, 1300);
    expect(queue()).toEqual(["land"]);
  });

  it("with reduced motion, there's no landing to wait for", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    render(<MascotAssistant />);
    drag(20, 20);
    expect(queue()).toEqual([]);
    drag(1000, 1300);
    drag(20, 1300);
    expect(queue()).toEqual([corner]);
  });

  it("waits for him to be on screen", () => {
    stubScreen({ phone: false });
    useMascotStore.setState({ ready: false });
    render(<MascotAssistant />);
    drag(20, 1300);
    expect(queue()).not.toContain(corner);
  });
});

describe("his panel is his balloon", () => {
  /** Amr's own button, whatever it is called while his panel is open or shut. */
  const amr = () => screen.getByTitle(/^Ask Amr/);

  /** Brings his figure in (the first interaction, then an idle moment). */
  async function withFigure() {
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
  }

  /**
   * Picks him up and carries him to (x, y) on jsdom's 1024x768 screen; `drop` lets go.
   * jsdom has no layout, so his box sits at 0,0: the drag starts there.
   */
  function carry(x: number, y: number, drop = true) {
    act(() => {
      fireEvent.pointerDown(amr(), { button: 0, clientX: 0, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: x, clientY: y });
    });
    if (!drop) return;
    act(() => {
      fireEvent.pointerUp(document, { clientX: x, clientY: y });
    });
  }

  function openPanel() {
    act(() => useAgentStore.setState({ open: true }));
    return screen.getByRole("dialog", { name: "Amr" });
  }

  afterEach(() => {
    act(() => useAgentStore.setState({ open: false }));
  });

  // [drop point, corner, tail, counted from, entrance origin] for the 132x143 figure,
  // whose centre is 58 px in from the panel's edge on his side.
  const corners = [
    {
      at: null,
      corner: "bottomRight",
      tail: "down",
      from: "right",
      origin: "calc(100% - 58px) 100%",
    },
    { at: [40, 700], corner: "bottomLeft", tail: "down", from: "left", origin: "58px 100%" },
    {
      at: [980, 40],
      corner: "topRight",
      tail: "up",
      from: "right",
      origin: "calc(100% - 58px) 0%",
    },
    { at: [40, 40], corner: "topLeft", tail: "up", from: "left", origin: "58px 0%" },
  ] as const;

  for (const c of corners) {
    it(`${c.corner}: points its tail ${c.tail} at his figure, from his side`, async () => {
      stubScreen({ phone: false, coarse: false });
      render(<MascotAssistant />);
      await withFigure();
      if (c.at) carry(c.at[0], c.at[1]);

      const panel = openPanel();
      expect(panel).toHaveAttribute("data-tail", c.tail);
      expect(panel).toHaveAttribute("data-tail-from", c.from);
      // The tail's near side: half its width short of his centre line, inside the line.
      expect(panel.style.getPropertyValue("--tail-at")).toBe(
        "calc(58px - 0.4rem - var(--panel-w))"
      );
      expect(panel.style.getPropertyValue("--panel-origin")).toBe(c.origin);
      // Balloons inside resolve their tail from these, so nothing re-renders when he moves.
      expect(panel).toHaveAttribute("data-amr-side", c.from);
      expect(panel).toHaveAttribute("data-amr-edge", c.tail === "up" ? "top" : "bottom");
      expect(panel).toHaveAttribute("data-amr-layout", "float");
      expect(panel).toHaveClass("group/amr", "panel", "comic-tailed", "bg-card", "shadow-xl");
      // And the things beside him follow where he is drawn.
      expect(useMascotStore.getState().placed).toEqual({
        side: c.from,
        edge: c.tail === "up" ? "top" : "bottom",
      });
    });
  }

  it("keeps the three marks the held layers need, and is named by his name plate", () => {
    stubScreen({ phone: false, coarse: false });
    render(<MascotAssistant />);
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-agent-sheet-root");
    expect(panel).toHaveAttribute("data-vt-hold", "amr-panel");
    expect(panel).not.toHaveAttribute("aria-label");
    const plate = screen.getByRole("heading", { level: 2, name: "Amr" });
    expect(panel).toHaveAttribute("aria-labelledby", plate.id);
    expect(plate).toHaveClass("comic-name-plate");
    // It grows in from its tail (the module's .panelEnter).
    expect(panel.className).toMatch(/panelEnter/);
    // The frame clips inside a padded wrapper, so the tail and focus rings stay whole.
    expect(panel).not.toHaveClass("overflow-hidden");
    const frame = panel.firstElementChild as HTMLElement;
    expect(frame).toHaveClass("overflow-hidden", "rounded-[inherit]", "p-1.5");
    // The strip's ground under the header is the page's paper.
    expect(frame.querySelector(".bg-bg")).not.toBeNull();
  });

  it("on a phone, points at the smaller figure's centre", async () => {
    stubScreen({ phone: true });
    render(<MascotAssistant />);
    await withFigure();
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-tail", "down");
    expect(panel.style.getPropertyValue("--tail-at")).toBe("calc(40px - 0.4rem - var(--panel-w))");
  });

  it("on a phone, stays on the page while a page field has the keyboard, tail and all; his bubble waits", async () => {
    stubScreen({ phone: true });
    render(
      <>
        <input aria-label="Page field" />
        <MascotAssistant />
      </>
    );
    await withFigure();
    expect(openPanel()).toHaveAttribute("data-tail", "down");
    act(() => useAgentStore.setState({ open: false }));

    const field = screen.getByLabelText("Page field");
    act(() => {
      field.focus();
    });
    // He is never taken off the page (DNA-SPEC §6), and the panel still points at him.
    const button = amr();
    expect(button.querySelector("[data-mascot-hit]")).not.toBeNull();
    expect(openPanel()).toHaveAttribute("data-tail", "down");
    act(() => useAgentStore.setState({ open: false }));
    // What he has to say waits until the field lets go, rather than sit over it.
    act(() => useBubbleStore.getState().show({ id: "hi", text: "Need a hand?" }));
    expect(document.querySelector("[data-amr-bubble]")).toBeNull();

    act(() => {
      field.blur();
    });
    // The same button all along, never unmounted; and now he speaks.
    expect(amr()).toBe(button);
    expect(document.querySelector("[data-amr-bubble-region] [role=status]")).toHaveTextContent(
      "Need a hand?"
    );
    act(() => useBubbleStore.setState({ current: null }));
  });

  it("has no tail while the launcher stands in for him", () => {
    stubScreen({ phone: false, coarse: false });
    useMascotStore.setState({ ready: false });
    render(<MascotAssistant />);
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-tail", "none");
    expect(panel).not.toHaveAttribute("data-tail-from");
    expect(panel.style.getPropertyValue("--tail-at")).toBe("");
    // It still grows from in line with the launcher plate (8 + 108 / 2 - 16).
    expect(panel.style.getPropertyValue("--panel-origin")).toBe("calc(100% - 46px) 100%");
  });

  it("drops the tail while he's carried, and points again where he lands", async () => {
    stubScreen({ phone: false, coarse: false });
    render(<MascotAssistant />);
    await withFigure();
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-tail", "down");

    carry(40, 40, false);
    expect(screen.getByRole("dialog", { name: "Amr" })).toHaveAttribute("data-tail", "none");

    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 40 });
    });
    const landed = screen.getByRole("dialog", { name: "Amr" });
    expect(landed).toHaveAttribute("data-tail", "up");
    expect(landed).toHaveAttribute("data-tail-from", "left");
  });
});

describe("his panel doesn't jump when his figure arrives (audit critic2-5)", () => {
  afterEach(() => {
    act(() => useAgentStore.setState({ open: false }));
  });

  // [screen, phone?, the figure's box height, screen height for the numbers].
  for (const s of [
    { name: "1440x900 desktop", phone: false, boxH: 143, h: 900 },
    { name: "375x812 phone", phone: true, boxH: 104, h: 812 },
  ]) {
    it(`${s.name}: opened over the launcher, it stays put as he takes its place`, async () => {
      stubScreen({ phone: s.phone });
      render(<MascotAssistant />);
      // Opened in the first moments (or as Data Saver's first touch): the launcher shows.
      act(() => useAgentStore.setState({ open: true }));
      expect(screen.queryByTestId("mascot-sprite")).toBeNull();
      const before = screen.getByRole("dialog", { name: "Amr" });
      expect(before).toHaveAttribute("data-tail", "none");
      const at = { bottom: before.style.bottom, maxHeight: before.style.maxHeight };
      // It already stands where he will: right above his figure's head.
      expect(panelBox(at, s.h).bottom).toBeCloseTo(
        panelBox(panelPos("bottomRight", true, s.boxH, s.phone), s.h).bottom
      );

      act(() => {
        window.dispatchEvent(new Event("pointerdown"));
      });
      await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
      const after = screen.getByRole("dialog", { name: "Amr" });
      // He's in, and the tail points at him; the panel hasn't moved.
      expect(after).toHaveAttribute("data-tail", "down");
      expect({ bottom: after.style.bottom, maxHeight: after.style.maxHeight }).toEqual(at);
    });
  }

  it("goes back by the launcher plate only when his figure can't load and no try is left", async () => {
    sprite.fail = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      stubScreen({ phone: false, coarse: false });
      render(<MascotAssistant />);
      act(() => useAgentStore.setState({ open: true }));
      const bottom = () =>
        900 -
        panelBox(
          {
            bottom: screen.getByRole("dialog", { name: "Amr" }).style.bottom,
            maxHeight: screen.getByRole("dialog", { name: "Amr" }).style.maxHeight,
          },
          900
        ).bottom;
      const figureAt = 131.6875;
      // Where his figure will stand...
      expect(bottom()).toBeCloseTo(figureAt);
      act(() => {
        window.dispatchEvent(new Event("pointerdown"));
      });
      // (the idle moment, then the sheet fails)
      await act(() => vi.advanceTimersByTimeAsync(300));
      // ...and still there while his figure is tried again, 2, 4 and 8 s later,
      // so the panel doesn't jump each time...
      for (const wait of FIGURE_RETRY_MS) {
        expect(bottom()).toBeCloseTo(figureAt);
        await act(() => vi.advanceTimersByTimeAsync(wait));
      }
      // ...until the last try fails: then by the plate (its inset, height and the gap), once.
      expect(bottom()).toBe(4 + LAUNCHER_PLATE.h + 6);
      expect(screen.getByRole("dialog", { name: "Amr" })).toHaveAttribute("data-tail", "none");
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(bottom()).toBe(4 + LAUNCHER_PLATE.h + 6);
    } finally {
      sprite.fail = false;
    }
  });
});

describe("Enlarge", () => {
  const enlarge = () => screen.getByRole("button", { name: "Enlarge chat" });
  const dialog = () => screen.getByRole("dialog", { name: "Amr" });
  /** The size the panel's style gives it (its w-/h- classes read these). */
  const size = (side: "width" | "height") => dialog().style.getPropertyValue(`--amr-panel-${side}`);
  /** Its width: PANEL_SIZE's, never so wide it runs under the app's rail or off the far edge. */
  const width = (name: PanelSizeName) =>
    `min(${PANEL_SIZE[name].width}, calc(100% - ${2 * PANEL_SIDE}px - var(--app-rail, 0px)))`;

  beforeEach(() => {
    useAgentStore.setState({ open: true });
  });

  afterEach(() => {
    act(() => useAgentStore.setState({ open: false }));
  });

  it("is offered at md and up, as a toggle, sized from PANEL_SIZE", () => {
    stubScreen({ phone: false, coarse: false, wide: true });
    render(<MascotAssistant />);
    // The usual card, its size set by the style from PANEL_SIZE, not written in a class.
    expect(dialog()).toHaveClass("w-[var(--amr-panel-width)]", "h-[var(--amr-panel-height)]");
    expect(size("width")).toBe(width("normal"));
    expect(size("height")).toBe(PANEL_SIZE.normal.height);
    expect(enlarge()).toHaveAttribute("aria-pressed", "false");
    expect(enlarge()).toHaveClass("hidden", "md:inline-flex");

    fireEvent.click(enlarge());
    expect(enlarge()).toHaveAttribute("aria-pressed", "true");
    expect(size("width")).toBe(width("large"));
    expect(size("height")).toBe(PANEL_SIZE.large.height);
    // Its room is worked out for the larger height.
    expect(dialog().style.bottom).toContain(PANEL_SIZE.large.height);
  });

  it("is remembered by this browser, and forgotten when made smaller", () => {
    stubScreen({ phone: false, coarse: false, wide: true });
    const first = render(<MascotAssistant />);
    fireEvent.click(enlarge());
    expect(window.localStorage.getItem(PANEL_SIZE_KEY)).toBe("large");
    first.unmount();

    render(<MascotAssistant />);
    expect(enlarge()).toHaveAttribute("aria-pressed", "true");
    expect(size("height")).toBe(PANEL_SIZE.large.height);

    fireEvent.click(enlarge());
    expect(enlarge()).toHaveAttribute("aria-pressed", "false");
    expect(window.localStorage.getItem(PANEL_SIZE_KEY)).toBeNull();
    expect(size("height")).toBe(PANEL_SIZE.normal.height);
  });

  it("keeps the usual card below md, remembering the choice for a wider window", () => {
    window.localStorage.setItem(PANEL_SIZE_KEY, "large");
    stubScreen({ phone: false, coarse: true, wide: false });
    render(<MascotAssistant />);
    expect(size("height")).toBe(PANEL_SIZE.normal.height);
    expect(enlarge()).toHaveAttribute("aria-pressed", "true");
  });

  it("works with storage blocked: the usual size, and a choice that lasts the visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    stubScreen({ phone: false, coarse: false, wide: true });
    render(<MascotAssistant />);
    expect(size("height")).toBe(PANEL_SIZE.normal.height);
    fireEvent.click(enlarge());
    expect(size("height")).toBe(PANEL_SIZE.large.height);
  });
});

describe("beside the app's rail, md and up (end-to-end check after PR 12)", () => {
  /** The narrowest md screen: a pinned rail leaves it 512 px. */
  const W = 768;
  const H = 1024;
  // The sidebar's right edge as it keeps it: the rail, pinned open, and pinned
  // open beside a 47 px notch (the rail's width holds the inset).
  const RAILS = [
    { name: "the 64 px rail", rail: 64, notch: 0 },
    { name: "the rail pinned open", rail: 256, notch: 0 },
    { name: "the rail pinned open beside a notch", rail: 256 + 47, notch: 47 },
  ];
  /** His four corners in turn, by the arrow keys on his button (as Move Amr moves him). */
  const TOUR: { key: string | null; corner: Corner }[] = [
    { key: null, corner: "bottomRight" },
    { key: "ArrowLeft", corner: "bottomLeft" },
    { key: "ArrowUp", corner: "topLeft" },
    { key: "ArrowRight", corner: "topRight" },
  ];
  const dialog = () => screen.getByRole("dialog", { name: "Amr" });
  const enlarge = () => screen.getByRole("button", { name: "Enlarge chat" });

  beforeEach(() => {
    vi.stubGlobal("innerWidth", W);
    vi.stubGlobal("innerHeight", H);
    stubScreen({ phone: false, coarse: false, wide: true });
  });

  afterEach(() => {
    act(() => useAgentStore.setState({ open: false }));
    useMascotStore.getState().setCorner("bottomRight");
  });

  async function render768(figure: boolean) {
    if (!figure) useMascotStore.setState({ ready: false });
    render(<MascotAssistant />);
    if (!figure) return;
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
  }

  for (const r of RAILS) {
    for (const figure of [true, false]) {
      it(`${r.name}, ${figure ? "his figure" : "the launcher plate"}: his left corners and their panel start past it, his right ones are as they were`, async () => {
        setRail(r.rail);
        await render768(figure);
        const at = { width: W, rail: r.rail, left: r.notch };
        // Where the rail ends, and his side gaps past it: never the notch on top.
        const edge = r.rail;
        for (const step of TOUR) {
          if (step.key) fireEvent.keyDown(amrButton(), { key: step.key });
          expect(useMascotStore.getState().corner).toBe(step.corner);
          const left = step.corner.endsWith("Left");
          const button = amrButton();
          expect(button.hasAttribute("data-launcher")).toBe(!figure);

          if (left) {
            expect(button.style.right, step.corner).toBe("");
            const buttonLeft = inlinePx(button.style.left, at);
            expect(buttonLeft, step.corner).toBe(edge + BUTTON_SIDE);
            // His figure (the hit span) and the plate both stand clear of the rail.
            if (figure) expect(buttonLeft + MASCOT_BOX.w * HIT_SIDE).toBeGreaterThan(edge);
            // His bubble and the moment chip keep their place beside him.
            const chip = momentChipPosition(step.corner, false);
            expect(inlinePx(String(chip.left), at) - buttonLeft).toBe(156 - BUTTON_SIDE);
          } else {
            expect(button.style.left, step.corner).toBe("");
            expect(button.style.right, step.corner).toBe(rightAsItWas(BUTTON_SIDE));
          }

          act(() => useAgentStore.setState({ open: true }));
          for (const size of ["normal", "large"] as const) {
            const panel = dialog();
            if (size === "large") fireEvent.click(enlarge());
            expect(enlarge()).toHaveAttribute("aria-pressed", String(size === "large"));
            const width = inlinePx(panel.style.getPropertyValue("--amr-panel-width"), at);
            const where = `${step.corner} ${size}`;
            if (left) {
              const panelLeft = inlinePx(panel.style.left, at);
              expect(panelLeft, where).toBe(edge + PANEL_SIDE);
              // Its tail still points at him: both count from the rail.
              expect(panelLeft - inlinePx(button.style.left, at), where).toBe(
                PANEL_SIDE - BUTTON_SIDE
              );
              // Never pushed off the far edge, Enlarge or not.
              expect(panelLeft + width, where).toBeLessThanOrEqual(W - PANEL_SIDE);
            } else {
              expect(panel.style.left, where).toBe("");
              expect(panel.style.right, where).toBe(rightAsItWas(PANEL_SIDE));
              // And never wide enough to run under the rail from the right.
              expect(W - PANEL_SIDE - width, where).toBeGreaterThanOrEqual(edge + PANEL_SIDE);
            }
            if (size === "large") fireEvent.click(enlarge());
          }
          act(() => useAgentStore.setState({ open: false }));
        }
      });
    }
  }

  it("with the rail at 64 px, his usual panel and Enlarge keep their own widths", async () => {
    setRail(64);
    await render768(true);
    act(() => useAgentStore.setState({ open: true }));
    const at = { width: W, rail: 64 };
    expect(inlinePx(dialog().style.getPropertyValue("--amr-panel-width"), at)).toBe(380);
    fireEvent.click(enlarge());
    expect(inlinePx(dialog().style.getPropertyValue("--amr-panel-width"), at)).toBe(640);
  });

  it("with no rail (below md, or a page without it) is as it was: the screen's edge past a notch", async () => {
    vi.stubGlobal("innerWidth", 700);
    stubScreen({ phone: false, coarse: false, wide: false });
    await render768(true);
    fireEvent.keyDown(amrButton(), { key: "ArrowLeft" });
    const at = { width: 700, left: 30 };
    expect(inlinePx(amrButton().style.left, at)).toBe(BUTTON_SIDE + 30);
    expect(amrButton().style.left).toContain("safe-area-inset-left");
    act(() => useAgentStore.setState({ open: true }));
    expect(inlinePx(dialog().style.left, at)).toBe(PANEL_SIDE + 30);
    expect(inlinePx(dialog().style.getPropertyValue("--amr-panel-width"), at)).toBe(380);
    expect(inlinePx(String(momentChipPosition("bottomLeft", false).left), at)).toBe(156);
  });
});

describe("on a phone: the sheet, the side panel and his dock (chat revamp PR 8)", () => {
  /** The visual viewport, as a phone reports it: resize events as a keyboard moves. */
  class StubViewport extends EventTarget {
    width = 0;
    height = 0;
    offsetTop = 0;
    offsetLeft = 0;
    scale = 1;
  }
  let vv: StubViewport;
  /** The top, bottom and left safe areas his probe reads (jsdom can't resolve env()). */
  let safe = { top: 0, bottom: 0, left: 0 };

  const dialog = () => screen.getByRole("dialog", { name: "Amr" });
  /** A CSS variable the shell wrote on an element, in px. */
  const px = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name));
  const scale = MASCOT_BOX_PHONE.h / SHEET.cellH;
  /** Let the viewport listener's animation frame run. */
  const frames = () => act(() => new Promise((r) => setTimeout(r, 20)));

  /**
   * A screen `w` by `h`, its site header ending `header` px down (a notch's
   * safe area above it included), and the safe areas given. Phone width is
   * the PHONE_MEDIA_QUERY's, unless said.
   */
  function screenAt(
    w: number,
    h: number,
    opts: {
      insetTop?: number;
      insetBottom?: number;
      insetLeft?: number;
      header?: number;
      phone?: boolean;
    } = {}
  ) {
    vi.stubGlobal("innerWidth", w);
    vi.stubGlobal("innerHeight", h);
    vv = new StubViewport();
    vv.width = w;
    vv.height = h;
    vi.stubGlobal("visualViewport", vv);
    safe = { top: opts.insetTop ?? 0, bottom: opts.insetBottom ?? 0, left: opts.insetLeft ?? 0 };
    const header = document.createElement("header");
    header.setAttribute("data-chrome", "header");
    header.setAttribute("data-test-control", "");
    const bottom = opts.header ?? HEADER_H;
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: w,
      height: bottom,
      x: 0,
      y: 0,
      right: w,
      bottom,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(header);
    stubScreen({ phone: opts.phone ?? w <= 639, coarse: true });
  }

  /** The keyboard (or none) as iOS and Chrome report it: only the visual viewport shrinks. */
  function keyboard(kb: number) {
    vv.height = window.innerHeight - vv.offsetTop - kb;
    vv.dispatchEvent(new Event("resize"));
  }

  /** The page's main, which the sheet makes inert. */
  function pageMain(): HTMLElement {
    const main = document.createElement("main");
    main.id = "main-content";
    main.setAttribute("data-test-control", "");
    document.body.appendChild(main);
    return main;
  }

  async function withFigure() {
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
  }

  function openPanel() {
    act(() => useAgentStore.setState({ open: true }));
    return dialog();
  }

  async function guide() {
    return screen.findByTestId("mascot-visitor-guide", undefined, { timeout: 5000 });
  }

  /** Picks him up at the top left of his box (jsdom lays nothing out) and carries him to (x, y). */
  function carry(x: number, y: number, drop = true) {
    act(() => {
      fireEvent.pointerDown(amrButton(), { button: 0, clientX: 0, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerMove(document, { clientX: x, clientY: y });
    });
    if (!drop) return;
    act(() => {
      fireEvent.pointerUp(document, { clientX: x, clientY: y });
    });
  }

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    // The probe's safe areas; every other element as jsdom has it.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo);
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-amr-inset-probe")) return cs;
      const used: Record<string, string> = {
        paddingTop: `${safe.top}px`,
        paddingBottom: `${safe.bottom}px`,
        paddingLeft: `${safe.left}px`,
        paddingRight: "0px",
      };
      return new Proxy(cs, {
        get(target, prop) {
          if (typeof prop === "string" && prop in used) return used[prop];
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    });
  });

  afterEach(() => {
    act(() => useAgentStore.setState({ open: false }));
    document.querySelectorAll("[data-test-control]").forEach((n) => n.remove());
    useMascotStore.getState().setCorner("bottomRight");
  });

  for (const s of [
    { w: 320, h: 568 },
    { w: 360, h: 640 },
    { w: 375, h: 812 },
  ]) {
    for (const inset of [0, 34]) {
      it(`${s.w}x${s.h}${inset ? ", notch and home indicator" : ""}: the sheet fills the visible box, and he docks in its bottom corner at his phone size`, async () => {
        // An iPhone's notch sits above the header (44 px), its home indicator below.
        const header = (inset ? 44 : 0) + HEADER_H;
        screenAt(s.w, s.h, { insetTop: inset ? 44 : 0, insetBottom: inset, header });
        const main = pageMain();
        render(<MascotAssistant />);
        await withFigure();
        const panel = openPanel();
        expect(panel).toHaveAttribute("data-amr-layout", "sheet");

        // Its edges: under the header, above the home indicator, in line with his side offset.
        expect(px(panel, "--amr-vv-top")).toBe(header + VISIBLE_GAP);
        expect(px(panel, "--amr-vv-bottom")).toBe(inset + VISIBLE_GAP);
        expect(px(panel, "--amr-vv-left")).toBe(BUTTON_SIDE);
        expect(px(panel, "--amr-vv-right")).toBe(BUTTON_SIDE);
        expect(panel.style.top).toContain("--amr-vv-top");
        expect(panel.style.bottom).toContain("--amr-vv-bottom");
        expect(panel.style.getPropertyValue("--amr-panel-height")).toBe("auto");
        expect(panel).not.toHaveAttribute("data-amr-compact");
        // No tail and no Enlarge: he stands inside it, and it fills its room.
        expect(panel).toHaveAttribute("data-tail", "none");
        expect(screen.queryByRole("button", { name: "Enlarge chat" })).toBeNull();

        // Docked in its bottom right corner: the phone's figure, never scaled.
        const button = amrButton();
        expect(button).toHaveAttribute("data-amr-docked");
        expect(button.style.bottom).toContain("--amr-dock-bottom");
        expect(button.style.right).toContain("--amr-dock-inline");
        const dockBottom = px(button, "--amr-dock-bottom");
        const dockRight = px(button, "--amr-dock-inline");
        expect(dockBottom).toBeCloseTo(inset + VISIBLE_GAP + DOCK_INSET - FEET_TRIM * scale, 1);
        expect(dockRight).toBeCloseTo(BUTTON_SIDE + DOCK_INSET - MASCOT_BOX_PHONE.w * HIT_SIDE, 1);
        const figure = screen.getByTestId("mascot-sprite");
        expect(figure).toHaveAttribute("data-w", String(MASCOT_BOX_PHONE.w));
        expect(figure).toHaveAttribute("data-h", String(MASCOT_BOX_PHONE.h));
        // His figure (the hit span) stands inside the sheet, DOCK_INSET in from its corner.
        const hitRight = s.w - dockRight - MASCOT_BOX_PHONE.w * HIT_SIDE;
        const hitBottom = s.h - dockBottom - (MASCOT_BOX_PHONE.h - FIGURE_BOTTOM * scale);
        const hitTop = s.h - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_TOP * scale;
        const sheetBottom = s.h - inset - VISIBLE_GAP;
        expect(hitRight).toBeCloseTo(s.w - BUTTON_SIDE - DOCK_INSET, 1);
        expect(hitBottom).toBeCloseTo(sheetBottom - DOCK_INSET, 1);
        expect(hitTop).toBeGreaterThan(header + VISIBLE_GAP + 52);
        // The views keep his gutter beside the footer, and the footer is as tall as he is.
        const dock = dockInsets("bottomRight");
        expect(panel).toHaveAttribute("data-amr-dock", "right");
        expect(panel.style.getPropertyValue("--amr-dock-gutter")).toBe(
          `calc(${dock.gutter}px - var(--panel-w) - 0.375rem)`
        );
        expect(panel.style.getPropertyValue("--amr-dock-footer")).toBe(
          `calc(${dock.footer}px - var(--panel-w) - 0.375rem)`
        );
        expect(dock.footer).toBeGreaterThanOrEqual(sheetBottom - hitTop);
        // ...and DOCK_GAP clear of his figure: the footer's inner edge never reaches him.
        const hitLeft = hitRight - MASCOT_BOX_PHONE.w * (1 - 2 * HIT_SIDE);
        expect(s.w - BUTTON_SIDE - dock.gutter).toBeLessThanOrEqual(hitLeft - DOCK_GAP);
        // The page behind holds still, in this layout only.
        expect(document.documentElement).toHaveAttribute("data-amr-sheet");
        expect(main).toHaveAttribute("inert");
        // The bubble and the moment chip learn he is at the bottom.
        expect(useMascotStore.getState().placed).toEqual({ side: "right", edge: "bottom" });

        act(() => useAgentStore.setState({ open: false }));
        expect(document.documentElement).not.toHaveAttribute("data-amr-sheet");
        expect(main).not.toHaveAttribute("inert");
        expect(amrButton()).not.toHaveAttribute("data-amr-docked");
        expect(amrButton().style.getPropertyValue("--amr-dock-bottom")).toBe("");
        expect(amrButton().style.bottom).toContain("safe-area-inset-bottom");
      });
    }
  }

  it("320x460, an upright phone under Safari's bars: still the sheet, with him docked in it", async () => {
    // Its layout height is the screen less the browser's bars, 500 px or
    // less, but it is taller than it is wide: never the side panel.
    screenAt(320, 460);
    const main = pageMain();
    render(<MascotAssistant />);
    await withFigure();
    const panel = openPanel();
    expect(panel).toHaveAttribute("data-amr-layout", "sheet");
    expect(px(panel, "--amr-vv-top")).toBeGreaterThanOrEqual(VISIBLE_GAP);
    expect(px(panel, "--amr-vv-top")).toBe(HEADER_H + VISIBLE_GAP);
    expect(px(panel, "--amr-vv-bottom")).toBe(VISIBLE_GAP);
    const button = amrButton();
    expect(button).toHaveAttribute("data-amr-docked");
    expect(screen.getByTestId("mascot-sprite")).toHaveAttribute(
      "data-w",
      String(MASCOT_BOX_PHONE.w)
    );
    expect(panel.style.getPropertyValue("--amr-dock-gutter")).not.toBe("");
    expect(panel.style.getPropertyValue("--amr-dock-footer")).not.toBe("");
    expect(document.documentElement).toHaveAttribute("data-amr-sheet");
    expect(main).toHaveAttribute("inert");
  });

  for (const w of [320, 360, 375]) {
    for (const inset of [0, 34]) {
      for (const figure of [true, false]) {
        it(`${w}x812${inset ? ", home indicator" : ""}, ${figure ? "his figure" : "the launcher plate"} docked: the tool finder ends above him, so no tile is his`, async () => {
          screenAt(w, 812, { insetTop: inset ? 44 : 0, insetBottom: inset, header: HEADER_H });
          render(<MascotAssistant />);
          if (figure) await withFigure();
          const panel = openPanel();
          const finder = await guide();
          await frames();
          const button = amrButton();
          expect(button).toHaveAttribute("data-amr-docked");
          // Sized h-full, so its height gives way while he is docked.
          expect(finder.className).toContain(DOCK_END_FULL);
          expect(finder.className).not.toContain("pb-[var(--amr-dock-footer)]");
          // Its foot on the screen: the sheet's, less the footer's room.
          const finderBottom =
            812 - px(panel, "--amr-vv-bottom") - dockRoom(panel, "--amr-dock-footer");
          const dockBottom = px(button, "--amr-dock-bottom");
          const top = figure
            ? 812 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_TOP * scale
            : 812 - dockBottom - LAUNCHER_PLATE.h;
          expect(finderBottom).toBeLessThanOrEqual(top + 1e-6);
        });
      }
    }
  }

  for (const w of [320, 360, 375]) {
    for (const inset of [0, 34]) {
      it(`${w}x812${inset ? ", home indicator" : ""}, his figure docked: the chat's Latest button stands above the composer's row, so it is never his`, async () => {
        vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
        window.localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
        try {
          screenAt(w, 812, { insetTop: inset ? 44 : 0, insetBottom: inset, header: HEADER_H });
          render(<MascotAssistant />);
          await withFigure();
          const panel = openPanel();
          await guide();
          fireEvent.click(screen.getByRole("button", { name: "Chat with Amr" }));
          const log = await screen.findByRole("log", { name: "Conversation" });
          act(() => {
            useAgentStore.setState({
              chatProfile: "visitor",
              messages: [
                {
                  id: "u1",
                  role: "user",
                  content: [{ type: "text", text: "How do I run a retro?" }],
                  createdAt: "2026-11-16T09:00:00Z",
                },
                {
                  id: "a1",
                  role: "assistant",
                  content: [{ type: "text", text: "Start with what went well." }],
                  createdAt: "2026-11-16T09:00:01Z",
                },
              ],
            });
          });
          // The visitor's runtime brings the parts that draw messages: the
          // reader scrolls a log that shows them, not one they arrive in later.
          await screen.findByText("Start with what went well.");
          // The reader goes up the log (jsdom lays nothing out: its scroll is stubbed).
          Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 900 });
          Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 300 });
          Object.defineProperty(log, "scrollTop", { configurable: true, get: () => 120, set() {} });
          fireEvent.wheel(log, { deltaY: -120 });
          const latest = await screen.findByRole("button", { name: "Latest" });
          await frames();
          const button = amrButton();
          expect(button).toHaveAttribute("data-amr-docked");

          // In the chat's flow, after the log and before the composer's row:
          // never over the log, and never in the footer, whose gutter he stands in.
          const frame = log.parentElement!;
          const footer = frame.querySelector<HTMLElement>("[data-chat-footer]")!;
          expect(latest.closest("[data-chat-frame]")).toBe(frame);
          expect(log.contains(latest)).toBe(false);
          expect(footer.contains(latest)).toBe(false);
          expect(
            log.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING
          ).toBeTruthy();
          expect(
            latest.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
          ).toBeTruthy();
          // The footer is at least as tall as his room while he is docked...
          expect(footer.className).toContain(
            "group-data-[amr-dock]/amr:min-h-[var(--amr-dock-footer)]"
          );
          // ...so the 44 px Latest, 8 px above it, has its centre above his figure's top.
          const dockBottom = px(button, "--amr-dock-bottom");
          const hitTop = 812 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_TOP * scale;
          const sheetBottom = 812 - px(panel, "--amr-vv-bottom");
          const footerTop = sheetBottom - dockRoom(panel, "--amr-dock-footer");
          const latestCentre = footerTop - 8 - 22;
          expect(latestCentre).toBeLessThan(hitTop);
        } finally {
          window.localStorage.removeItem(VISITOR_AI_CONSENT_KEY);
          vi.unstubAllEnvs();
          act(() => useAgentStore.getState().reset());
        }
      });
    }
  }

  /**
   * A dock variable's room, px from the sheet's outer edge (its line and
   * padding added back), worked out at a root font of `rem` px with the
   * plate's size as the panel has it measured.
   */
  function dockRoom(panel: HTMLElement, name: string, rem = 16): number {
    const css = panel.style
      .getPropertyValue(name)
      .replace(
        /var\((--amr-plate-[wh]), 0px\)/g,
        (_, v: string) => panel.style.getPropertyValue(v) || "0px"
      )
      .replace(/var\(--panel-w\)/g, "0px")
      .replace(/(\d+(?:\.\d+)?)rem/g, (_, n: string) => `${Number(n) * rem}px`);
    return cssPx(css, 0) + 0.375 * rem;
  }

  /**
   * The launcher plate docked in the sheet's bottom right corner: on the
   * screen, clear of the views. `plate` is its drawn size (larger text grows
   * it), at a root font of `rem` px.
   */
  function expectPlateDocked(
    w: number,
    h: number,
    inset: number,
    { plate = LAUNCHER_PLATE, rem = 16 }: { plate?: { w: number; h: number }; rem?: number } = {}
  ) {
    const panel = dialog();
    const button = amrButton();
    expect(button).toHaveAttribute("data-launcher");
    expect(button).toHaveAttribute("data-amr-docked");
    const inline = px(button, "--amr-dock-inline");
    const bottom = px(button, "--amr-dock-bottom");
    // Its whole box is drawn: DOCK_INSET inside the corner, never off the screen.
    expect(inline).toBeGreaterThanOrEqual(0);
    expect(inline).toBeCloseTo(BUTTON_SIDE + DOCK_INSET, 1);
    expect(bottom).toBeCloseTo(inset + VISIBLE_GAP + DOCK_INSET, 1);
    // The views keep the plate's gutter and footer, as it is drawn: its
    // inner edge stays DOCK_GAP clear of them, and it stands beside the
    // composer's row, never over the log.
    const gutter = dockRoom(panel, "--amr-dock-gutter", rem);
    const footer = dockRoom(panel, "--amr-dock-footer", rem);
    const floor = dockInsets("bottomRight", false);
    expect(gutter).toBeGreaterThanOrEqual(floor.gutter);
    expect(footer).toBeGreaterThanOrEqual(floor.footer);
    expect(gutter).toBeGreaterThanOrEqual(DOCK_INSET + plate.w + DOCK_GAP);
    expect(footer).toBeGreaterThanOrEqual(DOCK_INSET + plate.h);
    const plateLeft = w - inline - plate.w;
    const gutterEdge = w - BUTTON_SIDE - gutter;
    expect(plateLeft).toBeGreaterThanOrEqual(gutterEdge + DOCK_GAP);
    const sheetBottom = h - inset - VISIBLE_GAP;
    const plateTop = h - bottom - plate.h;
    expect(plateTop).toBeGreaterThanOrEqual(sheetBottom - footer);
    // A 44 px Send at the end of the composer's row, at the gutter's edge:
    // its centre is never on the plate.
    const send = { x: gutterEdge - 22, y: sheetBottom - 8 - 22 };
    const onPlate =
      send.x >= plateLeft && send.x <= w - inline && send.y >= plateTop && send.y <= h - bottom;
    expect(onPlate).toBe(false);
  }

  for (const inset of [0, 34]) {
    it(`375x812${inset ? ", notch and home indicator" : ""}: the launcher plate docks inside the sheet's corner until his figure comes, then he takes its place`, async () => {
      const header = (inset ? 44 : 0) + HEADER_H;
      screenAt(375, 812, { insetTop: inset ? 44 : 0, insetBottom: inset, header });
      render(<MascotAssistant />);
      openPanel();
      await frames();
      expectPlateDocked(375, 812, inset);

      // His figure comes while the sheet is open: the dock moves to it.
      await withFigure();
      await frames();
      const panel = dialog();
      const button = amrButton();
      expect(button).not.toHaveAttribute("data-launcher");
      expect(panel.style.getPropertyValue("--amr-plate-w")).toBe("");
      expect(panel.style.getPropertyValue("--amr-plate-h")).toBe("");
      expect(px(button, "--amr-dock-inline")).toBeCloseTo(
        BUTTON_SIDE + DOCK_INSET - MASCOT_BOX_PHONE.w * HIT_SIDE,
        1
      );
      expect(px(button, "--amr-dock-bottom")).toBeCloseTo(
        inset + VISIBLE_GAP + DOCK_INSET - FEET_TRIM * scale,
        1
      );
      const fig = dockInsets("bottomRight");
      expect(panel.style.getPropertyValue("--amr-dock-gutter")).toBe(
        `calc(${fig.gutter}px - var(--panel-w) - 0.375rem)`
      );
      expect(panel.style.getPropertyValue("--amr-dock-footer")).toBe(
        `calc(${fig.footer}px - var(--panel-w) - 0.375rem)`
      );
    });
  }

  it("keeps the room for the launcher plate as drawn, when larger text grows it", async () => {
    screenAt(375, 812);
    render(<MascotAssistant />);
    // At 200% text the plate is about 200x88: what the shell reads off it.
    const button = amrButton();
    Object.defineProperty(button, "offsetWidth", { configurable: true, get: () => 200 });
    Object.defineProperty(button, "offsetHeight", { configurable: true, get: () => 88 });
    const panel = openPanel();
    await frames();
    expect(px(panel, "--amr-plate-w")).toBe(200);
    expect(px(panel, "--amr-plate-h")).toBe(88);
    expect(dockRoom(panel, "--amr-dock-gutter")).toBe(DOCK_INSET + 200 + DOCK_GAP);
    expect(dockRoom(panel, "--amr-dock-footer")).toBe(DOCK_INSET + 88);
    expectPlateDocked(375, 812, 0, { plate: { w: 200, h: 88 } });
  });

  it("at a 32 px root font, keeps the plate's rem box before any reading is larger", async () => {
    screenAt(375, 812);
    render(<MascotAssistant />);
    openPanel();
    await frames();
    // jsdom draws nothing (a reading of 0): the rem box alone grows the room.
    const plate = { w: LAUNCHER_PLATE.w * 2, h: LAUNCHER_PLATE.h * 2 };
    expect(dockRoom(dialog(), "--amr-dock-gutter", 32)).toBe(DOCK_INSET + plate.w + DOCK_GAP);
    expect(dockRoom(dialog(), "--amr-dock-footer", 32)).toBe(DOCK_INSET + plate.h);
    expectPlateDocked(375, 812, 0, { plate, rem: 32 });
  });

  it("keeps the launcher plate docked inside the sheet's corner while his figure is tried again and after it gives up", async () => {
    sprite.fail = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      screenAt(375, 812, { insetTop: 44, insetBottom: 34, header: 44 + HEADER_H });
      render(<MascotAssistant />);
      openPanel();
      act(() => {
        window.dispatchEvent(new Event("pointerdown"));
      });
      // (the idle moment, then the sheet fails, and each try after it)
      await act(() => vi.advanceTimersByTimeAsync(300));
      for (const wait of FIGURE_RETRY_MS) {
        expectPlateDocked(375, 812, 34);
        await act(() => vi.advanceTimersByTimeAsync(wait));
      }
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expectPlateDocked(375, 812, 34);
    } finally {
      sprite.fail = false;
    }
  });

  for (const s of [
    { w: 812, h: 375, phone: false, box: MASCOT_BOX },
    { w: 568, h: 320, phone: true, box: MASCOT_BOX_PHONE },
  ]) {
    it(`${s.w}x${s.h}: the panel runs down one side beside him, top to bottom, and the page stays live`, async () => {
      screenAt(s.w, s.h, { phone: s.phone });
      const main = pageMain();
      render(<MascotAssistant />);
      await withFigure();
      const panel = openPanel();
      expect(panel).toHaveAttribute("data-amr-layout", "side");
      // Under 360 px to see: compact, from just under the top of the screen to its bottom.
      expect(panel).toHaveAttribute("data-amr-compact");
      expect(px(panel, "--amr-vv-top")).toBe(COMPACT_TOP);
      expect(px(panel, "--amr-vv-bottom")).toBe(VISIBLE_GAP);
      // On his side, clear of his figure, as wide as the room allows up to its cap.
      const reach = s.box.w * (1 - HIT_SIDE);
      const inline = px(panel, "--amr-vv-inline");
      const width = px(panel, "--amr-vv-width");
      expect(panel.style.right).toContain("--amr-vv-inline");
      expect(inline).toBeCloseTo(BUTTON_SIDE + reach + PANEL_GAP, 1);
      expect(width).toBeCloseTo(
        Math.min(SIDE_PANEL_MAX_W, s.w - 2 * BUTTON_SIDE - reach - PANEL_GAP),
        1
      );
      expect(s.w - inline - width).toBeGreaterThanOrEqual(BUTTON_SIDE);
      // He stays in his corner at his usual size; the tail is on the edge facing him.
      expect(amrButton()).not.toHaveAttribute("data-amr-docked");
      expect(amrButton().style.bottom).toContain("safe-area-inset-bottom");
      expect(screen.getByTestId("mascot-sprite")).toHaveAttribute("data-w", String(s.box.w));
      expect(panel).toHaveAttribute("data-tail", "right");
      expect(panel).toHaveAttribute("data-tail-from", "bottom");
      // Nothing is locked: the page beside it stays live.
      expect(document.documentElement).not.toHaveAttribute("data-amr-sheet");
      expect(main).not.toHaveAttribute("inert");
    });
  }

  for (const r of [
    { w: 844, h: 390, rail: 64, notch: 0 },
    { w: 844, h: 390, rail: 256 + 47, notch: 47 },
    { w: 768, h: 400, rail: 256, notch: 0 },
  ]) {
    it(`${r.w}x${r.h} beside a ${r.rail} px rail${r.notch ? " that holds a notch" : ""}: the side panel on his left starts past it; on his right it only stops short of it`, async () => {
      screenAt(r.w, r.h, { phone: false, insetLeft: r.notch });
      setRail(r.rail);
      render(<MascotAssistant />);
      await withFigure();
      const reach = MASCOT_BOX.w * (1 - HIT_SIDE);
      // His box starts BUTTON_SIDE past the rail's edge (the notch is inside the rail).
      const edge = r.rail + BUTTON_SIDE;
      const at = { width: r.w, rail: r.rail, left: r.notch };

      // Bottom left: he and the panel beside him stand past the rail.
      fireEvent.keyDown(amrButton(), { key: "ArrowLeft" });
      expect(inlinePx(amrButton().style.left, at)).toBe(edge);
      let panel = openPanel();
      expect(panel).toHaveAttribute("data-amr-layout", "side");
      expect(panel.style.left).toContain("--amr-vv-inline");
      let inline = px(panel, "--amr-vv-inline");
      let width = px(panel, "--amr-vv-width");
      expect(inline).toBeCloseTo(edge + reach + PANEL_GAP, 1);
      expect(width).toBeCloseTo(
        Math.min(SIDE_PANEL_MAX_W, r.w - edge - BUTTON_SIDE - reach - PANEL_GAP),
        1
      );
      expect(inline + width).toBeLessThanOrEqual(r.w - BUTTON_SIDE + 0.01);
      // Before its first reading, too: past the rail, and its far edge on the screen.
      expect(panel.style.left).toContain("--app-rail");
      const fallbackWidth = () =>
        inlinePx(
          beforeReading(panel.style.getPropertyValue("--amr-panel-width"), "--amr-vv-width"),
          at
        );
      const fallbackLeft = inlinePx(beforeReading(panel.style.left, "--amr-vv-inline"), at);
      expect(fallbackLeft).toBeCloseTo(edge + reach + PANEL_GAP, 1);
      expect(fallbackLeft + fallbackWidth()).toBeLessThanOrEqual(r.w - BUTTON_SIDE + 0.01);
      act(() => useAgentStore.setState({ open: false }));

      // Bottom right: where it always stands, and never under the rail.
      fireEvent.keyDown(amrButton(), { key: "ArrowRight" });
      expect(amrButton().style.right).toBe(rightAsItWas(BUTTON_SIDE));
      panel = openPanel();
      expect(panel.style.right).toContain("--amr-vv-inline");
      inline = px(panel, "--amr-vv-inline");
      width = px(panel, "--amr-vv-width");
      expect(inline).toBeCloseTo(BUTTON_SIDE + reach + PANEL_GAP, 1);
      expect(r.w - inline - width).toBeGreaterThanOrEqual(edge - 0.01);
      // Before its first reading, too: its far edge stops short of the rail.
      const fallbackRight = inlinePx(beforeReading(panel.style.right, "--amr-vv-inline"), at);
      expect(fallbackRight).toBeCloseTo(BUTTON_SIDE + reach + PANEL_GAP, 1);
      expect(r.w - fallbackRight - fallbackWidth()).toBeGreaterThanOrEqual(edge - 0.01);
      // The toasts go across from him, at the screen's own edge over the rail:
      // their room is the screen's, as it was without one.
      const room = r.w - inline - width - (BUTTON_SIDE + r.notch) - TOAST_GAP;
      const html = document.documentElement;
      if (room >= SIDE_TOAST_MIN_W) expect(px(html, "--amr-toast-room")).toBeCloseTo(room, 1);
      else expect(html).toHaveAttribute("data-amr-toasts-held");
      // (At 844 beside the 64 px rail that is 299 px: room for a toast, held if the rail were counted.)
      if (r.rail === 64) expect(room).toBeGreaterThan(SIDE_TOAST_MIN_W);
    });
  }

  it("follows the rail while the side panel is open: pinned beside him, the panel moves with him", async () => {
    screenAt(844, 390, { phone: false });
    setRail(64);
    render(<MascotAssistant />);
    await withFigure();
    fireEvent.keyDown(amrButton(), { key: "ArrowLeft" });
    const panel = openPanel();
    const reach = MASCOT_BOX.w * (1 - HIT_SIDE);
    expect(px(panel, "--amr-vv-inline")).toBeCloseTo(64 + BUTTON_SIDE + reach + PANEL_GAP, 1);
    // Pinned open (or widening under a mouse): the sidebar says so on the document.
    setRail(256);
    act(() => {
      document.dispatchEvent(new Event(APP_RAIL_EVENT));
    });
    await frames();
    expect(px(panel, "--amr-vv-inline")).toBeCloseTo(256 + BUTTON_SIDE + reach + PANEL_GAP, 1);
    expect(inlinePx(amrButton().style.left, { width: 844, rail: 256 })).toBe(256 + BUTTON_SIDE);
    // Gone (presentation mode): the screen's edge again.
    setRail(null);
    act(() => {
      document.dispatchEvent(new Event(APP_RAIL_EVENT));
    });
    await frames();
    expect(px(panel, "--amr-vv-inline")).toBeCloseTo(BUTTON_SIDE + reach + PANEL_GAP, 1);
  });

  it("is carried past the rail, never under it, and dropped by the room past it", async () => {
    // A 1024x768 tablet with the rail pinned open: the room past it runs from
    // 264 to 1016, its middle at 640, not the screen's 512.
    screenAt(1024, 768, { phone: false });
    setRail(256);
    render(<MascotAssistant />);
    await withFigure();
    carry(100, 300, false);
    expect(amrButton().style.left).toBe("256px");
    expect(amrButton().style.top).toBe("300px");
    act(() => {
      fireEvent.pointerMove(document, { clientX: 600, clientY: 300 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 600, clientY: 300 });
    });
    expect(useMascotStore.getState().corner).toBe("topLeft");
    expect(inlinePx(amrButton().style.left, { width: 1024, rail: 256 })).toBe(256 + BUTTON_SIDE);

    // With no rail the same drop is on the right of the middle.
    setRail(null);
    carry(600, 300);
    expect(useMascotStore.getState().corner).toBe("topRight");
  });

  it("keeps the sheet through a Firefox-style shrink while a panel field has focus, and lays out again once none has", async () => {
    screenAt(360, 640);
    render(<MascotAssistant />);
    await withFigure();
    openPanel();
    await guide();
    const search = screen.getByLabelText("What do you need to do?");
    act(() => search.focus());

    // Firefox shrinks both viewports for its keyboard: no keyboard can be
    // told, the screen just looks 340 px tall.
    vi.stubGlobal("innerHeight", 340);
    vv.height = 340;
    window.dispatchEvent(new Event("resize"));
    vv.dispatchEvent(new Event("resize"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");
    // Fixed boxes already stop above it; with little room left, compact.
    expect(px(dialog(), "--amr-vv-bottom")).toBe(VISIBLE_GAP);
    expect(dialog()).toHaveAttribute("data-amr-compact");
    expect(px(dialog(), "--amr-vv-top")).toBe(COMPACT_TOP);

    // The field lets go and the screen is still that short: now it is a short screen.
    act(() => search.blur());
    window.dispatchEvent(new Event("resize"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");

    // Its full height again: the sheet.
    vi.stubGlobal("innerHeight", 640);
    vv.height = 640;
    window.dispatchEvent(new Event("resize"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");
    expect(dialog()).not.toHaveAttribute("data-amr-compact");
  });

  it("lays out again when the phone is turned, even while a panel field has focus", async () => {
    screenAt(360, 640);
    render(<MascotAssistant />);
    await withFigure();
    openPanel();
    await guide();
    act(() => screen.getByLabelText("What do you need to do?").focus());
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 360);
    vv.width = 640;
    vv.height = 360;
    window.dispatchEvent(new Event("orientationchange"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");
    expect(amrButton()).not.toHaveAttribute("data-amr-docked");
  });

  it("lays out again when the turn's new size comes only after its orientationchange, a panel field focused", async () => {
    screenAt(360, 640);
    render(<MascotAssistant />);
    await withFigure();
    openPanel();
    await guide();
    act(() => screen.getByLabelText("What do you need to do?").focus());

    // Android Chrome and older iOS: orientationchange first, still at the old size...
    window.dispatchEvent(new Event("orientationchange"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");

    // ...then the resize that carries the new one: a new width is a turn,
    // never a keyboard, so it lays out again with the field still focused.
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 360);
    vv.width = 640;
    vv.height = 360;
    window.dispatchEvent(new Event("resize"));
    vv.dispatchEvent(new Event("resize"));
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");
    expect(amrButton()).not.toHaveAttribute("data-amr-docked");
    expect(document.documentElement).not.toHaveAttribute("data-amr-sheet");
  });

  const corners: { keys: string[]; corner: AmrCorner; side: "left" | "right" }[] = [
    { keys: [], corner: "bottomRight", side: "right" },
    { keys: ["ArrowUp"], corner: "topRight", side: "right" },
    { keys: ["ArrowLeft"], corner: "bottomLeft", side: "left" },
    { keys: ["ArrowUp", "ArrowLeft"], corner: "topLeft", side: "left" },
  ];
  for (const c of corners) {
    it(`${c.corner}: docked at the bottom on his side, at his phone size, keyboard up or down`, async () => {
      screenAt(360, 640);
      render(<MascotAssistant />);
      await withFigure();
      for (const key of c.keys) fireEvent.keyDown(amrButton(), { key });
      const panel = openPanel();
      await guide();
      const other = c.side === "left" ? "right" : "left";
      const button = amrButton();
      expect(button).toHaveAttribute("data-amr-docked");
      expect(button.style[c.side]).toContain("--amr-dock-inline");
      expect(button.style[other]).toBe("");
      expect(button.style.top).toBe("");
      expect(panel).toHaveAttribute("data-amr-dock", c.side);
      // The panel says where he is drawn, as the store does: the balloons in
      // it count their tails from there.
      expect(panel).toHaveAttribute("data-amr-edge", "bottom");
      expect(panel).toHaveAttribute("data-amr-side", c.side);
      // His corner is kept for after; he is drawn at the bottom.
      expect(useMascotStore.getState().corner).toBe(c.corner);
      expect(useMascotStore.getState().placed).toEqual({ side: c.side, edge: "bottom" });
      const rest = px(button, "--amr-dock-bottom");
      expect(rest).toBeCloseTo(VISIBLE_GAP + DOCK_INSET - FEET_TRIM * scale, 1);

      // The tool finder's search has the keyboard: the sheet goes compact
      // above it, and he stays where he stands (he rides it only beside the
      // chat's composer).
      act(() => screen.getByLabelText("What do you need to do?").focus());
      keyboard(300);
      await frames();
      expect(panel).toHaveAttribute("data-amr-compact");
      expect(px(panel, "--amr-vv-bottom")).toBe(300 + VISIBLE_GAP);
      expect(px(button, "--amr-dock-bottom")).toBeCloseTo(rest, 2);
      expect(screen.getByTestId("mascot-sprite")).toHaveAttribute(
        "data-w",
        String(MASCOT_BOX_PHONE.w)
      );

      act(() => screen.getByLabelText("What do you need to do?").blur());
      keyboard(0);
      await frames();
      expect(panel).not.toHaveAttribute("data-amr-compact");
      expect(px(button, "--amr-dock-bottom")).toBeCloseTo(rest, 2);
      expect(screen.getByTestId("mascot-sprite")).toHaveAttribute(
        "data-h",
        String(MASCOT_BOX_PHONE.h)
      );

      // Closed, he stands in the corner he chose.
      act(() => useAgentStore.setState({ open: false }));
      expect(amrButton().style[c.side]).toContain(`safe-area-inset-${c.side}`);
      if (c.corner.startsWith("top")) expect(amrButton().style.top).toContain("--header-h");
      else expect(amrButton().style.bottom).toContain("safe-area-inset-bottom");
    });
  }

  it("is still carried while docked: a drop mid-sheet picks his side now and his corner for after", async () => {
    screenAt(360, 640);
    render(<MascotAssistant />);
    await withFigure();
    const panel = openPanel();
    // Mid-sheet on the left, above the visible box's middle ((64 + 632) / 2).
    carry(60, 300, false);
    expect(amrButton().style.top).toBe("300px");
    act(() => {
      fireEvent.pointerUp(document, { clientX: 60, clientY: 300 });
    });
    expect(useMascotStore.getState().corner).toBe("topLeft");
    expect(useMascotStore.getState().placed).toEqual({ side: "left", edge: "bottom" });
    expect(amrButton()).toHaveAttribute("data-amr-docked");
    expect(amrButton().style.left).toContain("--amr-dock-inline");
    expect(panel).toHaveAttribute("data-amr-dock", "left");

    act(() => useAgentStore.setState({ open: false }));
    expect(amrButton().style.top).toContain("--header-h");
    expect(amrButton().style.left).toContain("safe-area-inset-left");
  });

  it("drops him by the visible box: at y=250 with 300 px in view, a bottom corner", async () => {
    screenAt(360, 640);
    // A page field's keyboard is up: 300 px of the page can be seen.
    vv.height = 300;
    render(<MascotAssistant />);
    await withFigure();
    // Carried under the keyboard, he stops at the visible bottom (640 - 340).
    carry(40, 600, false);
    expect(amrButton().style.top).toBe("300px");
    act(() => {
      fireEvent.pointerMove(document, { clientX: 40, clientY: 250 });
    });
    act(() => {
      fireEvent.pointerUp(document, { clientX: 40, clientY: 250 });
    });
    // y=250 is below the visible box's middle ((64 + 292) / 2), though above the screen's.
    expect(useMascotStore.getState().corner).toBe("bottomLeft");
  });

  it("holds the page still in the sheet only: the document's computed overflow is hidden, and its scrollers pan", async () => {
    // globals.css "AMR SHEET", as the page has it.
    const source = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
    const start = source.indexOf("/* AMR SHEET");
    const block = source.slice(start, source.indexOf("/* Presentation mode", start));
    expect(block).toContain("html[data-amr-sheet]");
    const style = document.createElement("style");
    style.textContent = block;
    document.head.appendChild(style);
    try {
      screenAt(360, 640);
      const view = render(<MascotAssistant />);
      expect(window.getComputedStyle(document.documentElement).overflow).not.toBe("hidden");
      openPanel();
      const finder = await guide();
      expect(window.getComputedStyle(document.documentElement).overflow).toBe("hidden");
      // The sheet's chrome takes no swipe but still pinch-zooms (WCAG 1.4.4);
      // its scrollers pan, zoom too, and keep their scrolling.
      expect(window.getComputedStyle(dialog()).touchAction).toBe("pinch-zoom");
      expect(window.getComputedStyle(finder).touchAction).toBe("pan-y pinch-zoom");
      expect(window.getComputedStyle(finder).overscrollBehavior).toBe("contain");

      act(() => useAgentStore.setState({ open: false }));
      expect(window.getComputedStyle(document.documentElement).overflow).not.toBe("hidden");
      view.unmount();

      // Beside a floating card the page stays live.
      vi.stubGlobal("innerWidth", 1024);
      vi.stubGlobal("innerHeight", 768);
      stubScreen({ phone: false, coarse: false });
      render(<MascotAssistant />);
      expect(openPanel()).toHaveAttribute("data-amr-layout", "float");
      expect(window.getComputedStyle(document.documentElement).overflow).not.toBe("hidden");
    } finally {
      style.remove();
    }
  });
});
