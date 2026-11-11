/**
 * The head script that decides a comic intro before the first paint. It runs
 * here as the browser runs it: the exact string app/layout.tsx inlines.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTRO_ATTR,
  INTRO_BOOT_SCRIPT,
  INTRO_END_EVENT,
  INTRO_KINDS,
  INTRO_PRELOAD,
  INTRO_RUN_ATTR,
  RETURN_ATTR,
  comicsIntroKind,
  introMarkKey,
  introSafetyMs,
  type IntroKind,
} from "@/lib/comics/intro";
import { COVER_INTRO_URL } from "@/lib/book/art";
import { VIP_HINT_COOKIE, VIP_HINT_VALUE } from "@/lib/vip/constants";

const root = document.documentElement;
const HINT = `${VIP_HINT_COOKIE}=${VIP_HINT_VALUE}`;

function setCookie(value: string) {
  Object.defineProperty(document, "cookie", { get: () => value, configurable: true });
}

function setMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function setConnection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", { value, configurable: true });
}

/** Load `address` and run the head script, as a fresh page load would. */
function boot(address: string): string | null {
  window.history.replaceState(null, "", address);
  new Function(INTRO_BOOT_SCRIPT)();
  return root.getAttribute(INTRO_ATTR);
}

/** An overlay of `kind` with its Skip button and a child that animates too. */
function mountOverlay(kind: IntroKind) {
  document.body.innerHTML = `
    <div data-intro-overlay="${kind}">
      <span data-testid="child"></span>
      <button type="button" data-intro-skip="">Skip intro</button>
    </div>
    <button type="button" data-testid="page-button">Page</button>`;
  return {
    overlay: document.querySelector(`[data-intro-overlay="${kind}"]`) as HTMLElement,
    child: document.querySelector('[data-testid="child"]') as HTMLElement,
    skip: document.querySelector("[data-intro-skip]") as HTMLButtonElement,
  };
}

/** The images the head script asked the browser to fetch early. */
function preloads(): string[] {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')).map(
    (link) => `${link.getAttribute("as")} ${link.getAttribute("href")}`
  );
}

beforeEach(() => {
  document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
  localStorage.clear();
  setCookie("");
  setMotion(false);
  setConnection(undefined);
  document.body.innerHTML = "";
});

afterEach(() => {
  root.removeAttribute(INTRO_ATTR);
  root.removeAttribute(INTRO_RUN_ATTR);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("which intro an address plays", () => {
  // The book's QR (page 161 and the back cover), the open kudos cards', and
  // anyone typing the address all land on the episode list.
  it.each([
    "/comics",
    "/comics?src=book",
    "/comics?src=kudos",
    "/comics?utm_source=newsletter",
    "/comics?ep=abc",
    "/comics?ep=01&ep=02",
  ])("plays the book's on the episode list, at %s", (address) => {
    expect(boot(address)).toBe("book");
  });

  it.each([
    "/comics?ep=12&src=poster",
    "/comics?ep=01&src=poster",
    "/comics?ep=26&src=kudos",
    "/comics?src=kudos&ep=7",
    "/comics?ep=12&src=poster&utm_source=qr",
    // The building posters printed `b` and no `src`.
    "/comics?ep=12&b=03",
    "/comics?b=5&ep=26",
  ])("plays the poster's when a poster or kudos card opens a book episode, at %s", (address) => {
    expect(boot(address)).toBe("poster");
  });

  it.each([
    "/comics?ep=12",
    "/comics?ep=12&src=comics",
    "/comics?ep=12&src=billboard",
    "/comics?ep=12&src=poster&src=kudos",
    "/comics?ep=30&src=poster",
    "/comics/early",
    "/comics/license",
    "/kudos?src=sign",
    "/",
    "/retro",
    "/vip",
  ])("plays nothing at %s", (address) => {
    expect(boot(address)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("is comicsIntroKind, run in the browser", () => {
    const queries = [
      "",
      "src=book",
      "ep=12&src=poster",
      "ep=12&src=kudos",
      "ep=12&src=comics",
      "ep=12&b=03",
      "ep=12&b=",
      "ep=12&src=&b=1",
      "ep=27&src=poster",
      "ep=26&src=kudos",
      "ep=012&src=poster",
      "ep=&src=poster",
      "ep=9&src=poster&src=poster",
      "src=poster",
      "b=1",
    ];
    for (const query of queries) {
      localStorage.clear();
      root.removeAttribute(INTRO_ATTR);
      const address = query ? `/comics?${query}` : "/comics";
      expect(boot(address), query).toBe(comicsIntroKind(new URLSearchParams(query)));
    }
  });

  it("plays VIP at /vip only on a device the book's link unlocked", () => {
    setCookie(`theme=1; ${HINT}`);
    expect(boot("/vip")).toBe("vip");
  });

  it("plays nothing at /vip for a link that didn't work", () => {
    setCookie(HINT);
    expect(boot("/vip?link=invalid")).toBeNull();
  });

  it("isn't fooled by a cookie that only contains the hint's name", () => {
    setCookie(`x${HINT}; ${VIP_HINT_COOKIE}=0`);
    expect(boot("/vip")).toBeNull();
  });
});

describe("once per device", () => {
  it("plays once, then never again on this device", () => {
    expect(boot("/comics")).toBe("book");
    expect(localStorage.getItem(introMarkKey("book"))).toBe("1");
    root.removeAttribute(INTRO_ATTR);
    expect(boot("/comics")).toBeNull();
  });

  it("remembers each kind on its own", () => {
    expect(boot("/comics")).toBe("book");
    root.removeAttribute(INTRO_ATTR);
    expect(boot("/comics?ep=4&b=2")).toBe("poster");
    root.removeAttribute(INTRO_ATTR);
    // One poster's intro is every poster's.
    expect(boot("/comics?ep=5&b=7")).toBeNull();
  });

  it("keeps its marks under the prefix Clear data removes", () => {
    for (const kind of INTRO_KINDS)
      expect(introMarkKey(kind).startsWith("agile-toolkit:")).toBe(true);
  });

  it("plays nothing when storage throws, since it couldn't remember", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(boot("/comics")).toBeNull();
  });

  it("plays nothing when the mark can't be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(boot("/comics")).toBeNull();
  });
});

describe("who gets no intro", () => {
  it("skips it for reduced motion, and doesn't use up the mark", () => {
    setMotion(true);
    expect(boot("/comics")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("skips it with Data Saver on", () => {
    setConnection({ saveData: true });
    expect(boot("/comics?ep=12&b=3")).toBeNull();
  });

  it("skips it on a 2G connection", () => {
    setConnection({ saveData: false, effectiveType: "slow-2g" });
    expect(boot("/comics")).toBeNull();
  });

  it("plays it on a normal connection", () => {
    setConnection({ saveData: false, effectiveType: "4g" });
    expect(boot("/comics")).toBe("book");
  });

  it("keeps it for later when the page loads in a background tab", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(boot("/comics")).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe("what it fetches early", () => {
  it("preloads the book's cover when the book intro plays", () => {
    expect(INTRO_PRELOAD).toEqual({ book: COVER_INTRO_URL });
    expect(boot("/comics")).toBe("book");
    expect(preloads()).toEqual([`image ${COVER_INTRO_URL}`]);
  });

  it("preloads nothing once the book intro has been seen", () => {
    localStorage.setItem(introMarkKey("book"), "1");
    expect(boot("/comics")).toBeNull();
    expect(preloads()).toEqual([]);
  });

  it("preloads nothing under reduced motion", () => {
    setMotion(true);
    expect(boot("/comics")).toBeNull();
    expect(preloads()).toEqual([]);
  });

  it("preloads nothing for a poster's intro, whose panels load from the page", () => {
    expect(boot("/comics?ep=01&b=01")).toBe("poster");
    expect(preloads()).toEqual([]);
  });
});

describe("ending an intro", () => {
  it("ends on Skip", () => {
    const { skip } = mountOverlay("book");
    boot("/comics");
    skip.click();
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("ends on Escape", () => {
    mountOverlay("book");
    boot("/comics");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("keeps Tab on Skip while it plays", () => {
    const { skip } = mountOverlay("book");
    boot("/comics");
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(skip);
  });

  it("leaves keys alone when nothing plays", () => {
    mountOverlay("book");
    localStorage.setItem(introMarkKey("book"), "1");
    boot("/comics");
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("ends when the overlay's own animation does, not a child's", () => {
    const { overlay, child } = mountOverlay("poster");
    boot("/comics?ep=12&b=3");
    child.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(root.getAttribute(INTRO_ATTR)).toBe("poster");
    overlay.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("gives focus back to the page when it ends", () => {
    const { skip } = mountOverlay("book");
    boot("/comics");
    skip.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(document.body);
  });

  it.each(["Skip", "Escape", "the overlay's animation"])(
    "gives focus back to what started a replay, on %s",
    (how) => {
      const { overlay, skip } = mountOverlay("book");
      boot("/comics");
      const opener = document.querySelector<HTMLElement>('[data-testid="page-button"]')!;
      opener.setAttribute(RETURN_ATTR, "");
      skip.focus();
      if (how === "Skip") skip.click();
      else if (how === "Escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } else overlay.dispatchEvent(new Event("animationend", { bubbles: true }));
      expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
      expect(document.activeElement).toBe(opener);
      expect(opener.hasAttribute(RETURN_ATTR)).toBe(false);
    }
  );

  it("tells the page it ended before it gives focus back, so the page can stop being inert first", () => {
    const { skip } = mountOverlay("book");
    boot("/comics");
    const opener = document.querySelector<HTMLElement>('[data-testid="page-button"]')!;
    opener.setAttribute(RETURN_ATTR, "");
    const order: string[] = [];
    const onEnd = () => order.push(`${INTRO_END_EVENT}, playing: ${root.hasAttribute(INTRO_ATTR)}`);
    document.addEventListener(INTRO_END_EVENT, onEnd);
    vi.spyOn(opener, "focus").mockImplementation(() => order.push("focus"));
    try {
      skip.click();
    } finally {
      document.removeEventListener(INTRO_END_EVENT, onEnd);
    }
    expect(order).toEqual([`${INTRO_END_EVENT}, playing: false`, "focus"]);
  });

  it("ends by itself if the animation never reports its end", () => {
    vi.useFakeTimers();
    mountOverlay("vip");
    setCookie(HINT);
    boot("/vip");
    vi.advanceTimersByTime(introSafetyMs("vip") - 1);
    expect(root.getAttribute(INTRO_ATTR)).toBe("vip");
    vi.advanceTimersByTime(1);
    expect(root.hasAttribute(INTRO_ATTR)).toBe(false);
  });

  it("doesn't let the arrival's timer end a later play", () => {
    vi.useFakeTimers();
    mountOverlay("book");
    boot("/comics");
    root.setAttribute(INTRO_RUN_ATTR, "1");
    vi.advanceTimersByTime(introSafetyMs("book"));
    expect(root.getAttribute(INTRO_ATTR)).toBe("book");
  });
});

describe("where it runs", () => {
  it("is inlined in <head> by the root layout, after the theme", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const theme = layout.indexOf("__html: THEME_BOOT_SCRIPT");
    const intro = layout.indexOf("__html: INTRO_BOOT_SCRIPT");
    expect(theme).toBeGreaterThan(-1);
    expect(intro).toBeGreaterThan(theme);
    expect(intro).toBeLessThan(layout.indexOf("</head>"));
  });

  it("is plain enough to parse on its own", () => {
    expect(() => new Function(INTRO_BOOT_SCRIPT)).not.toThrow();
  });
});
