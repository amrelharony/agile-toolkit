/**
 * The chat strip's comic parts (src/components/agent/comic/comic-parts.tsx):
 * Amr's balloon with its tail toward him, the scribble balloon while he
 * thinks, the reader's caption, narration and the scene caption. These pin
 * who is speaking for screen readers (a hidden prefix kept outside the
 * dir="auto" element), where Shantell may go (only a balloon's lead), the
 * brand's class rules, and that the folder stays runtime-free so every page
 * may import it. The look itself is checked in test/design/comic-chat-css.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AmrBalloon,
  Narration,
  SceneCaption,
  ThinkingBalloon,
  YouCaption,
} from "@/components/agent/comic/comic-parts";

const ROOT = path.resolve(__dirname, "../..");
const COMIC_DIR = path.join(ROOT, "src/components/agent/comic");
const SOURCE = readFileSync(path.join(COMIC_DIR, "comic-parts.tsx"), "utf8");
const GLOBALS = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const all = (root: Element) => [root, ...Array.from(root.querySelectorAll("*"))];
const first = (c: HTMLElement) => c.firstElementChild as HTMLElement;

/** Every part, drawn with every slot filled. */
function everyPart() {
  return render(
    <div data-testid="strip">
      <AmrBalloon lead="Here's the plan.">
        <p>
          Add <code className="font-data">flaky CI</code> to the board.
        </p>
      </AmrBalloon>
      <ThinkingBalloon />
      <YouCaption>Add a card please</YouCaption>
      <Narration label="Retro Board" actions={<button type="button">Try again</button>}>
        Amr added <span className="font-data">3</span> cards.
      </Narration>
      <Narration tone="error">Amr couldn&apos;t reach the server.</Narration>
      <SceneCaption>Earlier today</SceneCaption>
    </div>
  );
}

describe("AmrBalloon", () => {
  it("is a balloon whose tail points at the real Amr", () => {
    const balloon = first(render(<AmrBalloon>Hello</AmrBalloon>).container);
    expect(balloon.classList.contains("balloon")).toBe(true);
    expect(balloon.getAttribute("data-tail")).toBe("amr");
    // No second Amr in the chat: no picture of him inside his own balloon.
    expect(balloon.querySelector("img, picture, canvas")).toBeNull();
  });

  it("says who is speaking, outside the dir=auto element", () => {
    const balloon = first(render(<AmrBalloon>مرحبا، كيف حالك؟</AmrBalloon>).container);
    const prefix = balloon.querySelector(".sr-only")!;
    expect(prefix).toHaveTextContent("Amr said:");
    expect(prefix.closest("[dir]")).toBeNull();
    const content = balloon.querySelector('[dir="auto"]')!;
    expect(content).not.toBeNull();
    expect(content.contains(prefix)).toBe(false);
    expect(content).toHaveTextContent("مرحبا، كيف حالك؟");
    // Read first: the prefix comes before the words.
    expect(prefix.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(balloon.textContent).toBe("Amr said: مرحبا، كيف حالك؟");
  });

  it("letters only the lead, inside the content, in rem so it follows the reader's size", () => {
    const balloon = first(
      render(
        <AmrBalloon lead="Done, the card is on the board.">
          <p>It sits in the Went well column.</p>
        </AmrBalloon>
      ).container
    );
    const lead = balloon.querySelector("[data-balloon-lead]")!;
    expect(lead).toHaveTextContent("Done, the card is on the board.");
    expect(classes(lead)).toEqual(expect.arrayContaining(["font-display", "text-[0.9375rem]"]));
    expect(balloon.querySelector('[dir="auto"]')!.contains(lead)).toBe(true);
    // The lead comes before the body.
    const body = within(balloon).getByText("It sits in the Went well column.");
    expect(lead.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const lettered = all(balloon).filter((el) => el.classList.contains("font-display"));
    expect(lettered).toEqual([lead]);
    // The body is Inter, named on the balloon itself.
    expect(balloon.classList.contains("font-sans")).toBe(true);
    expect(balloon.classList.contains("text-sm")).toBe(true);
  });

  it("parts the lead from inline words with a real space, not run together", () => {
    const balloon = first(render(<AmrBalloon lead="Hi.">There.</AmrBalloon>).container);
    expect(balloon.querySelector("[data-comic-content]")!.textContent).toBe("Hi. There.");
  });

  it("has no lead, and nothing lettered, when none is given", () => {
    for (const lead of [undefined, null, false, ""] as const) {
      const balloon = first(render(<AmrBalloon lead={lead}>A long answer.</AmrBalloon>).container);
      expect(balloon.querySelector("[data-balloon-lead]")).toBeNull();
      expect(balloon.querySelector(".font-display")).toBeNull();
      // No lead, no leading space.
      expect(balloon.querySelector("[data-comic-content]")!.textContent).toBe("A long answer.");
    }
  });

  it("keeps the tail and the speaker whatever the call site passes", () => {
    const balloon = first(
      render(
        <AmrBalloon className="max-w-[85%]" id="m1" data-message-id="m1">
          Hi
        </AmrBalloon>
      ).container
    );
    expect(balloon.id).toBe("m1");
    expect(balloon.getAttribute("data-message-id")).toBe("m1");
    expect(balloon.classList.contains("max-w-[85%]")).toBe(true);
    expect(balloon.getAttribute("data-tail")).toBe("amr");
  });
});

describe("ThinkingBalloon", () => {
  it("is Amr's balloon with a scribble and no words at all", () => {
    const { container } = render(<ThinkingBalloon />);
    const balloon = first(container);
    expect(balloon.classList.contains("balloon")).toBe(true);
    expect(balloon.getAttribute("data-tail")).toBe("amr");
    expect(balloon.textContent).toBe("");
    expect(balloon.querySelector(".sr-only")).toBeNull();
    // getByText doesn't skip aria-hidden nodes, so "no words" has to mean none.
    expect(screen.queryByText(/./)).toBeNull();
    expect(balloon.querySelector('[data-ink="scribble"]')).not.toBeNull();
  });

  it("is hidden from assistive tech, even if a call site says otherwise", () => {
    const balloon = first(render(<ThinkingBalloon aria-hidden={false} />).container);
    expect(balloon.getAttribute("aria-hidden")).toBe("true");
    expect(balloon.getAttribute("role")).toBeNull();
    expect(balloon.getAttribute("aria-live")).toBeNull();
  });

  it("never pulses, and its scribble stands still under reduced motion", () => {
    const balloon = first(render(<ThinkingBalloon />).container);
    for (const el of all(balloon)) {
      for (const c of classes(el)) expect(c).not.toMatch(/^animate-|pulse|bounce|ping/);
    }
    // The scribble's loop is the ink's own CSS, switched off for reduced motion.
    const reduced = GLOBALS.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}/g) ?? [];
    expect(reduced.some((block) => /\.ink-scribble \.ink-line/.test(block))).toBe(true);
  });
});

describe("YouCaption", () => {
  it("is the you caption, with the speaker outside the dir=auto element", () => {
    const caption = first(render(<YouCaption>{"first line\nsecond line"}</YouCaption>).container);
    expect(caption.classList.contains("comic-caption")).toBe(true);
    expect(caption.getAttribute("data-voice")).toBe("you");
    const prefix = caption.querySelector(".sr-only")!;
    expect(prefix).toHaveTextContent("You said:");
    expect(prefix.closest("[dir]")).toBeNull();
    const content = caption.querySelector('[dir="auto"]')!;
    expect(content.contains(prefix)).toBe(false);
    // The words as typed, line breaks kept.
    expect(content.textContent).toBe("first line\nsecond line");
    expect(content.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(caption.querySelector(".font-display")).toBeNull();
    expect(caption.classList.contains("font-sans")).toBe(true);
  });
});

describe("Narration", () => {
  it("is a plain narration caption: not a balloon, not the reader's, not a scene", () => {
    const caption = first(render(<Narration>Amr is working in Retro Board…</Narration>).container);
    expect(caption.classList.contains("comic-caption")).toBe(true);
    expect(caption.classList.contains("balloon")).toBe(false);
    expect(caption.getAttribute("data-voice")).not.toMatch(/^(you|scene)$/);
    expect(caption.getAttribute("data-tone")).toBe("note");
    expect(caption.querySelector(".sr-only")).toBeNull();
    expect(caption.querySelector("[data-caption-label], [data-caption-actions]")).toBeNull();
    // No label, no leading space.
    expect(caption.querySelector("[data-comic-content]")!.textContent).toBe(
      "Amr is working in Retro Board…"
    );
  });

  it("draws an error's danger line through data-tone", () => {
    const caption = first(
      render(<Narration tone="error">Amr couldn&apos;t reach the server.</Narration>).container
    );
    expect(caption.getAttribute("data-tone")).toBe("error");
    expect(caption).toHaveTextContent("Amr couldn't reach the server.");
  });

  it("puts the label first and the actions after the words, all in Inter", () => {
    const caption = first(
      render(
        <Narration
          label="Retro Board"
          actions={
            <>
              <button type="button">Try again</button>
              <button type="button">Go on</button>
            </>
          }
        >
          Amr added <span className="font-data">3</span> cards.
        </Narration>
      ).container
    );
    const label = caption.querySelector("[data-caption-label]")!;
    expect(label).toHaveTextContent("Retro Board");
    expect(label.classList.contains("font-medium")).toBe(true);
    const actions = caption.querySelector("[data-caption-actions]")!;
    expect(within(actions as HTMLElement).getAllByRole("button")).toHaveLength(2);
    const words = caption.querySelector("[data-comic-content]")!;
    expect(words.contains(label)).toBe(true);
    // A real space parts the label from the words, for readers, copy and find.
    expect(words.textContent).toBe("Retro Board Amr added 3 cards.");
    expect(words.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Captions are never lettered, the label and the data included.
    expect(caption.querySelector(".font-display")).toBeNull();
    expect(caption.classList.contains("font-display")).toBe(false);
    expect(caption.classList.contains("font-sans")).toBe(true);
  });

  it("is not a live region: the chat's status line and announcer speak", () => {
    const { container } = render(
      <Narration tone="error" label="Note" actions={<button type="button">Try again</button>}>
        Something
      </Narration>
    );
    for (const el of all(first(container))) {
      expect(el.getAttribute("role")).toBeNull();
      expect(el.getAttribute("aria-live")).toBeNull();
    }
  });

  it("passes id and tabIndex through, for the focus handoff", () => {
    const caption = first(
      render(
        <Narration id="failure" tabIndex={-1}>
          Amr stopped.
        </Narration>
      ).container
    );
    expect(caption.id).toBe("failure");
    expect(caption.tabIndex).toBe(-1);
  });
});

describe("SceneCaption", () => {
  it("is the scene caption, a short line in Inter", () => {
    const caption = first(render(<SceneCaption>Earlier today</SceneCaption>).container);
    expect(caption.tagName).toBe("P");
    expect(caption.classList.contains("comic-caption")).toBe(true);
    expect(caption.getAttribute("data-voice")).toBe("scene");
    expect(caption.classList.contains("font-sans")).toBe(true);
    expect(caption.querySelector(".font-display")).toBeNull();
  });
});

describe("the parts together", () => {
  it("keep the brand's class rules", () => {
    const strip = everyPart().getByTestId("strip");
    for (const el of all(strip)) {
      for (const c of classes(el)) {
        // Pills only for dots and bars, and none here; sentence case only.
        expect(c).not.toMatch(/^(?:[\w-]+:)*rounded-full$/);
        expect(c).not.toMatch(/^(?:[\w-]+:)*uppercase$/);
        // Nothing animates in, and nothing pulses.
        expect(c).not.toMatch(/^(?:[\w-]+:)*(?:animate-|fade-in|zoom-in|slide-in)/);
        // No glow, no gradient, no soft shadow: a balloon has no shadow at all.
        expect(c).not.toMatch(/^(?:[\w-]+:)*(?:shadow|drop-shadow|blur|bg-gradient|from-|to-)/);
        // Tokens only.
        expect(c).not.toMatch(/#[0-9a-f]{3,8}/i);
      }
    }
  });

  it("letter only a balloon's lead, never a caption, a detail or data", () => {
    const strip = everyPart().getByTestId("strip");
    const lettered = all(strip).filter((el) => el.classList.contains("font-display"));
    expect(lettered).toHaveLength(1);
    expect(lettered[0].hasAttribute("data-balloon-lead")).toBe(true);
    // Data spans and caption labels have no lettered ancestor inside a part.
    const quiet = strip.querySelectorAll(
      ".comic-caption .font-data, [data-caption-label], .balloon p .font-data"
    );
    expect(quiet.length).toBe(3);
    for (const el of Array.from(quiet)) {
      expect(el.closest(".font-display")).toBeNull();
    }
  });

  it("give each speaker one hidden prefix, and narration none", () => {
    const strip = everyPart().getByTestId("strip");
    const prefixes = Array.from(strip.querySelectorAll(".sr-only")).map((p) => p.textContent);
    expect(prefixes).toEqual(["Amr said: ", "You said: "]);
    for (const p of Array.from(strip.querySelectorAll(".sr-only"))) {
      expect(p.closest("[dir]")).toBeNull();
    }
  });

  it("render on a server, with no hooks", () => {
    const html = renderToStaticMarkup(
      <>
        <AmrBalloon lead="Hi.">There.</AmrBalloon>
        <ThinkingBalloon />
        <YouCaption>Hello</YouCaption>
        <Narration tone="error">Oops</Narration>
        <SceneCaption>Today</SceneCaption>
      </>
    );
    expect(html).toContain('data-tail="amr"');
    expect(html).toContain('data-voice="you"');
    expect(html).toContain('data-voice="scene"');
    expect(html).toContain('data-tone="error"');
    expect(html).toContain("Amr said: ");
  });
});

describe("the comic folder", () => {
  const files = readdirSync(COMIC_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
  const ALLOWED = /^(?:react|@\/lib\/utils|@\/components\/ink\/[\w-]+|@\/lib\/ink\/[\w/-]+)$/;

  it("imports only react, @/lib/utils and the ink art", () => {
    expect(files).toContain("comic-parts.tsx");
    for (const f of files) {
      const src = readFileSync(path.join(COMIC_DIR, f), "utf8");
      const specs = Array.from(src.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)).map(
        (m) => m[1]
      );
      for (const spec of specs) expect(spec, `${f} imports ${spec}`).toMatch(ALLOWED);
    }
  });

  it("is server-safe: no client directive and no hooks", () => {
    for (const f of files) {
      const src = readFileSync(path.join(COMIC_DIR, f), "utf8");
      expect(src, f).not.toMatch(/^["']use client["']/m);
      expect(src, f).not.toMatch(/\buse[A-Z]\w*\(/);
    }
  });

  it("writes none of the banned shapes or faces into its source", () => {
    expect(SOURCE).not.toMatch(/\b(?:rounded-full|uppercase|animate-pulse|animate-in)\b/);
    expect(SOURCE).not.toMatch(/\b(?:fade-in|zoom-in|glow|gradient|neon)\b/i);
    expect(SOURCE).not.toMatch(/\[#[0-9a-f]{3,8}\]/i);
    // Shantell is written into one class string: the lead's.
    const classStrings = Array.from(SOURCE.matchAll(/className=\{?(?:cn\()?\s*"([^"]*)"/g)).map(
      (m) => m[1]
    );
    expect(classStrings.length).toBeGreaterThan(5);
    expect(classStrings.filter((c) => /\bfont-display\b/.test(c))).toEqual([
      "font-display text-[0.9375rem]",
    ]);
  });
});
