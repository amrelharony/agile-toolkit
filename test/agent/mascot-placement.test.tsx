import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * Where Amr stands (mobile audit, 8 November 2026):
 * - Data Saver visitors got only the round launcher for the whole visit; he now
 *   arrives on their first interaction, and his space is kept for him all along.
 * - He keeps clear of a landscape iPhone's notch and home indicator.
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
