import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    default: function SpriteStandIn({ onLoadError }: { onLoadError?: () => void }) {
      useEffect(() => {
        if (sprite.fail) onLoadError?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="mascot-sprite" />;
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
  LAUNCHER_PLATE,
  PANEL_SIZE,
  type PanelSizeName,
} from "@/components/agent/mascot/amr-geometry";
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

  beforeEach(() => {
    insets = { left: 0, right: 0 };
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
          left: el.style.left ? `${8 + insets.left}px` : "auto",
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

  it("stepped up 144 px at 360x640, his panel opens below the header", async () => {
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

    act(() => useAgentStore.setState({ open: true }));
    const panel = screen.getByRole("dialog", { name: "Amr" });
    const box = panelBox({ bottom: panel.style.bottom, maxHeight: panel.style.maxHeight }, VH);
    // Close, New chat and History clear the header; the panel is still above his head.
    expect(box.top).toBeGreaterThanOrEqual(HEADER_H);
    expect(VH - box.bottom).toBeCloseTo(98.5 + 144);
    // His bubble and the moment chip learn where he is: stepped up 144 px, same side.
    expect(useMascotStore.getState().placed).toEqual({ side: "right", edge: "bottom" });
    expect(useMascotStore.getState().lift).toBe(144);
    useAgentStore.setState({ open: false });
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

  it("on a phone, drops the tail while a page field outside the panel has the keyboard", async () => {
    stubScreen({ phone: true });
    render(
      <>
        <input aria-label="Page field" />
        <MascotAssistant />
      </>
    );
    await withFigure();
    expect(openPanel()).toHaveAttribute("data-tail", "down");

    const field = screen.getByLabelText("Page field");
    act(() => {
      field.focus();
    });
    // He steps off the page for the keyboard: nothing beside the panel to point at.
    expect(screen.queryByTitle(/^Ask Amr/)).toBeNull();
    const typing = screen.getByRole("dialog", { name: "Amr" });
    expect(typing).toHaveAttribute("data-tail", "none");
    expect(typing).not.toHaveAttribute("data-tail-from");
    expect(typing.style.getPropertyValue("--tail-at")).toBe("");

    act(() => {
      field.blur();
    });
    expect(amr()).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Amr" })).toHaveAttribute("data-tail", "down");
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
    expect(size("width")).toBe(PANEL_SIZE.normal.width);
    expect(size("height")).toBe(PANEL_SIZE.normal.height);
    expect(enlarge()).toHaveAttribute("aria-pressed", "false");
    expect(enlarge()).toHaveClass("hidden", "md:inline-flex");

    fireEvent.click(enlarge());
    expect(enlarge()).toHaveAttribute("aria-pressed", "true");
    expect(size("width")).toBe(PANEL_SIZE.large.width);
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
