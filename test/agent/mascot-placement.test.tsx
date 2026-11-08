import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

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
