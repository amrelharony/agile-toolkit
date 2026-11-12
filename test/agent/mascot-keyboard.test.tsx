import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The phone's keyboard and Amr's chat (design §1.3 item 9, chat revamp PR 8;
 * audits phone-keyboard-covers-composer, owner-chat-clips-when-short).
 *
 * The keyboard shrinks only the visual viewport (iOS Safari, Chrome Android),
 * so the shell reads it in one animation frame while the panel is open and
 * writes where the panel goes as CSS variables: the sheet (or the side panel)
 * stops above the keyboard, and with the keyboard up, or little room, goes
 * compact, from just under the top of what can be seen. Docked Amr rides the
 * keyboard beside the composer while it has focus, and never stands on Send.
 *
 * jsdom lays nothing out, so the panel's box is the one the shell wrote, and
 * what sits in it is placed from the panel's own structure: its line and
 * padding (FRAME), its header row (52 px, 44 compact) with Close in it, and
 * the composer's block at its foot.
 */

const h = vi.hoisted(() => ({
  auth: { status: "authenticated", user: { id: "owner-1" } } as {
    status: string;
    user: { id: string } | null;
  },
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuthOptional: () => h.auth,
  useAuth: () => ({ user: h.auth?.user ?? null }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/retro" }));
vi.mock("@/lib/agent/client", () => ({
  abortInFlight: vi.fn(),
  sendUserMessage: vi.fn(async () => {}),
  generateTitle: vi.fn(async () => null),
  retryLastTurn: vi.fn(async () => true),
  goOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => false),
}));
vi.mock("@/lib/agent/persist", () => ({
  listConversations: vi.fn(async () => []),
  loadMessages: vi.fn(async () => []),
  deleteConversation: vi.fn(async () => {}),
  renameConversation: vi.fn(async () => {}),
  createConversation: vi.fn(async () => null),
  conversationTitle: (t: string) => t,
  conversationToMarkdown: () => "",
  titleSlug: () => "thread",
}));
vi.mock("@/lib/auth/supabase-browser", () => ({ getAuthBrowserClient: () => null }));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: ({ width, height }: { width?: number; height?: number }) => (
    <div data-testid="mascot-sprite" data-w={width} data-h={height} />
  ),
}));
vi.mock("@/components/agent/mascot/rate-limit-bar", () => ({ RateLimitBar: () => null }));

// Loaded here, so the owner's chunk is ready when the panel opens.
import "@/components/agent/mascot/owner-agent-panel";
import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import {
  COMPACT_TOP,
  DOCK_INSET,
  FEET_TRIM,
  HIT_SIDE,
  MASCOT_BOX_PHONE,
} from "@/components/agent/mascot/amr-geometry";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "@/components/agent/mascot/engine/figure-metrics";
import { COMPACT_HIDDEN, COMPACT_LOG, DOCK_END } from "@/components/agent/mascot/panel-context";
import { listConversations } from "@/lib/agent/persist";
import { VISIBLE_GAP } from "@/lib/layout/use-visible-area";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";

// ── The screen ───────────────────────────────────────────────────────────

/** The visual viewport, as a phone reports it: resize events as the keyboard moves. */
class StubViewport extends EventTarget {
  width = 0;
  height = 0;
  offsetTop = 0;
  offsetLeft = 0;
  scale = 1;
}
let vv: StubViewport;
let safe = { top: 0, bottom: 0 };

/**
 * A screen `w` by `h`: its header ending `header` px down (any notch above it
 * included), the safe areas given, a touch screen, phone width or not.
 */
function screenAt(
  w: number,
  h: number,
  opts: { insetTop?: number; insetBottom?: number; header?: number } = {}
) {
  window.innerWidth = w;
  window.innerHeight = h;
  vv = new StubViewport();
  vv.width = w;
  vv.height = h;
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  safe = { top: opts.insetTop ?? 0, bottom: opts.insetBottom ?? 0 };
  const bottom = opts.header ?? 56;
  const header = document.createElement("header");
  header.setAttribute("data-chrome", "header");
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
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width")
      ? w <= Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
      : query.includes("coarse"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/**
 * The keyboard as iOS and Chrome report it: only the visual viewport shrinks,
 * by `kb`; `pan` is how far iOS has panned it down to the focused field.
 */
function keyboard(kb: number, pan = 0) {
  vv.offsetTop = pan;
  vv.height = window.innerHeight - pan - kb;
  vv.dispatchEvent(new Event("resize"));
}

/** Let the viewport listener's animation frame run. */
const frames = () => act(() => new Promise((r) => setTimeout(r, 20)));

// ── The panel ────────────────────────────────────────────────────────────

const dialog = () => screen.getByRole("dialog", { name: "Amr" });
const amr = () => screen.getByRole("button", { name: "Ask Amr" });
const composer = () => screen.getByLabelText("Message");
/** A CSS variable the shell wrote on an element, in px. */
const px = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name));

/** The panel's line (--panel-w, 2 px) and its inner frame's padding (p-1.5). */
const FRAME = 2 + 6;
/** Close is 44 px on a touch screen, in a header row of 52 px, or 44 compact. */
const CLOSE = 44;
/**
 * The composer's block at the panel's foot, from the panel's bottom edge: the
 * frame, the chat's py-2, the key hint (gone compact) and the row of the box
 * (two lines) and Send.
 */
function composerBlock(compact: boolean): number {
  const hint = compact ? 0 : 6 + 16;
  return FRAME + 8 + hint + 58;
}

/** The panel's box, as the shell placed it: px from the top of the layout viewport. */
function panelBox(): { top: number; bottom: number } {
  const panel = dialog();
  return {
    top: px(panel, "--amr-vv-top"),
    bottom: window.innerHeight - px(panel, "--amr-vv-bottom"),
  };
}

/** What can be seen: the visual viewport, in the layout viewport's px. */
function seen(): { top: number; bottom: number } {
  return { top: vv.offsetTop, bottom: vv.offsetTop + vv.height };
}

async function openChat(): Promise<HTMLElement> {
  render(<MascotAssistant />);
  act(() => {
    window.dispatchEvent(new Event("pointerdown"));
  });
  await screen.findByTestId("mascot-sprite", {}, { timeout: 2000 });
  fireEvent.click(amr(), { detail: 1 });
  const box = await screen.findByLabelText("Message");
  await frames();
  return box;
}

beforeEach(() => {
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = () => {};
  }
  window.history.replaceState(null, "", "/retro");
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  useMascotStore.setState({ ready: true });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0))
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const cs = real(el, pseudo);
    if (!(el instanceof HTMLElement) || !el.hasAttribute("data-amr-inset-probe")) return cs;
    const used: Record<string, string> = {
      paddingTop: `${safe.top}px`,
      paddingBottom: `${safe.bottom}px`,
      paddingLeft: "0px",
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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  useMascotStore.setState({ ready: false });
  document.body.replaceChildren();
  delete (window as { visualViewport?: unknown }).visualViewport;
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

// ── Close and the composer in view ───────────────────────────────────────

describe("Close and the composer stay inside what can be seen", () => {
  const cases = [
    {
      name: "375x812 with a notch and a home indicator (34), no keyboard",
      w: 375,
      h: 812,
      insetTop: 44,
      insetBottom: 34,
      header: 100,
      kb: 0,
      pan: 0,
      layout: "sheet",
      compact: false,
    },
    {
      name: "375x812 with a notch and a home indicator (34), its 336 px keyboard up",
      w: 375,
      h: 812,
      insetTop: 44,
      insetBottom: 34,
      header: 100,
      kb: 336,
      pan: 0,
      layout: "sheet",
      compact: true,
    },
    {
      name: "375x812, the keyboard up and the page panned 120 px down to the field",
      w: 375,
      h: 812,
      insetTop: 44,
      insetBottom: 34,
      header: 100,
      kb: 336,
      pan: 120,
      layout: "sheet",
      compact: true,
    },
    {
      name: "844x390 landscape, a 200 px keyboard",
      w: 844,
      h: 390,
      insetTop: 0,
      insetBottom: 0,
      header: 56,
      kb: 200,
      pan: 0,
      layout: "side",
      compact: true,
    },
    {
      name: "375x667, a 300 px keyboard",
      w: 375,
      h: 667,
      insetTop: 0,
      insetBottom: 0,
      header: 56,
      kb: 300,
      pan: 0,
      layout: "sheet",
      compact: true,
    },
  ] as const;

  for (const c of cases) {
    it(c.name, async () => {
      screenAt(c.w, c.h, { insetTop: c.insetTop, insetBottom: c.insetBottom, header: c.header });
      const box = await openChat();
      act(() => box.focus());
      keyboard(c.kb, c.pan);
      await frames();

      const panel = dialog();
      expect(panel).toHaveAttribute("data-amr-layout", c.layout);
      expect(panel.hasAttribute("data-amr-compact")).toBe(c.compact);
      const { top, bottom } = panelBox();
      const view = seen();
      // The panel itself is inside what can be seen, above the keyboard.
      expect(top).toBeGreaterThanOrEqual(view.top);
      expect(bottom).toBeLessThanOrEqual(view.bottom);
      expect(px(panel, "--amr-kb")).toBe(c.kb);
      // Compact: from just under the top of what can be seen, over the header.
      if (c.compact) expect(top).toBe(Math.max(c.insetTop, c.pan) + COMPACT_TOP);
      else expect(top).toBe(c.header + VISIBLE_GAP);

      // Close, in the header row at the top...
      const close = within(panel).getByRole("button", { name: "Close assistant" });
      const closeTop = top + FRAME + ((c.compact ? 44 : 52) - CLOSE) / 2;
      expect(closeTop).toBeGreaterThanOrEqual(view.top);
      expect(closeTop + CLOSE).toBeLessThanOrEqual(view.bottom);
      expect(close).toBeVisible();
      // ...and the composer and Send at the foot, both seen at once.
      const composerTop = bottom - composerBlock(c.compact);
      expect(composerTop).toBeGreaterThanOrEqual(closeTop + CLOSE);
      expect(bottom - FRAME).toBeLessThanOrEqual(view.bottom);
      expect(within(panel).getByRole("button", { name: "Send" })).toBeInTheDocument();
    });
  }
});

// ── Compact mode ─────────────────────────────────────────────────────────

describe("compact mode", () => {
  it("comes with the keyboard and goes with it: one header row, its chrome folded, the ground the one scroller", async () => {
    screenAt(375, 667);
    const box = await openChat();
    const panel = dialog();
    expect(panel).not.toHaveAttribute("data-amr-compact");

    act(() => box.focus());
    keyboard(300);
    await frames();
    expect(panel).toHaveAttribute("data-amr-compact");
    // The views read the attribute: nothing re-renders for it.
    const header = panel.querySelector<HTMLElement>("[data-panel-header]")!;
    expect(header.className).toContain("group-data-[amr-compact]/amr:min-h-11");
    // The one row keeps every control: the view's icons and More stay, only
    // the subtitle's line waits.
    expect(within(panel).getByRole("button", { name: "More" })).not.toHaveClass(COMPACT_HIDDEN);
    expect(panel.querySelector('[data-panel-slot="actions"]') as HTMLElement).not.toHaveClass(
      COMPACT_HIDDEN
    );
    expect(panel.querySelector('[data-panel-slot="subtitle"]')!.parentElement).toHaveClass(
      COMPACT_HIDDEN
    );
    expect(screen.getByText(/Amr asks before deleting or resetting anything/)).toHaveClass(
      COMPACT_HIDDEN
    );
    expect(screen.getByRole("log", { name: "Conversation" })).toHaveClass(COMPACT_LOG);
    const ground = header.nextElementSibling as HTMLElement;
    expect(ground.className).toContain("group-data-[amr-compact]/amr:overflow-y-auto");
    // Close and the plate stay in the one row.
    expect(within(header).getByRole("button", { name: "Close assistant" })).not.toHaveClass(
      COMPACT_HIDDEN
    );
    expect(within(header).getByRole("heading", { name: "Amr" })).toBeInTheDocument();

    act(() => box.blur());
    keyboard(0);
    await frames();
    expect(panel).not.toHaveAttribute("data-amr-compact");
    expect(panelBox().top).toBe(56 + VISIBLE_GAP);
  });

  it("comes with little room to see, keyboard or none: under 360 px", async () => {
    // A banner over the header: 520 - (150 + 8) - 8 = 354 px in the box.
    screenAt(375, 520, { header: 150 });
    await openChat();
    expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");
    expect(dialog()).toHaveAttribute("data-amr-compact");
    expect(px(dialog(), "--amr-visible-h")).toBe(354);
  });

  it("never comes to the floating card", async () => {
    screenAt(1024, 768);
    const box = await openChat();
    act(() => box.focus());
    keyboard(300);
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-layout", "float");
    expect(dialog()).not.toHaveAttribute("data-amr-compact");
    expect(amr()).not.toHaveAttribute("data-amr-compact");
  });

  /** Neither the element nor any ancestor in the panel waits while compact. */
  function inReach(el: HTMLElement) {
    for (let at: HTMLElement | null = el; at && at !== dialog(); at = at.parentElement) {
      expect(at).not.toHaveClass(COMPACT_HIDDEN);
    }
  }

  for (const s of [
    { w: 812, h: 375, name: "a landscape phone (812x375)", coarse: true },
    { w: 640, h: 360, name: "a desktop at 200% zoom (640x360, a fine pointer)", coarse: false },
  ]) {
    it(`keeps History, New chat and More in reach on ${s.name}, compact with no keyboard`, async () => {
      screenAt(s.w, s.h);
      if (!s.coarse) {
        const coarse = window.matchMedia;
        vi.stubGlobal("matchMedia", (query: string) => ({
          ...coarse(query),
          matches: query.includes("coarse") ? false : coarse(query).matches,
        }));
      }
      await openChat();
      const panel = dialog();
      expect(panel).toHaveAttribute("data-amr-layout", "side");
      expect(panel).toHaveAttribute("data-amr-compact");
      const header = panel.querySelector<HTMLElement>("[data-panel-header]")!;
      for (const name of ["Conversation history", "New chat", "More", "Close assistant"]) {
        inReach(within(header).getByRole("button", { name }));
      }
    });
  }

  it("keeps History's way back in reach while its search has the keyboard", async () => {
    const { listConversations } = await import("@/lib/agent/persist");
    const stamp = new Date(0).toISOString();
    vi.mocked(listConversations).mockResolvedValueOnce(
      [1, 2, 3, 4].map((n) => ({
        id: `c${n}`,
        title: `Thread ${n}`,
        toolId: null,
        createdAt: stamp,
        updatedAt: stamp,
        lastMessageAt: stamp,
      }))
    );
    screenAt(375, 667);
    await openChat();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Conversation history" }));
    const search = await screen.findByLabelText("Search conversations");
    act(() => search.focus());
    keyboard(300);
    await frames();
    expect(dialog()).toHaveAttribute("data-amr-compact");
    inReach(within(dialog()).getByRole("button", { name: "Back to chat" }));
  });
});

// ── The compact panel's layer ────────────────────────────────────────────

describe("the compact panel over the site header", () => {
  /** The class that lifts an element to the header's layer while it is marked compact. */
  const LIFT = "data-[amr-compact]:z-header";

  /** Both are lifted while compact, and only then: Amr still above the panel. */
  function expectLifted(lifted: boolean) {
    for (const el of [dialog(), amr()]) {
      expect(el.className).toContain(LIFT);
      expect(el.className).toContain("z-50");
      expect(el.hasAttribute("data-amr-compact")).toBe(lifted);
    }
    // He comes after the panel in the page: at the same layer, he is drawn over it.
    expect(dialog().compareDocumentPosition(amr()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  it("takes the header's layer in the sheet while the keyboard is up, with Amr, and gives it back", async () => {
    screenAt(375, 667);
    const box = await openChat();
    expectLifted(false);
    act(() => box.focus());
    keyboard(300);
    await frames();
    expectLifted(true);
    act(() => box.blur());
    keyboard(0);
    await frames();
    expectLifted(false);

    // Closed: his button keeps no mark.
    act(() => box.focus());
    keyboard(300);
    await frames();
    act(() => useAgentStore.getState().closeSheet());
    expect(amr()).not.toHaveAttribute("data-amr-compact");
  });

  it("takes it down the side of a landscape phone, keyboard or none", async () => {
    screenAt(844, 390);
    const box = await openChat();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");
    expectLifted(true);
    act(() => box.focus());
    keyboard(200);
    await frames();
    expectLifted(true);
  });

  it("publishes the toast stack's top under the compact sheet's header row, and takes it away", async () => {
    screenAt(375, 812, { insetTop: 44, insetBottom: 34, header: 100 });
    const html = document.documentElement;
    const box = await openChat();
    expect(html.style.getPropertyValue("--amr-toast-top")).toBe("");
    act(() => box.focus());
    keyboard(336, 120);
    await frames();
    // From the compact sheet's own top (the pan's, here), past its one row.
    const top = px(dialog(), "--amr-vv-top");
    expect(top).toBe(120 + COMPACT_TOP);
    expect(html.style.getPropertyValue("--amr-toast-top")).toBe(
      `calc(${top}px + var(--panel-w, 2px) + 0.375rem + 2.75rem + var(--line-w, 1px) + 8px)`
    );
    expect(html).not.toHaveAttribute("data-amr-toasts-held");

    // The keyboard goes: over the site header again (the toaster's own fallback).
    act(() => box.blur());
    keyboard(0);
    await frames();
    expect(html.style.getPropertyValue("--amr-toast-top")).toBe("");

    act(() => box.focus());
    keyboard(336);
    await frames();
    expect(html.style.getPropertyValue("--amr-toast-top")).not.toBe("");
    act(() => useAgentStore.getState().closeSheet());
    expect(html.style.getPropertyValue("--amr-toast-top")).toBe("");
  });

  it("publishes the room beside the side panel for a toast, and holds what can wait where there is none", async () => {
    const html = document.documentElement;
    screenAt(844, 390);
    await openChat();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");
    // 844 less his side, the panel's offset and width, the far gutter and the gap.
    const inline = px(dialog(), "--amr-vv-inline");
    const width = px(dialog(), "--amr-vv-width");
    expect(px(html, "--amr-toast-room")).toBeCloseTo(844 - inline - width - 8 - 8, 1);
    expect(html).not.toHaveAttribute("data-amr-toasts-held");
    act(() => useAgentStore.getState().closeSheet());
    expect(html.style.getPropertyValue("--amr-toast-room")).toBe("");
    cleanup();
    document.body.replaceChildren();

    // 667x375: some 120 px beside it, too little for a toast.
    screenAt(667, 375);
    await openChat();
    expect(dialog()).toHaveAttribute("data-amr-layout", "side");
    expect(html.style.getPropertyValue("--amr-toast-room")).toBe("");
    expect(html).toHaveAttribute("data-amr-toasts-held");
    act(() => useAgentStore.getState().closeSheet());
    expect(html).not.toHaveAttribute("data-amr-toasts-held");
  });

  it("leans on the header's token and on the shell's order: the header first, then Amr", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = process.cwd();
    const config = fs.readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
    // The header's layer is the panel's when compact: under the nav drawer
    // (z-[101] and z-[102]) and the toast layer.
    const header = Number(/\bheader:\s*"(\d+)"/.exec(config)![1]);
    const toast = Number(/\btoast:\s*"(\d+)"/.exec(config)![1]);
    expect(header).toBe(100);
    expect(header).toBeLessThan(101);
    expect(toast).toBeGreaterThan(header);
    const shell = fs.readFileSync(path.join(root, "src/components/layout/app-shell.tsx"), "utf8");
    const headerAt = shell.indexOf("<Header");
    const amrAt = shell.indexOf("<MascotAssistant");
    expect(headerAt).toBeGreaterThan(-1);
    expect(amrAt).toBeGreaterThan(headerAt);
  });
});

// ── The docked Amr ───────────────────────────────────────────────────────

describe("docked Amr and the keyboard", () => {
  const scale = MASCOT_BOX_PHONE.h / SHEET.cellH;

  it("rides the keyboard beside the composer while it has focus, and stays when it hasn't", async () => {
    screenAt(375, 667);
    const box = await openChat();
    const button = amr();
    expect(button).toHaveAttribute("data-amr-docked");
    const rest = px(button, "--amr-dock-bottom");
    expect(rest).toBeCloseTo(VISIBLE_GAP + DOCK_INSET - FEET_TRIM * scale, 1);

    act(() => box.focus());
    keyboard(300);
    await frames();
    // His feet stand DOCK_INSET above the sheet's bottom edge, above the keyboard.
    const riding = px(button, "--amr-dock-bottom");
    expect(riding).toBeCloseTo(300 + VISIBLE_GAP + DOCK_INSET - FEET_TRIM * scale, 1);
    const feet = 667 - riding - FEET_TRIM * scale;
    expect(feet).toBeLessThanOrEqual(seen().bottom);
    // His figure is drawn at his phone size, never scaled to fit.
    expect(screen.getByTestId("mascot-sprite")).toHaveAttribute("data-w", "96");
    expect(screen.getByTestId("mascot-sprite")).toHaveAttribute("data-h", "104");

    // The composer lets go (the keyboard still closing): he goes back down.
    act(() => box.blur());
    await frames();
    expect(px(button, "--amr-dock-bottom")).toBeCloseTo(rest, 2);
  });

  it("keeps the composer's keyboard up when a finger lands on him", async () => {
    screenAt(375, 667);
    const box = await openChat();
    const hit = amr().querySelector<HTMLElement>("[data-mascot-hit]")!;
    // Nothing typing has focus: his press is his own.
    expect(fireEvent.pointerDown(hit, { button: 0 })).toBe(true);
    fireEvent.pointerUp(document);
    act(() => box.focus());
    // The composer has focus: the press doesn't take it, so the keyboard stays.
    expect(fireEvent.pointerDown(hit, { button: 0 })).toBe(false);
    fireEvent.pointerUp(document);
    expect(box).toHaveFocus();
  });

  for (const w of [320, 360, 375]) {
    for (const side of ["right", "left"] as const) {
      for (const kb of [0, 300]) {
        it(`at ${w} px wide, docked ${side}, keyboard ${kb ? "up" : "down"}: Send's centre is never his`, async () => {
          screenAt(w, 667);
          const box = await openChat();
          if (side === "left") {
            act(() => amr().focus());
            fireEvent.keyDown(amr(), { key: "ArrowLeft" });
            await frames();
          }
          act(() => box.focus());
          keyboard(kb);
          await frames();
          const panel = dialog();
          const button = amr();
          expect(panel).toHaveAttribute("data-amr-dock", side);

          // The footer's inner edge on his side is his gutter's (the view's
          // padding, then the rest of the gutter), from the sheet's edge.
          const footer = composer().closest("form")!.parentElement!;
          const pad = side === "right" ? "pr" : "pl";
          expect(footer.className).toContain(
            `group-data-[amr-dock=${side}]/amr:${pad}-[calc(var(--amr-dock-gutter)-0.75rem)]`
          );
          const gutter = Number(
            /^calc\((\d+)px/.exec(panel.style.getPropertyValue("--amr-dock-gutter"))![1]
          );
          const left = px(panel, "--amr-vv-left");
          const right = w - px(panel, "--amr-vv-right");
          const inner = side === "right" ? right - gutter : left + gutter;
          // Send is the row's last control: at that edge docked right, at the
          // view's own padding (the frame and px-3) docked left.
          const sendRight = side === "right" ? inner : right - FRAME - 12;
          const sendX = sendRight - 22;
          const compact = panel.hasAttribute("data-amr-compact");
          const footBottom = 667 - px(panel, "--amr-vv-bottom") - FRAME - 8 - (compact ? 0 : 22);
          const sendY = footBottom - 22;

          // His figure, where the shell docked him.
          const dockBottom = px(button, "--amr-dock-bottom");
          const dockInline = px(button, "--amr-dock-inline");
          const boxSide = side === "right" ? w - dockInline - MASCOT_BOX_PHONE.w : dockInline;
          const hitBox = {
            left: boxSide + MASCOT_BOX_PHONE.w * HIT_SIDE,
            right: boxSide + MASCOT_BOX_PHONE.w * (1 - HIT_SIDE),
            top: 667 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_TOP * scale,
            bottom: 667 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_BOTTOM * scale,
          };
          const hit = button.querySelector<HTMLElement>("[data-mascot-hit]")!;
          const send = within(panel).getByRole("button", { name: "Send" });
          // The top element at a point: his hit span stands over the sheet.
          Object.defineProperty(document, "elementFromPoint", {
            configurable: true,
            value: (x: number, y: number) =>
              x >= hitBox.left && x <= hitBox.right && y >= hitBox.top && y <= hitBox.bottom
                ? hit
                : send,
          });
          try {
            // He stands beside the composer's row, level with Send...
            expect(sendY).toBeGreaterThan(hitBox.top);
            expect(sendY).toBeLessThan(hitBox.bottom);
            expect(document.elementFromPoint((hitBox.left + hitBox.right) / 2, sendY)).toBe(hit);
            // ...and a tap on Send's centre is Send's, never his, nor one at
            // the row's edge beside him.
            expect(document.elementFromPoint(sendX, sendY)).toBe(send);
            expect(document.elementFromPoint(sendX, sendY)).not.toBe(hit);
            const nearHim = side === "right" ? inner - 1 : inner + 1;
            expect(document.elementFromPoint(nearHim, sendY)).not.toBe(hit);
          } finally {
            delete (document as { elementFromPoint?: unknown }).elementFromPoint;
          }
        });
      }
    }
  }

  /** Twelve saved threads: more than History's list shows at once. */
  const threads = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    title: `Thread ${i}`,
    toolId: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    lastMessageAt: "2026-11-01T10:00:00.000Z",
  }));

  for (const w of [320, 375]) {
    for (const side of ["right", "left"] as const) {
      it(`at ${w} px wide, docked ${side}: History's list ends above him, so no row's action is his`, async () => {
        vi.mocked(listConversations).mockImplementation(async () => threads);
        try {
          screenAt(w, 667);
          await openChat();
          if (side === "left") {
            act(() => amr().focus());
            fireEvent.keyDown(amr(), { key: "ArrowLeft" });
            await frames();
          }
          fireEvent.click(within(dialog()).getByRole("button", { name: "Conversation history" }));
          const deletes = await within(dialog()).findAllByRole("button", {
            name: "Delete conversation",
          });
          expect(deletes).toHaveLength(threads.length);
          const panel = dialog();
          const button = amr();
          expect(panel).toHaveAttribute("data-amr-dock", side);

          // The list ends DOCK_END above the sheet's foot: the band beside him
          // is an empty footer, as tall as the composer's in the chat.
          const list = deletes[0].closest<HTMLElement>("[data-amr-scroll]")!;
          expect(list.className).toContain(DOCK_END);
          const footer = Number(
            /^calc\((\d+)px/.exec(panel.style.getPropertyValue("--amr-dock-footer"))![1]
          );
          const listBottom = 667 - px(panel, "--amr-vv-bottom") - footer;

          // His figure, where the shell docked him.
          const dockBottom = px(button, "--amr-dock-bottom");
          const dockInline = px(button, "--amr-dock-inline");
          const boxSide = side === "right" ? w - dockInline - MASCOT_BOX_PHONE.w : dockInline;
          const hitBox = {
            left: boxSide + MASCOT_BOX_PHONE.w * HIT_SIDE,
            right: boxSide + MASCOT_BOX_PHONE.w * (1 - HIT_SIDE),
            top: 667 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_TOP * scale,
            bottom: 667 - dockBottom - MASCOT_BOX_PHONE.h + FIGURE_BOTTOM * scale,
          };
          expect(listBottom).toBeLessThanOrEqual(hitBox.top);

          // The lowest row the list shows, whatever its scroll: its actions
          // sit at the row's end (px-2 in a px-2 list, 44 px each), and the
          // thread's own button at its start.
          const right = w - px(panel, "--amr-vv-right") - FRAME - 8 - 8;
          const left = px(panel, "--amr-vv-left") + FRAME + 8 + 8;
          const rowY = listBottom - 22;
          const deleteX = right - 22;
          const openX = left + 22;
          const hit = button.querySelector<HTMLElement>("[data-mascot-hit]")!;
          const row = deletes[deletes.length - 1];
          Object.defineProperty(document, "elementFromPoint", {
            configurable: true,
            value: (x: number, y: number) =>
              x >= hitBox.left && x <= hitBox.right && y >= hitBox.top && y <= hitBox.bottom
                ? hit
                : row,
          });
          try {
            expect(document.elementFromPoint(deleteX, rowY)).toBe(row);
            expect(document.elementFromPoint(openX, rowY)).toBe(row);
            // Not even at the very last pixel of the list, anywhere across it.
            for (let x = left; x <= right; x += 4) {
              expect(document.elementFromPoint(x, listBottom - 0.5)).not.toBe(hit);
            }
          } finally {
            delete (document as { elementFromPoint?: unknown }).elementFromPoint;
          }
        } finally {
          vi.mocked(listConversations).mockImplementation(async () => []);
        }
      });
    }
  }
});

// ── The listener ─────────────────────────────────────────────────────────

describe("the viewport listener", () => {
  it("listens only while the panel is open", async () => {
    screenAt(375, 667);
    render(<MascotAssistant />);
    const added = vi.spyOn(vv, "addEventListener");
    const removed = vi.spyOn(vv, "removeEventListener");
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(added).not.toHaveBeenCalled();

    act(() => useAgentStore.getState().openSheet({ via: "pointer" }));
    await screen.findByLabelText("Message");
    expect(added.mock.calls.map((c) => c[0]).sort()).toEqual(["resize", "scroll"]);

    act(() => useAgentStore.getState().closeSheet());
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(["resize", "scroll"]);
  });

  it("reads a burst of viewport events in one frame, and a rising keyboard re-renders nothing past keyboardUp", async () => {
    screenAt(375, 667);
    const rendered = vi.fn();
    render(
      <Profiler id="amr" onRender={rendered}>
        <MascotAssistant />
      </Profiler>
    );
    act(() => useAgentStore.getState().openSheet({ via: "pointer" }));
    const box = await screen.findByLabelText("Message");
    act(() => box.focus());
    await frames();
    const raf = vi.mocked(window.requestAnimationFrame);
    raf.mockClear();

    // The keyboard comes up in steps, many events in a frame.
    for (const kb of [60, 120, 180, 240]) keyboard(kb);
    expect(raf).toHaveBeenCalledTimes(1);
    await frames();
    expect(px(dialog(), "--amr-kb")).toBe(240);
    expect(dialog()).toHaveAttribute("data-amr-compact");

    // Once it counts as up, its last steps only move the variables.
    const commits = rendered.mock.calls.length;
    for (const kb of [270, 300]) {
      keyboard(kb);
      await frames();
    }
    expect(px(dialog(), "--amr-kb")).toBe(300);
    expect(px(dialog(), "--amr-vv-bottom")).toBe(300 + VISIBLE_GAP);
    expect(rendered.mock.calls.length).toBe(commits);
  });
});

// ── Narrow screens ───────────────────────────────────────────────────────

describe("under 360 px wide", () => {
  it("moves New chat into More, and the subtitle truncates", async () => {
    screenAt(320, 568);
    await openChat();
    const panel = dialog();
    // The header's own New chat hides at this width...
    const icon = within(panel).getByRole("button", { name: "New chat" });
    expect(icon).toHaveClass("max-[359px]:hidden");
    // ...and heads the More menu instead.
    fireEvent.keyDown(within(panel).getByRole("button", { name: "More" }), { key: "Enter" });
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("New chat");
    const subtitle = panel.querySelector('[data-panel-slot="subtitle"]')!.parentElement!;
    expect(subtitle).toHaveClass("truncate");
  });

  it("keeps New chat beside History from 360 px", async () => {
    screenAt(375, 667);
    await openChat();
    fireEvent.keyDown(within(dialog()).getByRole("button", { name: "More" }), { key: "Enter" });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /New chat/ })).toBeNull();
  });
});
