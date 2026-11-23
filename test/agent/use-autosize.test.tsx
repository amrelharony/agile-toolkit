/**
 * The message box grows with its text up to min(6 lines, 35% of the visible
 * box) and scrolls past that (design 1.3 item 8). The visible box is the
 * panel's --amr-visible-h, which the shell rewrites as the keyboard moves, or
 * the window's height outside the panel.
 */

import { act, render, waitFor } from "@testing-library/react";
import { useRef, type CSSProperties, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  AUTOSIZE_LINES,
  AUTOSIZE_SHARE,
  VISIBLE_H_VAR,
  autosizeCap,
  autosizeHeight,
  useAutosize,
} from "@/components/agent/chat/use-autosize";

// One line of 24 px, 8 px of padding and 1 px of border, top and bottom.
const LINE = 24;
const CHROME = 8 * 2 + 1 * 2;
const SIX_LINES = LINE * AUTOSIZE_LINES + CHROME; // 162

describe("autosizeCap", () => {
  it("is six lines when the visible box is tall", () => {
    expect(autosizeCap({ lineHeight: LINE, chrome: CHROME, visibleHeight: 900 })).toBe(SIX_LINES);
  });

  it("is 35% of the visible box when that is less, as with a phone's keyboard up", () => {
    expect(autosizeCap({ lineHeight: LINE, chrome: CHROME, visibleHeight: 300 })).toBeCloseTo(
      300 * AUTOSIZE_SHARE
    );
  });

  it("never drops below one line", () => {
    expect(autosizeCap({ lineHeight: LINE, chrome: CHROME, visibleHeight: 40 })).toBe(
      LINE + CHROME
    );
  });
});

describe("autosizeHeight", () => {
  const metrics = { lineHeight: LINE, chrome: CHROME, visibleHeight: 900 };

  it("fits short text, with no scrollbar", () => {
    expect(autosizeHeight(90, metrics)).toEqual({ height: 90, scrolls: false });
  });

  it("stops at the cap and scrolls past it", () => {
    expect(autosizeHeight(500, metrics)).toEqual({ height: SIX_LINES, scrolls: true });
  });

  it("doesn't scroll for half a pixel of rounding", () => {
    expect(autosizeHeight(SIX_LINES + 0.4, metrics).scrolls).toBe(false);
  });

  it("is never shorter than one line, even when nothing could be measured", () => {
    expect(autosizeHeight(0, metrics).height).toBe(LINE + CHROME);
  });
});

/** A box whose text needs `content.px` of scroll height, in a panel or not. */
function Composer({ value, content }: { value: string; content: { px: number } }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useAutosize(ref, value);
  return (
    <div data-testid="row">
      <textarea
        data-testid="box"
        ref={(el) => {
          ref.current = el;
          if (el && !Object.getOwnPropertyDescriptor(el, "scrollHeight")) {
            Object.defineProperty(el, "scrollHeight", { get: () => content.px });
          }
        }}
        rows={1}
        value={value}
        readOnly
        style={{
          lineHeight: `${LINE}px`,
          paddingTop: 8,
          paddingBottom: 8,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderStyle: "solid",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function inPanel(visible: string, ui: ReactElement) {
  return (
    <div
      data-amr-layout="sheet"
      data-testid="panel"
      style={{ [VISIBLE_H_VAR]: visible } as CSSProperties}
    >
      {ui}
    </div>
  );
}

describe("useAutosize", () => {
  it("grows the box with its text, up to six lines, then scrolls", () => {
    // Its scroll height leaves the border (2 px) out.
    const content = { px: 60 - 2 };
    const { getByTestId, rerender } = render(<Composer value="hi" content={content} />);
    const box = getByTestId("box") as HTMLTextAreaElement;
    // Outside the panel the window's height is the visible box (jsdom: 768).
    expect(box.style.height).toBe("60px");
    expect(box.style.overflowY).toBe("hidden");

    content.px = 400 - 2;
    rerender(<Composer value={"hi\n".repeat(20)} content={content} />);
    expect(box.style.height).toBe(`${SIX_LINES}px`);
    expect(box.style.overflowY).toBe("auto");

    content.px = 40 - 2;
    rerender(<Composer value="" content={content} />);
    expect(box.style.height).toBe("42px");
    expect(box.style.overflowY).toBe("hidden");
  });

  it("caps the box at 35% of the panel's visible box, and follows it as it changes", async () => {
    const content = { px: 500 };
    const { getByTestId } = render(inPanel("300px", <Composer value="x" content={content} />));
    const box = getByTestId("box") as HTMLTextAreaElement;
    expect(box.style.height).toBe(`${300 * AUTOSIZE_SHARE}px`);

    // The keyboard goes down: the shell writes a taller visible box.
    act(() => {
      getByTestId("panel").style.setProperty(VISIBLE_H_VAR, "900px");
    });
    await waitFor(() => expect(box.style.height).toBe(`${SIX_LINES}px`));
  });

  it("holds the box's row while it measures, and leaves the row as it was", () => {
    const content = { px: 60 };
    const { getByTestId, rerender } = render(<Composer value="a" content={content} />);
    const row = getByTestId("row");
    row.style.minHeight = "10px";
    rerender(<Composer value="ab" content={content} />);
    expect(row.style.minHeight).toBe("10px");
  });
});
