import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/toast", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/tools/tool-prefs", () => ({
  useToolPrefs: () => ({ favorites: [], recent: [] }),
}));
// Stand-ins that show whether they're mounted, open or closed. The palette is the real one.
vi.mock("@/components/gamification/trophy-case", () => ({
  TrophyCase: ({ open }: { open: boolean }) => (
    <div data-testid="trophy-case" data-open={String(open)}>
      {open && <div role="dialog" aria-label="Trophy case" />}
    </div>
  ),
}));
vi.mock("@/components/ai/llm-settings-dialog", async () => {
  const { useLlmUiStore } = await import("@/lib/stores/llm-ui-store");
  return {
    LlmSettingsDialog: function LlmSettingsDialog() {
      const open = useLlmUiStore((s) => s.settingsOpen);
      return open ? <div role="dialog" aria-label="AI settings" /> : null;
    },
  };
});

import { useCommandPaletteShortcut } from "@/components/layout/use-command-palette-shortcut";
import { DeferredDialog } from "@/components/layout/deferred-dialog";
import { ShellDialogs } from "@/components/layout/shell-dialogs";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

beforeAll(() => {
  // cmdk measures and scrolls items; jsdom implements neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  toastError.mockClear();
  useLlmUiStore.setState({ settingsOpen: false });
  vi.restoreAllMocks();
});

/**
 * Every page pays for what the app shell imports statically: it's in the
 * first download and it all hydrates before the page responds. These stay
 * behind import() and mount only when something needs them.
 */
const DEFERRED = [
  "./command-palette",
  "@/components/layout/command-palette",
  "@/components/gamification/trophy-case",
  "@/lib/holiday/engine",
  "@/components/ai/llm-settings-dialog",
];

function source(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function staticImports(file: string): string[] {
  return Array.from(source(file).matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)).map(
    (m) => m[1]
  );
}

describe("the app shell's first download", () => {
  it.each(DEFERRED)("does not statically import %s", (spec) => {
    expect(staticImports("src/components/layout/app-shell.tsx")).not.toContain(spec);
    expect(staticImports("src/components/layout/shell-dialogs.tsx")).not.toContain(spec);
  });

  it("leaves the palette's own file without a second Ctrl/Cmd+K listener", () => {
    // Two listeners would toggle it open and shut on one key press.
    expect(source("src/components/layout/command-palette.tsx")).not.toMatch(
      /addEventListener\(\s*["']keydown["']/
    );
  });
});

interface StubProps {
  open: boolean;
}

function Stub({ open }: StubProps) {
  return open ? <div role="dialog" aria-label="Stub" /> : null;
}

/** A loader whose import the test settles by hand. */
function controlledLoader() {
  const pending: {
    resolve: (c: ComponentType<StubProps>) => void;
    reject: (e: Error) => void;
  }[] = [];
  const load = vi.fn(
    () =>
      new Promise<ComponentType<StubProps>>((resolve, reject) => pending.push({ resolve, reject }))
  );
  return { load, pending };
}

function Host({
  load,
  warm = false,
}: {
  load: () => Promise<ComponentType<StubProps>>;
  warm?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p>The tool</p>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <DeferredDialog
        load={load}
        open={open}
        warm={warm}
        label="the stub"
        onClose={() => setOpen(false)}
        props={{ open }}
      />
    </>
  );
}

describe("DeferredDialog", () => {
  it("loads nothing until it's opened, and says it's opening while its code arrives", async () => {
    const { load, pending } = controlledLoader();
    render(<Host load={load} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Opening the stub…");

    await act(async () => pending[0].resolve(Stub));
    expect(await screen.findByRole("dialog", { name: "Stub" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes with a toast when its code can't load, leaves the page alone, and tries again on the next open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { load, pending } = controlledLoader();
    render(<Host load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await act(async () => pending[0].reject(new Error("Loading chunk 123 failed.")));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Couldn't open the stub. Check your connection, or reload the page."
      )
    );
    expect(screen.getByText("The tool")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    // React.lazy would keep the rejection; a fresh import runs instead.
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => pending[1].resolve(Stub));
    expect(await screen.findByRole("dialog", { name: "Stub" })).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("mounts closed when warm, so the first open is immediate", async () => {
    const { load, pending } = controlledLoader();
    render(<Host load={load} warm />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    await act(async () => pending[0].resolve(Stub));

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // In the same commit as the click: no Suspense fallback, so focus can't land late.
    expect(screen.getByRole("dialog", { name: "Stub" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed warm-up quiet, and loads again when it's opened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { load, pending } = controlledLoader();
    render(<Host load={load} warm />);
    await act(async () => pending[0].reject(new Error("offline")));
    await act(async () => {});
    expect(toastError).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => pending[1].resolve(Stub));
    expect(await screen.findByRole("dialog", { name: "Stub" })).toBeInTheDocument();
  });
});

function Shell() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [trophyOpen, setTrophyOpen] = useState(false);
  return (
    <>
      <p>The tool</p>
      {/* Stand in for the header's search button and XP bar. */}
      <button type="button" onClick={() => setSearchOpen(true)}>
        Search
      </button>
      <button type="button" onClick={() => setTrophyOpen(true)}>
        XP
      </button>
      <ShellDialogs
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        trophyOpen={trophyOpen}
        setTrophyOpen={setTrophyOpen}
      />
    </>
  );
}

describe("ShellDialogs", () => {
  it("opens the tool finder on Ctrl+K with its search box focused", async () => {
    render(<Shell />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
  });

  it("opens the tool finder from the header's search button", async () => {
    render(<Shell />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
  });

  it("opens the trophy case from the XP bar", async () => {
    render(<Shell />);
    expect(screen.queryByTestId("trophy-case")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "XP" }));
    expect(await screen.findByRole("dialog", { name: "Trophy case" })).toBeInTheDocument();
  });

  it("mounts the AI settings once the store opens them", async () => {
    render(<Shell />);
    act(() => useLlmUiStore.getState().openSettings());
    expect(await screen.findByRole("dialog", { name: "AI settings" })).toBeInTheDocument();
  });

  it("loads nothing ahead of time on a touch screen", async () => {
    render(<Shell />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByTestId("trophy-case")).toBeNull();
  });

  describe("with a fine pointer", () => {
    const original = {
      matchMedia: window.matchMedia,
      ric: window.requestIdleCallback,
      cic: window.cancelIdleCallback,
    };
    afterEach(() => {
      // Unmount first: the shell's cleanup cancels its idle callback.
      cleanup();
      window.matchMedia = original.matchMedia;
      window.requestIdleCallback = original.ric;
      window.cancelIdleCallback = original.cic;
    });

    it("mounts the dialogs closed once the page is idle, so the first Ctrl+K opens at once", async () => {
      window.matchMedia = ((query: string) => ({
        ...original.matchMedia(query),
        matches: query === "(pointer: fine)",
      })) as typeof window.matchMedia;
      window.requestIdleCallback = ((cb: IdleRequestCallback) => {
        cb({ didTimeout: false, timeRemaining: () => 50 });
        return 1;
      }) as typeof window.requestIdleCallback;
      window.cancelIdleCallback = () => {};

      render(<Shell />);
      // Mounted, still shut.
      expect(await screen.findByTestId("trophy-case")).toHaveAttribute("data-open", "false");
      expect(screen.queryByRole("dialog")).toBeNull();
      await act(async () => {
        await vi.dynamicImportSettled();
      });

      fireEvent.keyDown(document, { key: "k", ctrlKey: true });
      expect(screen.getByRole("dialog", { name: "Search tools" })).toBeInTheDocument();
    });
  });
});

describe("useCommandPaletteShortcut", () => {
  function Probe({ toggle }: { toggle: () => void }) {
    useCommandPaletteShortcut(toggle);
    return null;
  }

  it.each([
    [{ key: "k", ctrlKey: true }],
    [{ key: "k", metaKey: true }],
    [{ key: "K", ctrlKey: true }],
    [{ key: "л", code: "KeyK", ctrlKey: true }],
  ])("toggles on %o and keeps the browser's own shortcut out", (init) => {
    const toggle = vi.fn();
    render(<Probe toggle={toggle} />);
    const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores K without a modifier, other keys, and keydowns with no key", () => {
    const toggle = vi.fn();
    render(<Probe toggle={toggle} />);
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { key: "j", ctrlKey: true });
    // Autofill fires keydowns that carry no key.
    document.dispatchEvent(new Event("keydown"));
    expect(toggle).not.toHaveBeenCalled();
  });

  it("stops listening when the shell unmounts", () => {
    const toggle = vi.fn();
    const { unmount } = render(<Probe toggle={toggle} />);
    unmount();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});
