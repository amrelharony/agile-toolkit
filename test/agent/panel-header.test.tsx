/**
 * The header of Amr's chat panel (src/components/agent/mascot/panel-header.tsx),
 * the slots a view fills in it (panel-chrome.tsx) and the panel context a view
 * reads (panel-context.ts). These pin the lettered name plate (always "Amr",
 * the dialog's title, able to take focus), the subtitle that shows the step's
 * default until the view fills it, the back and action slots, Enlarge as a
 * toggle that only md and up see, the 44 px touch targets, and that nothing is
 * set in capitals.
 */

import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AMR_PANEL_TITLE_ID,
  PanelHeader,
  type PanelHeaderProps,
} from "@/components/agent/mascot/panel-header";
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

  it("follows the subtitle with the shortcut, hidden on touch screens", () => {
    render(
      <Panel subtitle="Find the right tool" shortcut="Cmd/Ctrl+J">
        <span />
      </Panel>
    );
    const hint = screen.getByText(/Cmd\/Ctrl\+J/);
    expect(hint).toHaveClass("pointer-coarse:hidden");
    expect(hint.textContent).toBe(" · Cmd/Ctrl+J");
    expect(screen.getByText("Find the right tool")).not.toHaveClass("pointer-coarse:hidden");
  });

  it("drops the separator when there is no subtitle before the shortcut", () => {
    render(<Panel shortcut="Cmd/Ctrl+J" />);
    expect(screen.getByText("Cmd/Ctrl+J").textContent).toBe("Cmd/Ctrl+J");
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

  it("puts the shell's own controls after the view's actions", () => {
    render(
      <Panel controls={<PanelIconButton label="Let Amr feel your phone">o</PanelIconButton>}>
        <PanelActions>
          <PanelIconButton label="New chat">+</PanelIconButton>
        </PanelActions>
      </Panel>
    );
    const newChat = screen.getByRole("button", { name: "New chat" });
    const tilt = screen.getByRole("button", { name: "Let Amr feel your phone" });
    expect(newChat.compareDocumentPosition(tilt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot("actions")).not.toContainElement(tilt);
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
      <Panel onToggleEnlarge={() => {}}>
        <PanelActions>
          <PanelIconButton label="New chat">+</PanelIconButton>
        </PanelActions>
      </Panel>
    );
    for (const name of ["New chat", "Enlarge chat", "Close assistant"]) {
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
      <Panel
        subtitle="Find the right tool"
        shortcut="Cmd/Ctrl+J"
        onToggleEnlarge={() => {}}
        enlarged
      >
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
    render(<Panel onToggleEnlarge={() => {}} />);
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
