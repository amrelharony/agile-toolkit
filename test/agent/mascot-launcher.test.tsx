import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Amr's launcher plate and getting his figure back (audit critic1-5):
 * - until his figure is in, and while it can't load, his button is the
 *   lettered "Ask Amr" plate: never a round sparkle, never a likeness of him;
 * - a figure that fails is tried again 2, 4 and 8 s later, at most 3 times;
 *   a try that falls due offline or in a hidden tab waits for the browser to
 *   be back online or the tab to show; a tap on the plate tries at once;
 * - his figure's code is imported again after a chunk that failed to load;
 * - the phone band keeps his figure's height while a try is to come.
 */

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => ({ status: "anonymous", user: null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({ abortInFlight: vi.fn() }));
vi.mock("@/lib/actions/register-all", () => ({}));

import {
  FIGURE_RETRY_MS,
  MascotAssistant,
  type LoadSprite,
} from "@/components/agent/mascot/mascot-assistant";
import { BUTTON_INSET, LAUNCHER_PLATE } from "@/components/agent/mascot/amr-geometry";
import { LAUNCHER_LABEL } from "@/components/agent/mascot/panel-parts";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

type SpriteModule = Awaited<ReturnType<LoadSprite>>;

/** The sprite stand-in: each mount is a try; with `sheet.fail` its sheet can't load. */
const sheet = { mounts: 0, fail: true };
function SpriteStandIn({ onLoadError }: { onLoadError?: () => void }) {
  useEffect(() => {
    sheet.mounts++;
    if (sheet.fail) onLoadError?.();
    else useMascotStore.getState().setReady(true);
    return () => useMascotStore.getState().setReady(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div data-testid="mascot-sprite" />;
}
const SPRITE = { default: SpriteStandIn } as unknown as SpriteModule;

/** A fresh loader per test: the figure's lazy component is kept per loader. */
function spriteLoader() {
  return vi.fn<LoadSprite>(async () => SPRITE);
}

const amrButton = () => screen.getByRole("button", { name: "Ask Amr" });

function stubScreen(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Lets the given time pass, and the lazy imports and renders it set off settle. */
async function pass(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** The first interaction starts his figure, after an idle moment (300 ms without an idle callback). */
async function startFigure() {
  act(() => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  await pass(300);
}

let online = true;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  stubScreen(false);
  sheet.mounts = 0;
  sheet.fail = true;
  online = true;
  visibility = "visible";
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  useAgentStore.setState({ open: false });
  useMascotStore.setState({ ready: false });
});

afterEach(() => {
  act(() => useAgentStore.setState({ open: false }));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { onLine?: boolean }).onLine;
  delete (document as { visibilityState?: string }).visibilityState;
  useMascotStore.setState({ ready: false });
  document.documentElement.style.removeProperty("--amr-band-bottom");
});

describe("the launcher plate", () => {
  it("is his name lettered on a plate until his figure is in: never round, never a likeness", async () => {
    sheet.fail = false;
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    const plate = amrButton();
    expect(plate).toHaveTextContent(LAUNCHER_LABEL);
    expect(plate).toHaveClass("comic-name-plate");
    expect(plate).toHaveAttribute("data-launcher");
    // No drawing of him (no AmrStill, no new likeness), and no icon either.
    expect(plate.querySelector("svg, img, canvas")).toBeNull();
    for (const c of plate.className.split(/\s+/)) expect(c).not.toMatch(/rounded-full/);
    // The size amr-geometry places him and his panel by, larger text growing it.
    expect(plate.style.minWidth).toBe(`${LAUNCHER_PLATE.w}px`);
    expect(plate.style.minHeight).toBe(`${LAUNCHER_PLATE.h}px`);
    // A finger on it carries it, as one on his figure does, rather than scrolling.
    expect(plate).toHaveClass("touch-none");

    await startFigure();
    expect(screen.getByTestId("mascot-sprite")).toBeInTheDocument();
    expect(amrButton()).toBe(plate);
    expect(plate).not.toHaveAttribute("data-launcher");
    expect(plate).not.toHaveClass("comic-name-plate");
  });
});

describe("getting his figure back", () => {
  it("tries it again 2, 4 and 8 s after it fails, and no more than 3 times", async () => {
    expect(FIGURE_RETRY_MS).toEqual([2000, 4000, 8000]);
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    expect(sheet.mounts).toBe(1);
    expect(amrButton()).toHaveAttribute("data-launcher");

    for (let i = 0; i < FIGURE_RETRY_MS.length; i++) {
      const wait = FIGURE_RETRY_MS[i];
      await pass(wait - 1);
      expect(sheet.mounts, `before try ${i + 1}`).toBe(i + 1);
      await pass(1);
      expect(sheet.mounts, `try ${i + 1}`).toBe(i + 2);
      // It failed again: the plate still stands in for him.
      expect(amrButton()).toHaveAttribute("data-launcher");
    }

    await pass(10 * 60_000);
    expect(sheet.mounts).toBe(4);
  });

  it("brings him back on the try that works", async () => {
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    sheet.fail = false;
    await pass(FIGURE_RETRY_MS[0]);
    expect(sheet.mounts).toBe(2);
    expect(amrButton()).not.toHaveAttribute("data-launcher");
    expect(screen.getByTestId("mascot-sprite")).toBeInTheDocument();
  });

  it("holds a try that falls due offline, spending none, until the browser is back online", async () => {
    online = false;
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    await pass(FIGURE_RETRY_MS[0]);
    await pass(60_000);
    expect(sheet.mounts).toBe(1);

    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await pass(0);
    expect(sheet.mounts).toBe(2);
    // The held try was the first: the next still waits 4 s.
    await pass(FIGURE_RETRY_MS[1] - 1);
    expect(sheet.mounts).toBe(2);
    await pass(1);
    expect(sheet.mounts).toBe(3);
  });

  it("holds a try that falls due in a hidden tab until the tab shows again", async () => {
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    visibility = "hidden";
    await pass(FIGURE_RETRY_MS[0]);
    await pass(60_000);
    expect(sheet.mounts).toBe(1);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pass(0);
    expect(sheet.mounts).toBe(2);
  });

  it("tries at once when the plate is tapped, which still opens his panel, and spends no try of its own", async () => {
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    await pass(500);
    expect(sheet.mounts).toBe(1);

    fireEvent.click(amrButton(), { detail: 1 });
    await pass(0);
    expect(sheet.mounts).toBe(2);
    expect(useAgentStore.getState().open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Amr" })).toBeInTheDocument();

    // The tap's try failed too; the first try of its own still waits its 2 s.
    await pass(FIGURE_RETRY_MS[0] - 1);
    expect(sheet.mounts).toBe(2);
    await pass(1);
    expect(sheet.mounts).toBe(3);
  });

  it("still tries when the plate is tapped after its own tries are spent", async () => {
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    await startFigure();
    for (const wait of FIGURE_RETRY_MS) await pass(wait);
    expect(sheet.mounts).toBe(4);

    sheet.fail = false;
    fireEvent.click(amrButton(), { detail: 1 });
    await pass(0);
    expect(sheet.mounts).toBe(5);
    expect(amrButton()).not.toHaveAttribute("data-launcher");
  });

  it("imports his figure's code again when its chunk failed to load", async () => {
    // The failure is on purpose: keep React's and jsdom's reports of it quiet.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    onTestFinished(() => window.removeEventListener("error", quiet));
    sheet.fail = false;
    const load = vi
      .fn<LoadSprite>()
      .mockRejectedValueOnce(new Error("Loading chunk mascot-sprite failed"))
      .mockResolvedValue(SPRITE);
    render(
      <>
        <main>Retro board</main>
        <MascotAssistant loadSprite={load} />
      </>
    );
    await startFigure();
    await pass(0);
    expect(load).toHaveBeenCalledTimes(1);
    // The failed chunk stops at his figure: the plate stands in, the page carries on.
    expect(amrButton()).toHaveAttribute("data-launcher");
    expect(screen.getByText("Retro board")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();

    await pass(FIGURE_RETRY_MS[0]);
    await pass(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mascot-sprite")).toBeInTheDocument();
    expect(amrButton()).not.toHaveAttribute("data-launcher");
  });
});

describe("his space on a phone", () => {
  const band = () =>
    parseInt(
      document.documentElement.style.getPropertyValue("--amr-band-bottom").match(/\d+/)![0],
      10
    );

  it("keeps his figure's height while a try is to come, and the plate's once none is left", async () => {
    stubScreen(true);
    render(<MascotAssistant loadSprite={spriteLoader()} />);
    const figureBand = band();
    expect(figureBand).toBeGreaterThan(80);

    await startFigure();
    for (const wait of FIGURE_RETRY_MS) {
      expect(band()).toBe(figureBand);
      await pass(wait);
    }
    // The last try failed: only the plate is left, and the band fits it.
    expect(band()).toBe(LAUNCHER_PLATE.h + 2 * BUTTON_INSET);
  });
});
