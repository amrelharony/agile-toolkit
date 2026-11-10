/**
 * /book: the printed book in its own words, its cover on a still book, its
 * contents, and what search engines and link previews are told about it.
 */
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

import BookPage, { metadata } from "@/app/(tools)/book/page";
import sitemap from "@/app/sitemap";
import { BOOK_SHARE_URL, COVER_SMALL_URL, COVER_URL } from "@/lib/book/art";
import { BOOK } from "@/lib/book/book";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";

afterEach(cleanup);

describe("/book", () => {
  it("says what the cover says", () => {
    render(<BookPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeTruthy();
    expect(
      screen.getByText("26 Stories About Working Better Together, by Amr Elharony")
    ).toBeTruthy();
    expect(screen.getByText("Volume 1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Every team has its characters." })).toBeTruthy();
    for (const paragraph of BOOK.blurb) expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.getByText(BOOK.authorBio)).toBeTruthy();
    expect(screen.getByText("ISBN 978-977-95-9064-6")).toBeTruthy();
  });

  it("shows the front cover first, at the size the screen needs", () => {
    render(<BookPage />);
    const cover = screen.getByRole("img", { name: /^The front cover/ });
    expect(cover).toHaveAttribute("src", COVER_URL);
    expect(cover.getAttribute("srcset")).toContain(`${COVER_SMALL_URL} 540w`);
    expect(cover).toHaveAttribute("fetchpriority", "high");
    expect(cover).not.toHaveAttribute("loading", "lazy");
  });

  it("stands the front cover on a still book, by its page edges, ground, grain and light", () => {
    render(<BookPage />);
    const { cover, face, book } = stillBook();
    const edges = book.querySelector('[data-look="edges"]')!;
    // Each piece wears the rule the tests below read. Under vitest any CSS
    // module key gives a class, so the class itself is checked.
    expect(moduleNames(book)).toEqual(["still"]);
    expect(moduleNames(edges)).toEqual(["edges", "stillPages"]);
    expect(moduleNames(face)).toEqual(["stillFace"]);
    // It stands in the page's own grid, which adds nothing to the column the
    // room below is worked out from.
    expect(Array.from(book.parentElement!.classList).sort()).toEqual(
      ["grid", "gap-6", "md:grid-cols-[minmax(0,22rem)_1fr]", "md:items-start"].sort()
    );
    // The ground and the page block first, so the face, last and positioned,
    // paints over them; the book is what they are laid out against.
    expect(Array.from(book.children, (el) => el.getAttribute("data-look"))).toEqual([
      "ground",
      "edges",
      null,
    ]);
    expect(book.lastElementChild).toBe(face);
    expect(declaration(".still", "position")).toBe("relative");
    expect(declaration(".stillFace", "position")).toBe("relative");
    // On the face, the picture in the flow, then its grain and light over it.
    expect(Array.from(face.children, (el) => el.getAttribute("data-look"))).toEqual([
      null,
      "grain",
      "light",
    ]);
    expect(face.firstElementChild).toBe(cover);
    expect(edges.children).toHaveLength(4);
    for (const part of Array.from(book.querySelectorAll("[data-look]"))) {
      const look = part.getAttribute("data-look")!;
      expect(part, look).toHaveAttribute("aria-hidden", "true");
      expect(part.textContent, look).toBe("");
    }
    // Only the cover is a picture. And as every part but the face is a look
    // part, high contrast (globals.css BOOK LOOK) leaves the plain cover.
    expect(book.querySelectorAll("img, svg, canvas, video, picture")).toHaveLength(1);
  });

  it("keeps the book still: no class that animates or moves it, and no style of its own", () => {
    render(<BookPage />);
    const { book } = stillBook();
    // A CSS module's class is _<name>_<file hash> here; the grain's is the look's own.
    const lookFile = moduleClass(book.querySelector('[data-look="grain"]')!.classList[0])!;
    const css = readCss(LOOK_CSS);
    expect(css).not.toMatch(/@keyframes|\banimation(?:-[a-z-]+)?\s*:|\btransition\s*:/);
    for (const el of [book, ...Array.from(book.querySelectorAll("*"))]) {
      expect(el.hasAttribute("style"), el.tagName).toBe(false);
      for (const cls of Array.from(el.classList)) {
        expect(cls).not.toMatch(/(?:^|:)(?:animate-|transition)/);
        // Every module class is the static look's, never a scene's, and names
        // a class its stylesheet styles, so a misspelt key cannot slip by.
        const file = moduleClass(cls);
        if (file === null) continue;
        expect(file, cls).toBe(lookFile);
        expect(css, cls).toMatch(new RegExp(`\\.${moduleName(cls)}(?![\\w-])`));
      }
    }
  });

  it("takes the grain and light off the picture in print, forced colours and more contrast", () => {
    render(<BookPage />);
    const { face } = stillBook();
    for (const look of ["grain", "light"]) {
      const part = face.querySelector(`:scope > [data-look="${look}"]`)!;
      expect(
        Array.from(part.classList).some((c) => c.startsWith("_stillOver_")),
        look
      ).toBe(true);
    }
    const off =
      /@media print, \(forced-colors: active\), \(prefers-contrast: more\) \{\s*\.stillFace > \.stillOver \{\s*display: none;\s*\}\s*\}/;
    expect(readCss(LOOK_CSS)).toMatch(off);
  });

  it("gives the plain cover its whole column back in high contrast", () => {
    // High contrast hides every look part, the page block and ground among
    // them, under these two selectors (globals.css BOOK LOOK)...
    expect(readCss("src/app/globals.css")).toMatch(
      /\.hc \[data-look\],\s*\[data-theme="hc"\] \[data-look\] \{\s*display: none !important;\s*\}/
    );
    // ...and under the same two, the room the book keeps for them goes too.
    expect(readCss(LOOK_CSS)).toMatch(
      /:global\(\.hc\) \.still,\s*:global\(\[data-theme="hc"\]\) \.still \{\s*margin: 0;\s*\}/
    );
  });

  it("keeps the picture at least 92% as wide on a 375 px phone, and room for the pages and ground", () => {
    const frame = px(globalToken("--panel-w"), 0);
    // The hard shadow's x and y offsets.
    const [sx, sy] = globalToken("--shadow-3")
      .split(" ")
      .slice(0, 2)
      .map((v) => px(v, 0));
    // The book's box is its cover's, square, even beside a taller card.
    expect(declaration(".still", "align-self")).toBe("start");
    // The tool page's column at 375 px: .container-tool's 1rem gutters.
    const column = 375 - 2 * 16;
    // The cover filled the card inside its frame.
    const before = column - 2 * frame;
    expect(before).toBe(339);
    const room = px(declaration(".still", "margin-right"), column);
    const book = column - room;
    expect(declaration(".stillFace", "border")).toBe("var(--panel-w) solid var(--border)");
    const picture = book - 2 * frame;
    expect(picture / before).toBeGreaterThanOrEqual(0.92);
    // Right of the book: the page block's offset and hard shadow, and the ground's end.
    const offset = /^translate\((.+), (.+)\)$/.exec(declaration(".stillPages", "transform"))!;
    const [dx, dy] = [px(offset[1], book), px(offset[2], book)];
    expect(dx + sx).toBeLessThanOrEqual(room);
    expect(-px(declaration(".ground", "right"), book)).toBeLessThanOrEqual(room);
    // Below it: the same block, and the ground's foot.
    const below = px(declaration(".still", "margin-bottom"), column);
    const foot =
      px(declaration(".ground", "top"), book) + px(declaration(".ground", "height"), book) - book;
    expect(Math.max(dy + sy, foot)).toBeLessThanOrEqual(below);
  });

  it("lists all 26 episodes with the page each starts on, and links to none", () => {
    render(<BookPage />);
    const contents = screen.getByRole("list");
    const items = within(contents).getAllByRole("listitem");
    expect(items).toHaveLength(26);
    BOOK_EPISODES.forEach((episode, i) => {
      expect(items[i].textContent).toBe(`${episode.ep}${episode.title}page ${episode.bookPage}`);
    });
    expect(within(contents).queryAllByRole("link")).toEqual([]);
  });

  it("sends readers on to the comics", () => {
    render(<BookPage />);
    expect(screen.getByRole("link", { name: "Read the comics" })).toHaveAttribute(
      "href",
      "/comics"
    );
  });

  it("describes the book for search engines", () => {
    const { container } = render(<BookPage />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    const data = JSON.parse(script.textContent!);
    expect(data).toMatchObject({
      "@type": "Book",
      name: "Agile at Work",
      isbn: "9789779590646",
      url: "https://agile.amrelharony.com/book",
      author: { "@type": "Person", name: "Amr Elharony" },
      image: { contentUrl: `https://agile.amrelharony.com${COVER_URL}` },
    });
  });

  it("has its own address, share image and no-AI tag", () => {
    expect(metadata.alternates?.canonical).toBe("/book");
    expect(metadata.openGraph?.images).toEqual([`https://agile.amrelharony.com${BOOK_SHARE_URL}`]);
    expect(metadata.other).toEqual({ robots: "noai, noimageai" });
    expect(metadata.robots).toBeUndefined();
  });

  it("is in the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toContain("https://agile.amrelharony.com/book");
  });
});

/** The still book's stylesheet, the shared look the intros' books wear. */
const LOOK_CSS = "src/app/(tools)/comics/components/intro/intro-look.module.css";

/** The front cover, the book's face it sits in, and the still book around both. */
function stillBook() {
  const cover = screen.getByRole("img", { name: /^The front cover/ });
  const face = cover.parentElement!;
  return { cover, face, book: face.parentElement! };
}

/** A stylesheet's text with its comments out. */
function readCss(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The file hash in a CSS module's class (_<name>_<hash> under vitest), or null for any other class. */
function moduleClass(cls: string): string | null {
  return /^_\w+_([0-9a-z]+)$/.exec(cls)?.[1] ?? null;
}

/** The key a CSS module's class was asked for by (the <name> in _<name>_<hash>). */
function moduleName(cls: string): string {
  return /^_(\w+)_[0-9a-z]+$/.exec(cls)![1];
}

/** The CSS module keys an element's own classes come from, in order. */
function moduleNames(el: Element): string[] {
  return Array.from(el.classList)
    .filter((cls) => moduleClass(cls) !== null)
    .map(moduleName);
}

/** One declaration of the look's rule written for `selector` alone, whitespace evened out. */
function declaration(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = Array.from(
    readCss(LOOK_CSS).matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`, "g"))
  );
  expect(rules, selector).toHaveLength(1);
  const found = rules[0][1]
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${property}:`));
  expect(found, `${selector} ${property}`).toBeDefined();
  return found!
    .slice(property.length + 1)
    .replace(/\s+/g, " ")
    .trim();
}

/** A theme token's first value in globals.css (Night, the base every theme starts from). */
function globalToken(name: string): string {
  const found = new RegExp(`${name}:\\s*([^;]+);`).exec(readCss("src/app/globals.css"));
  expect(found, name).not.toBeNull();
  return found![1].trim();
}

/** A length in px, given what 100% is: 4%, 3px, -3% or calc(4% + 3px). */
function px(value: string, whole: number): number {
  const inner = /^calc\((.*)\)$/.exec(value)?.[1] ?? value;
  return inner.split(/\s\+\s/).reduce((sum, term) => {
    const m = /^(-?\d*\.?\d+)(%|px)$/.exec(term.trim());
    if (!m) throw new Error(`not a length: ${value}`);
    return sum + (m[2] === "%" ? (Number(m[1]) / 100) * whole : Number(m[1]));
  }, 0);
}
