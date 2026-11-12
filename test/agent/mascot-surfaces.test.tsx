import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

/**
 * Amr's phone sheet and the app's other full-screen surfaces (design §1.3
 * item 9, "Sheet layout only"): the header's navigation, the account menu,
 * search and the other shell dialogs, and Activity close the sheet as they
 * open, so two never stack. They only read `html[data-amr-sheet]` and send
 * lib/layout/amr-sheet's close event, importing none of Amr's code. Outside
 * the sheet layout (the floating card, the side panel) the page stays live
 * beside the panel, and they leave it open. The panel also tells the toaster
 * where it is open (the mascot store's `panel`), so toasts keep off it.
 */

const h = vi.hoisted(() => ({
  auth: { status: "anonymous", user: null, profile: null } as Record<string, unknown>,
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => h.auth,
  useAuthOptional: () => h.auth,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/retro",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  }),
}));
vi.mock("@/lib/agent/client", () => ({
  abortInFlight: vi.fn(),
  sendUserMessage: vi.fn(async () => {}),
  generateTitle: vi.fn(async () => null),
  retryLastTurn: vi.fn(async () => true),
  goOn: vi.fn(async () => true),
  canRetryLastTurn: vi.fn(() => false),
}));
vi.mock("@/lib/actions/register-all", () => ({}));
vi.mock("@/components/agent/mascot/mascot-sprite", () => ({
  default: () => <div data-testid="mascot-sprite" />,
}));
// The header's extras, which have nothing to do with the sheet.
vi.mock("@/components/shared/sonification-toggle", () => ({ SonificationToggle: () => null }));
vi.mock("@/components/ai/llm-status-chip", () => ({ LlmStatusChip: () => null }));
vi.mock("@/lib/weather/widget", () => ({ WeatherWidget: () => null }));
vi.mock("@/components/auth/visitor-data-merge-dialog", () => ({
  VisitorDataMergeDialog: () => null,
}));
vi.mock("@/lib/kudos/beacon/header-beacon", () => ({ KudosHeaderBeacon: () => null }));
// The tool finder's code loads on first open (ShellDialogs): a stand-in.
vi.mock("@/components/layout/command-palette", () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Search tools" data-state="open" /> : null,
}));

import { MascotAssistant } from "@/components/agent/mascot/mascot-assistant";
import { VISITOR_BODY_LOADING } from "@/components/agent/mascot/lazy-visitor-body";
import { Header } from "@/components/layout/header";
import { ShellDialogs } from "@/components/layout/shell-dialogs";
import { ActivityPanel } from "@/components/notify/activity-panel";
import { useAgentStore } from "@/lib/agent/store";
import { useActivityUiStore } from "@/lib/stores/activity-ui-store";
import { AMR_SHEET_ATTR, AMR_SHEET_CLOSE_EVENT, closeAmrSheet } from "@/lib/layout/amr-sheet";
import { AppToaster } from "@/components/layout/app-toaster";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { toast } from "sonner";

/** A phone held upright (the sheet layout), or a laptop (the floating card). */
function screenAt(w: number, hgt: number) {
  vi.stubGlobal("innerWidth", w);
  vi.stubGlobal("innerHeight", hgt);
  const phone = w <= 639;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("coarse") ? phone : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** The app shell's pieces this is about: the header, main, the shell dialogs, Activity and Amr. */
function Shell({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const trophyOpen = useActivityUiStore((s) => s.trophyOpen);
  const setTrophyOpen = useActivityUiStore((s) => s.setTrophyOpen);
  return (
    <>
      <Header onOpenSearch={() => setSearchOpen(true)} onOpenSidebar={onOpenSidebar} />
      <main id="main-content">
        <p>The page</p>
      </main>
      <ShellDialogs
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        trophyOpen={trophyOpen}
        setTrophyOpen={setTrophyOpen}
      />
      <ActivityPanel />
      <MascotAssistant />
    </>
  );
}

const dialog = () => screen.queryByRole("dialog", { name: "Amr" });
const main = () => document.getElementById("main-content");

/** Open Amr's panel with a tap on him, and wait for the tool finder. */
async function openAmr() {
  fireEvent.click(screen.getByRole("button", { name: "Ask Amr" }), { detail: 1 });
  // The first open loads the tool finder's chunk, which can be slow under load.
  await waitFor(() => expect(screen.queryByText(VISITOR_BODY_LOADING)).toBeNull(), {
    timeout: 5000,
  });
  await screen.findByTestId("mascot-visitor-guide", {}, { timeout: 5000 });
  return dialog()!;
}

/** The sheet is open: its layout, and the page held still behind it. */
function expectSheet() {
  expect(dialog()).toHaveAttribute("data-amr-layout", "sheet");
  expect(document.documentElement).toHaveAttribute(AMR_SHEET_ATTR);
  expect(main()).toHaveAttribute("inert");
}

/** It has gone, and let the page go. */
function expectClosed() {
  expect(useAgentStore.getState().open).toBe(false);
  expect(dialog()).toBeNull();
  expect(document.documentElement).not.toHaveAttribute(AMR_SHEET_ATTR);
  expect(main()).not.toHaveAttribute("inert");
}

beforeAll(() => {
  // Radix's popper measures its anchor with ResizeObserver (absent in jsdom).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  if (typeof Element.prototype.scrollTo !== "function") Element.prototype.scrollTo = () => {};
  useAgentStore.getState().reset();
  useAgentStore.getState().closeSheet();
  useActivityUiStore.setState({ activityOpen: false, trophyOpen: false });
});

afterEach(() => {
  cleanup();
  useAgentStore.getState().closeSheet();
  useMascotStore.getState().reset();
  useActivityUiStore.setState({ activityOpen: false, trophyOpen: false });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

afterAll(() => {
  document.documentElement.removeAttribute(AMR_SHEET_ATTR);
});

describe("in the phone's sheet", () => {
  beforeEach(() => screenAt(375, 812));

  it("opening the navigation closes the sheet first", async () => {
    const onOpenSidebar = vi.fn(() => {
      // The sidebar opens with the sheet already gone.
      expect(useAgentStore.getState().open).toBe(false);
    });
    render(<Shell onOpenSidebar={onOpenSidebar} />);
    await openAmr();
    expectSheet();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
    expectClosed();
  });

  it("opening Activity closes the sheet, and Activity opens", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expectSheet();

    act(() => useActivityUiStore.getState().openActivity());
    expectClosed();
    expect(screen.getByRole("dialog", { name: "Activity" })).toBeInTheDocument();
  });

  it("the account menu closes the sheet as it opens", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expectSheet();

    // Radix opens the menu on a key press on its trigger.
    fireEvent.keyDown(screen.getByRole("button", { name: /^Visitor menu/ }), { key: "Enter" });
    expectClosed();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("search from the header closes the sheet", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expectSheet();

    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expectClosed();
    expect(await screen.findByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
  });

  it("search by Ctrl/Cmd+K closes the sheet", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expectSheet();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expectClosed();
    expect(await screen.findByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
  });

  it("the trophy case closes the sheet", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expectSheet();

    act(() => useActivityUiStore.getState().setTrophyOpen(true));
    expectClosed();
  });
});

describe("outside the sheet layout", () => {
  beforeEach(() => screenAt(1024, 768));

  it("the floating panel stays open when another surface opens", async () => {
    render(<Shell onOpenSidebar={() => {}} />);
    await openAmr();
    expect(dialog()).toHaveAttribute("data-amr-layout", "float");
    expect(document.documentElement).not.toHaveAttribute(AMR_SHEET_ATTR);

    act(() => useActivityUiStore.getState().openActivity());
    expect(useAgentStore.getState().open).toBe(true);
    expect(dialog()).not.toBeNull();
  });
});

describe("the toast stack beside the open panel", () => {
  const stack = () => {
    const list = document.querySelector<HTMLElement>("[data-sonner-toaster]");
    return `${list?.getAttribute("data-y-position")}-${list?.getAttribute("data-x-position")}`;
  };

  afterEach(() => {
    act(() => {
      toast.dismiss();
    });
  });

  it.each([
    [375, 812, "sheet", "top-center"],
    // He stands bottom right by default: the corner across is top left.
    [1024, 768, "float", "top-left"],
  ] as const)("at %i×%i, the %s: %s, and back as it closes", async (w, hgt, layout, at) => {
    screenAt(w, hgt);
    render(
      <>
        <main id="main-content" />
        <MascotAssistant />
        <AppToaster />
      </>
    );
    act(() => {
      toast("Saved");
    });
    await waitFor(() => expect(stack()).toBe("bottom-center"));

    await openAmr();
    expect(useMascotStore.getState().panel).toBe(layout);
    await waitFor(() => expect(stack()).toBe(at));

    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(useMascotStore.getState().panel).toBeNull();
    await waitFor(() => expect(stack()).toBe("bottom-center"));
  });
});

describe("lib/layout/amr-sheet", () => {
  it("asks for a close only while the sheet is open", () => {
    const heard = vi.fn();
    document.addEventListener(AMR_SHEET_CLOSE_EVENT, heard);
    try {
      closeAmrSheet();
      expect(heard).not.toHaveBeenCalled();
      document.documentElement.setAttribute(AMR_SHEET_ATTR, "");
      closeAmrSheet();
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener(AMR_SHEET_CLOSE_EVENT, heard);
      document.documentElement.removeAttribute(AMR_SHEET_ATTR);
    }
  });

  it("is imported by the every-page surfaces, never Amr's own code", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (f: string) => readFileSync(f, "utf8");
    for (const file of [
      "src/components/layout/header.tsx",
      "src/components/layout/shell-dialogs.tsx",
      "src/components/notify/activity-panel.tsx",
      "src/components/auth/user-menu.tsx",
    ]) {
      const src = read(file);
      expect(src, file).toContain('from "@/lib/layout/amr-sheet"');
      expect(src, file).not.toMatch(/from "@\/components\/agent\/mascot\/mascot-assistant"/);
    }
    // The helper itself imports nothing.
    expect(read("src/lib/layout/amr-sheet.ts")).not.toMatch(/^import /m);
  });
});
