import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CSSProperties } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";

/**
 * Where Amr stands (mobile audit, 8 November 2026):
 * - Data Saver visitors got only the round launcher for the whole visit; he now
 *   arrives on their first interaction, and his space is kept for him all along.
 * - He keeps clear of a landscape iPhone's notch and home indicator.
 * - On touch screens he steps aside when his figure sits on a control
 *   (the helper itself is covered in mascot-nudge.test.ts).
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));

import { MascotAssistant, panelPos, type Corner } from "@/components/agent/mascot/mascot-assistant";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

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

/** The panel's box on a screen `screenH` tall: its class height, capped by its max-height. */
function panelBox(style: CSSProperties, screenH: number, insetBottom = 0) {
  const height = Math.min(
    0.68 * screenH,
    560,
    cssPx(String(style.maxHeight), screenH, insetBottom)
  );
  if (style.bottom !== undefined) {
    const bottom = screenH - cssPx(String(style.bottom), screenH, insetBottom);
    return { top: bottom - height, bottom, height };
  }
  const top = cssPx(String(style.top), screenH, insetBottom);
  return { top, bottom: top + height, height };
}

function stubScreen({ phone, coarse = phone }: { phone: boolean; coarse?: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("coarse") ? coarse : false,
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

const amrButton = () => screen.getByRole("button", { name: "Open assistant" });

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
});

describe("stepping aside", () => {
  const VW = 360;
  const VH = 640;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const OFFSETS = ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"] as const;

  beforeEach(() => {
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
    // His used position, from his inline style (anchored right or left, 8 px in).
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo);
      if (!(el instanceof HTMLElement) || !el.title.startsWith("Ask Amr")) return cs;
      const used: Record<string, string> = {
        top: "auto",
        bottom: `${parseFloat(el.style.bottom.replace(/^calc\(/, ""))}px`,
        left: el.style.left ? "8px" : "auto",
        right: el.style.right ? "8px" : "auto",
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
    const panel = screen.getByRole("dialog", { name: "Amr assistant" });
    const box = panelBox({ bottom: panel.style.bottom, maxHeight: panel.style.maxHeight }, VH);
    // Close, New chat and History clear the header; the panel is still above his head.
    expect(box.top).toBeGreaterThanOrEqual(HEADER_H);
    expect(VH - box.bottom).toBeCloseTo(98.5 + 144);
    useAgentStore.setState({ open: false });
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
