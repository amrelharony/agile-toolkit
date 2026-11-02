import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * A phone has no spare margin, so Amr stood over the page (the "Set up your
 * sprint" card on the home page). He now stands in an opaque strip of his own,
 * and stays a full figure rather than shrinking to a launcher.
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

function stubWidth(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--amr-band-bottom");
});

describe("Amr's strip on phones", () => {
  it("reserves a strip at the bottom and publishes its height", () => {
    stubWidth(true);
    const { container, unmount } = render(<MascotAssistant />);
    const band = container.querySelector<HTMLElement>('[data-amr-band="bottom"]');
    expect(band).not.toBeNull();
    expect(band).toHaveAttribute("aria-hidden", "true");
    // Below the figure and every overlay, above the page.
    expect(band).toHaveClass("fixed", "z-30", "bg-bg");
    const published = document.documentElement.style.getPropertyValue("--amr-band-bottom");
    expect(published).toMatch(/^calc\(\d+px \+ env\(safe-area-inset-bottom, 0px\)\)$/);
    // Tall enough for the 104 px box's figure, not a launcher-sized sliver.
    expect(parseInt(published.match(/\d+/)![0], 10)).toBeGreaterThan(80);
    // He's still there, clear of the home indicator.
    const button = screen.getByRole("button", { name: "Open assistant" });
    expect(button.style.bottom).toContain("safe-area-inset-bottom");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe("");
  });

  it("leaves wider screens alone", () => {
    stubWidth(false);
    const { container } = render(<MascotAssistant />);
    expect(container.querySelector("[data-amr-band]")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--amr-band-bottom")).toBe("");
  });
});
