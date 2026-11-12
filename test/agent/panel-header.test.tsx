/**
 * The header of Amr's chat panel (src/components/agent/mascot/panel-header.tsx),
 * the slots a view fills in it (panel-chrome.tsx) and the panel context a view
 * reads (panel-context.ts). These pin the lettered name plate (always "Amr",
 * the dialog's title, able to take focus), the subtitle that shows the step's
 * default until the view fills it, the back and action slots, the More menu
 * (its keyboard, its Escape that leaves the panel open, the labelled tilt
 * switch and the shortcut), Enlarge as a toggle that only md and up see, the
 * 44 px touch targets, and that nothing is set in capitals.
 */

import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AMR_PANEL_TITLE_ID,
  PanelHeader,
  shortcutLabel,
  type PanelHeaderProps,
  type PanelTilt,
} from "@/components/agent/mascot/panel-header";
import { platformShortcut } from "@/components/agent/mascot/panel-ids";
import {
  PANEL_ICON,
  PanelActions,
  PanelBack,
  PanelChrome,
  PanelIconButton,
  PanelSubtitle,
} from "@/components/agent/mascot/panel-chrome";
import {
  AmrPanelContext,
  NO_AMR_PANEL,
  useAmrPanel,
  type AmrPanelContextValue,
} from "@/components/agent/mascot/panel-context";

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

function Panel({ children, ...props }: Partial<PanelHeaderProps> & { children?: ReactNode }) {
  return (
    <PanelChrome>
      <PanelHeader onClose={() => {}} {...props} />
      <div data-testid="body">{children}</div>
    </PanelChrome>
  );
}

const header = () => document.querySelector("[data-panel-header]") as HTMLElement;
const slot = (name: string) => header().querySelector(`[data-panel-slot="${name}"]`) as HTMLElement;
const subtitleLine = () => slot("subtitle").parentElement as HTMLElement;

/** A tilt switch the test can watch: off unless `on`. */
const tiltOf = (on = false): PanelTilt => ({ on, onToggle: vi.fn() });
const moreButton = () => within(header()).getByRole("button", { name: "More" });
/** Opens the More menu from the keyboard, as Enter on its button does. */
function openMore(key = "Enter"): HTMLElement {
  fireEvent.keyDown(moreButton(), { key });
  return screen.getByRole("menu");
}

describe("the name plate", () => {
  it("letters Amr's name as the panel's h2, under the plate id, able to take focus", () => {
    render(<Panel subtitle="Find the right tool" />);
    const plate = screen.getByRole("heading", { level: 2 });
    expect(plate).toHaveTextContent(/^Amr$/);
    expect(plate).toHaveAttribute("id", AMR_PANEL_TITLE_ID);
    expect(plate).toHaveClass("comic-name-plate");
    // A keyboard open can land on it, but Tab never stops there.
    expect(plate).toHaveAttribute("tabindex", "-1");
    plate.focus();
    expect(plate).toHaveFocus();
  });

  it("takes the id the shell gives it, for the dialog's aria-labelledby", () => {
    render(
      <div role="dialog" aria-labelledby="amr-plate-test">
        <Panel plateId="amr-plate-test" />
      </div>
    );
    expect(screen.getByRole("dialog", { name: "Amr" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveAttribute("id", "amr-plate-test");
  });

  it("is always his name, whatever the view says, never a role", () => {
    render(
      <Panel subtitle="Chat · not saved">
        <PanelSubtitle>Your chats</PanelSubtitle>
      </Panel>
    );
    const plate = screen.getByRole("heading", { level: 2 });
    expect(plate.textContent).toBe("Amr");
    expect(header().textContent).not.toMatch(/assistant/i);
  });
});

describe("the subtitle", () => {
  it("shows the step's default until a view fills it", () => {
    function Toggle() {
      const [on, setOn] = useState(false);
      return (
        <Panel subtitle="Find the right tool">
          <button type="button" onClick={() => setOn((v) => !v)}>
            toggle
          </button>
          {on && <PanelSubtitle>Your chats</PanelSubtitle>}
        </Panel>
      );
    }
    render(<Toggle />);
    expect(within(header()).getByText("Find the right tool")).toBeInTheDocument();
    expect(within(header()).queryByText("Your chats")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    // The view's line is drawn in the header, not in the body, and replaces
    // the default rather than sitting beside it.
    expect(within(slot("subtitle")).getByText("Your chats")).toBeInTheDocument();
    expect(within(screen.getByTestId("body")).queryByText("Your chats")).toBeNull();
    expect(within(header()).queryByText("Find the right tool")).toBeNull();

    // The view goes: the default comes back.
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(within(header()).getByText("Find the right tool")).toBeInTheDocument();
    expect(within(header()).queryByText("Your chats")).toBeNull();
  });

  it("keeps the default when a view fills the slot with nothing", () => {
    render(
      <Panel subtitle="New chat">
        <PanelSubtitle>{null}</PanelSubtitle>
        <PanelSubtitle>{""}</PanelSubtitle>
        <PanelSubtitle>{false}</PanelSubtitle>
      </Panel>
    );
    expect(within(header()).getByText("New chat")).toBeInTheDocument();
    expect(slot("subtitle")).toBeEmptyDOMElement();
  });

  it("is one truncated line in the sub text, with the filled text isolated for direction", () => {
    render(<Panel subtitle="A very long thread title that cannot fit in the header" />);
    expect(subtitleLine().tagName).toBe("P");
    expect(subtitleLine()).toHaveClass("truncate", "text-xs", "text-sub");
    expect(slot("subtitle")).toHaveAttribute("dir", "auto");
  });

  it("follows the subtitle with the shortcut while there is no More menu, hidden on touch screens", () => {
    render(
      <Panel subtitle="Find the right tool" shortcut="Ctrl J">
        <span />
      </Panel>
    );
    const hint = screen.getByText(/Ctrl J/);
    expect(hint).toHaveClass("pointer-coarse:hidden");
    expect(hint.textContent).toBe(" · Ctrl J");
    expect(screen.getByText("Find the right tool")).not.toHaveClass("pointer-coarse:hidden");
  });

  it("drops the separator when there is no subtitle before the shortcut", () => {
    render(<Panel shortcut="Ctrl J" />);
    expect(screen.getByText("Ctrl J").textContent).toBe("Ctrl J");
  });

  it("leaves the shortcut to the More menu once there is one", () => {
    render(<Panel subtitle="Find the right tool" shortcut="Ctrl J" tilt={tiltOf()} />);
    expect(subtitleLine().textContent).toBe("Find the right tool");
    expect(within(header()).queryByText(/Ctrl J/)).toBeNull();
  });
});

describe("the shortcut's label", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says ⌘ on Apple keyboards and Ctrl elsewhere", () => {
    expect(shortcutLabel("J", true)).toBe("⌘J");
    expect(shortcutLabel("J", false)).toBe("Ctrl J");
  });

  it("reads the platform the way the site header does", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(shortcutLabel("J")).toBe("⌘J");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    );
    expect(shortcutLabel("J")).toBe("Ctrl J");
    // iPhones and iPads report themselves as Mac in the user agent.
    vi.spyOn(navigator, "platform", "get").mockReturnValue("iPhone");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    );
    expect(shortcutLabel("J")).toBe("⌘J");
  });

  it("is spelled by the one formatter the site header uses too", () => {
    // The header's search keycap: "Ctrl K", or "⌘K" on a Mac.
    expect(platformShortcut("K", false)).toBe("Ctrl K");
    expect(platformShortcut("K", true)).toBe("⌘K");
    for (const apple of [true, false]) {
      expect(shortcutLabel("J", apple)).toBe(platformShortcut("J", apple));
    }
  });
});

describe("the back and action slots", () => {
  it("draws a view's back control before the plate and its actions before Close", () => {
    const back = vi.fn();
    render(
      <Panel onToggleEnlarge={() => {}}>
        <PanelBack>
          <PanelIconButton label="Back to tool finder" onClick={back}>
            <span aria-hidden="true">‹</span>
          </PanelIconButton>
        </PanelBack>
        <PanelActions>
          <PanelIconButton label="New chat">+</PanelIconButton>
        </PanelActions>
      </Panel>
    );
    const h = within(header());
    const backButton = h.getByRole("button", { name: "Back to tool finder" });
    const plate = h.getByRole("heading", { level: 2 });
    const newChat = h.getByRole("button", { name: "New chat" });
    const enlarge = h.getByRole("button", { name: "Enlarge chat" });
    const close = h.getByRole("button", { name: "Close assistant" });
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(slot("back")).toContainElement(backButton);
    expect(slot("actions")).toContainElement(newChat);
    expect(before(backButton, plate)).toBe(true);
    expect(before(plate, newChat)).toBe(true);
    expect(before(newChat, enlarge)).toBe(true);
    expect(before(enlarge, close)).toBe(true);
    // The view keeps its own handlers.
    fireEvent.click(backButton);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("puts the shell's More menu after the view's actions, before Enlarge and Close", () => {
    render(
      <Panel tilt={tiltOf()} onToggleEnlarge={() => {}}>
        <PanelActions>
          <PanelIconButton label="New chat">+</PanelIconButton>
        </PanelActions>
      </Panel>
    );
    const h = within(header());
    const newChat = h.getByRole("button", { name: "New chat" });
    const more = h.getByRole("button", { name: "More" });
    const enlarge = h.getByRole("button", { name: "Enlarge chat" });
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(newChat, more)).toBe(true);
    expect(before(more, enlarge)).toBe(true);
    expect(slot("actions")).not.toContainElement(more);
    // The old bare phone icon is gone from the row: the switch is in the menu.
    expect(h.queryByRole("button", { name: /feel your phone/i })).toBeNull();
  });

  it("hides an empty slot so it leaves no gap", () => {
    render(<Panel />);
    expect(slot("back")).toHaveClass("empty:hidden");
    expect(slot("actions")).toHaveClass("empty:hidden");
    expect(slot("back")).toBeEmptyDOMElement();
    expect(slot("actions")).toBeEmptyDOMElement();
  });

  it("draws nothing when no header is mounted, with or without the provider", () => {
    const { container } = render(
      <>
        <PanelChrome>
          <PanelSubtitle>Orphan subtitle</PanelSubtitle>
          <PanelActions>
            <button type="button">Orphan action</button>
          </PanelActions>
        </PanelChrome>
        <PanelBack>
          <button type="button">Loose back</button>
        </PanelBack>
      </>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Orphan subtitle")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders on the server with the defaults and no portals", () => {
    const html = renderToStaticMarkup(
      <Panel subtitle="Find the right tool">
        <PanelSubtitle>Your chats</PanelSubtitle>
        <PanelActions>
          <button type="button">New chat</button>
        </PanelActions>
      </Panel>
    );
    expect(html).toContain("Find the right tool");
    expect(html).not.toContain("Your chats");
    expect(html).not.toContain("New chat");
    expect(html).toMatch(/<h2[^>]*class="comic-name-plate"[^>]*>Amr<\/h2>/);
  });
});

describe("the More menu", () => {
  it("is offered only with a choice in it", () => {
    // A menu with only the shortcut line would have no item to land on.
    const { rerender } = render(<Panel shortcut="Ctrl J" />);
    expect(within(header()).queryByRole("button", { name: "More" })).toBeNull();

    rerender(<Panel shortcut="Ctrl J" tilt={tiltOf()} />);
    expect(moreButton()).toBeInTheDocument();
  });

  it("is a ghost icon menu button, closed until asked", () => {
    render(<Panel tilt={tiltOf()} />);
    const more = moreButton();
    expect(more).toHaveAttribute("type", "button");
    expect(more).toHaveAttribute("data-variant", "ghost");
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("title", "More");
    expect(more).toHaveClass("h-9", "w-9", "pointer-coarse:min-h-11", "pointer-coarse:min-w-11");
    expect(more.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard, lands on its first choice, and Escape closes it back to its button", async () => {
    render(<Panel tilt={tiltOf()} />);
    // Held from here: while the menu is open the rest of the page is hidden
    // from the accessibility tree, the button too.
    const more = moreButton();
    for (const key of ["Enter", " ", "ArrowDown"]) {
      const menu = openMore(key);
      expect(more).toHaveAttribute("aria-expanded", "true");
      expect(more).toHaveAttribute("aria-controls", menu.id);
      const tilt = within(menu).getByRole("menuitemcheckbox");
      await waitFor(() => expect(tilt).toHaveFocus());

      fireEvent.keyDown(tilt, { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(more).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(more).toHaveFocus());
    }
  });

  it("keeps its Escape: the menu closes, the default is prevented, and the panel stays open", () => {
    // The panel's own Escape (mascot-assistant's panelEscape) runs from the
    // dialog's onKeyDown and skips an Escape something has prevented. The menu
    // sits in a portal, but React still bubbles its keys to the dialog.
    const panelSaw: boolean[] = [];
    const closePanel = vi.fn();
    const onKeyDown = (e: ReactKeyboardEvent) => {
      if (e.key !== "Escape") return;
      panelSaw.push(e.nativeEvent.defaultPrevented);
      if (!e.nativeEvent.defaultPrevented) closePanel();
    };
    render(
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div role="dialog" aria-labelledby={AMR_PANEL_TITLE_ID} onKeyDown={onKeyDown}>
        <Panel tilt={tiltOf()} />
      </div>
    );
    const menu = openMore();
    const notPrevented = fireEvent.keyDown(within(menu).getByRole("menuitemcheckbox"), {
      key: "Escape",
    });
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(panelSaw).toEqual([true]);
    expect(closePanel).not.toHaveBeenCalled();

    // With the menu shut, the next Escape is the panel's.
    expect(fireEvent.keyDown(moreButton(), { key: "Escape" })).toBe(true);
    expect(panelSaw).toEqual([true, false]);
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it("holds the tilt switch: a labelled checkbox item that toggles and stays open", () => {
    const tilt = tiltOf(false);
    const { rerender } = render(<Panel tilt={tilt} />);
    let menu = openMore();
    let item = within(menu).getByRole("menuitemcheckbox", {
      name: "Let Amr feel your phone's tilt",
    });
    expect(item).toHaveAttribute("aria-checked", "false");
    // Its state in words for the eye; aria-checked says it to a screen reader.
    const state = within(item).getByText("Off");
    expect(state).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(item);
    expect(tilt.onToggle).toHaveBeenCalledTimes(1);
    // Still open, so the new state shows.
    expect(screen.getByRole("menu")).toBe(menu);

    rerender(<Panel tilt={{ ...tilt, on: true }} />);
    menu = screen.getByRole("menu");
    item = within(menu).getByRole("menuitemcheckbox", {
      name: "Let Amr feel your phone's tilt",
      checked: true,
    });
    expect(within(item).getByText("On")).toHaveAttribute("aria-hidden", "true");

    // The keyboard toggles it too.
    fireEvent.keyDown(item, { key: "Enter" });
    expect(tilt.onToggle).toHaveBeenCalledTimes(2);
  });

  it("ends with the shortcut, as the platform writes it", () => {
    const { unmount } = render(<Panel tilt={tiltOf()} shortcut={shortcutLabel("J", false)} />);
    let menu = openMore();
    expect(within(menu).getByText(/opens and closes Amr$/).textContent).toBe(
      "Ctrl J opens and closes Amr"
    );
    expect(within(menu).getByText("Ctrl J").tagName).toBe("KBD");
    // No Ctrl/⌘ key on a touch screen: the line and its rule hide there, like
    // the subtitle's hint (the tilt switch, a phone's, stays alone).
    expect(within(menu).getByText(/opens and closes Amr$/)).toHaveClass("pointer-coarse:hidden");
    expect(within(menu).getByRole("separator")).toHaveClass("pointer-coarse:hidden");
    // A line to read, not a choice: the arrows never stop on it.
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(1);
    expect(within(menu).queryByRole("menuitem")).toBeNull();
    unmount();

    render(<Panel tilt={tiltOf()} shortcut={shortcutLabel("J", true)} />);
    menu = openMore();
    expect(within(menu).getByText(/opens and closes Amr$/).textContent).toBe(
      "⌘J opens and closes Amr"
    );
  });

  it("sets nothing in its menu in capitals", () => {
    render(<Panel tilt={tiltOf(true)} shortcut="Ctrl J" />);
    const menu = openMore();
    for (const el of [menu, ...Array.from(menu.querySelectorAll("*"))]) {
      expect(classes(el)).not.toContain("uppercase");
    }
    const words = (menu.textContent ?? "").match(/[A-Za-z]{3,}/g) ?? [];
    for (const word of words) expect(word).not.toBe(word.toUpperCase());
  });
});

describe("Enlarge and Close", () => {
  it("offers Enlarge only when the shell can enlarge, and only from md up", () => {
    const { rerender } = render(<Panel />);
    expect(screen.queryByRole("button", { name: "Enlarge chat" })).toBeNull();

    rerender(<Panel onToggleEnlarge={() => {}} />);
    const enlarge = screen.getByRole("button", { name: "Enlarge chat" });
    expect(enlarge).toHaveClass("hidden", "md:inline-flex");
    // The base Button's inline-flex would show it on phones: it must be gone.
    expect(classes(enlarge)).not.toContain("inline-flex");
  });

  it("is a toggle: aria-pressed follows the size, the name stays, the tooltip says what a press does", () => {
    const toggle = vi.fn();
    const { rerender } = render(<Panel enlarged={false} onToggleEnlarge={toggle} />);
    let enlarge = screen.getByRole("button", { name: "Enlarge chat" });
    expect(enlarge).toHaveAttribute("aria-pressed", "false");
    expect(enlarge).toHaveAttribute("title", "Enlarge chat");
    fireEvent.click(enlarge);
    expect(toggle).toHaveBeenCalledTimes(1);

    rerender(<Panel enlarged onToggleEnlarge={toggle} />);
    enlarge = screen.getByRole("button", { name: "Enlarge chat", pressed: true });
    expect(enlarge).toHaveAttribute("title", "Make chat smaller");
    expect(enlarge).toHaveClass("aria-pressed:text-accent");
  });

  it("closes through the shell", () => {
    const close = vi.fn();
    render(<Panel onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("makes every header icon a ghost Button, 36 px with a mouse and 44 px on touch", () => {
    render(
      <Panel onToggleEnlarge={() => {}} tilt={tiltOf()}>
        <PanelActions>
          <PanelIconButton label="New chat">+</PanelIconButton>
        </PanelActions>
      </Panel>
    );
    for (const name of ["New chat", "More", "Enlarge chat", "Close assistant"]) {
      const button = within(header()).getByRole("button", { name });
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("data-variant", "ghost");
      expect(button).toHaveClass(
        "h-9",
        "w-9",
        "pointer-coarse:min-h-11",
        "pointer-coarse:min-w-11",
        "items-center",
        "justify-center"
      );
      // The base icon size's 44 px floor would hold at every width with a
      // mouse below md; the touch floor replaces it.
      expect(classes(button)).not.toContain("min-h-[44px]");
      expect(classes(button)).not.toContain("min-w-[44px]");
    }
    for (const svg of Array.from(header().querySelectorAll("svg"))) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
    expect(PANEL_ICON).toContain("pointer-coarse:min-h-11");
  });

  it("is at least 52 px tall", () => {
    render(<Panel />);
    expect(header()).toHaveClass("min-h-[52px]");
  });
});

describe("the brand", () => {
  it("sets nothing in capitals", () => {
    render(
      <Panel subtitle="Find the right tool" shortcut="Ctrl J" onToggleEnlarge={() => {}} enlarged>
        <PanelSubtitle>Chat · not saved</PanelSubtitle>
      </Panel>
    );
    for (const el of [header(), ...Array.from(header().querySelectorAll("*"))]) {
      expect(classes(el)).not.toContain("uppercase");
      expect(el.getAttribute("style") ?? "").not.toMatch(/text-transform/i);
    }
    const words = (header().textContent ?? "").match(/[A-Za-z]{3,}/g) ?? [];
    for (const word of words) expect(word).not.toBe(word.toUpperCase());
  });

  it("uses no glow, gradient, pill or hex colour in the header's classes", () => {
    render(<Panel onToggleEnlarge={() => {}} tilt={tiltOf()} />);
    for (const el of [header(), ...Array.from(header().querySelectorAll("*"))]) {
      for (const c of classes(el)) {
        expect(c).not.toMatch(/^(?:.*:)?(?:rounded-full|bg-gradient|from-|glow|drop-shadow|blur)/);
        expect(c).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });
});

describe("the panel context", () => {
  it("gives a view the safe default without a panel around it", () => {
    const { result } = renderHook(() => useAmrPanel());
    expect(result.current).toBe(NO_AMR_PANEL);
    expect(result.current.layout).toBe("float");
    expect(result.current.replaceOnNavigate).toBe(false);
    expect(() => {
      result.current.onNavigate();
      result.current.registerInitialFocus(document.body);
      result.current.registerInitialFocus(null);
    }).not.toThrow();
    expect(Object.isFrozen(NO_AMR_PANEL)).toBe(true);
  });

  it("gives a view the panel's own value inside one", () => {
    const value: AmrPanelContextValue = {
      layout: "sheet",
      onNavigate: vi.fn(),
      replaceOnNavigate: true,
      registerInitialFocus: vi.fn(),
    };
    const { result } = renderHook(() => useAmrPanel(), {
      wrapper: ({ children }) => (
        <AmrPanelContext.Provider value={value}>{children}</AmrPanelContext.Provider>
      ),
    });
    expect(result.current).toBe(value);
    result.current.onNavigate();
    expect(value.onNavigate).toHaveBeenCalledTimes(1);
  });
});
