import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COMIC_LAST_PAGE_KEY } from "@/lib/comic/agile-at-work";
import {
  EMPTY_COMIC_CONTENT,
  MAX_CHAPTER_TOOLS,
  chapterForPage,
  chapterLastPage,
  chapterTools,
  comicContentProblems,
  hasComicContent,
  lineText,
  normalizeComicContent,
  pageAlt,
  pageRangeLabel,
  type ComicChapter,
  type ComicContent,
} from "@/lib/comic/content";
import { resumablePage, validLastPage } from "@/lib/comic/last-page";
import { getToolById } from "@/lib/constants/tools";

/**
 * Agile at Work, Phase 8 (a scoped upgrade: "a text transcript per page
 * (real alt text), a table of contents, 'try this tool' links per
 * chapter"). Covers the content reader (validation, chapters, alt text),
 * the reader with a fixture (the Transcript panel, the screen-reader text,
 * Contents, the tool links, the live region), the shipped file staying
 * hidden while it is empty, and the resume point's move from raw storage
 * calls to usePersistedLocal with the same key and value format.
 *
 * The fixture text below exists only in this test: the shipped content
 * file stays empty until the owner supplies the real script (U1).
 */

const { loadPdfjs, emit, shipped } = vi.hoisted(() => ({
  loadPdfjs: vi.fn(),
  emit: vi.fn(),
  // What the mocked content module exports; mutated in place per test.
  shipped: { chapters: [], pages: [] } as { chapters: unknown[]; pages: unknown[] },
}));

vi.mock("@/lib/pdf/load-pdfjs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf/load-pdfjs")>()),
  loadPdfjs,
}));
vi.mock("@/lib/sonification/emit", () => ({ emit }));
vi.mock("@/lib/comic/agile-at-work-content", () => ({ AGILE_AT_WORK_CONTENT: shipped }));

import { ComicReader } from "@/app/(tools)/agile-at-work/components/comic-reader";
import { COMIC_TRANSCRIPT_KEY } from "@/app/(tools)/agile-at-work/hooks/use-comic-content";

const SRC = "/comics/agile-at-work.pdf?v=abc123";
const SIZE = 12_897_485;

const FIXTURE: ComicContent = {
  chapters: [
    { title: "Fixture chapter A", firstPage: 2, tools: ["kanban", "impediments"] },
    { title: "Fixture chapter B", firstPage: 5, tools: ["retro-actions"] },
    { title: "Fixture chapter C", firstPage: 9, tools: ["sprint-review"] },
  ],
  pages: [
    {
      page: 2,
      alt: "Fixture description two.",
      lines: [{ speaker: "Speaker One", text: "Fixture line one." }, { text: "Fixture caption." }],
    },
    { page: 3, alt: "Fixture description three.", lines: [] },
    {
      page: 4,
      alt: "Fixture description four.",
      lines: [{ speaker: "Speaker Two", text: "Four." }],
    },
  ],
};

// ── The fake pdf.js scaffold (as in test/comic/comic-reader.test.tsx) ─────

function fakePdfjs(numPages = 24) {
  const doc = {
    numPages,
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 900 * scale }),
      render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      cleanup: vi.fn(),
    })),
  };
  const task = {
    promise: Promise.resolve(doc),
    onProgress: null as unknown,
    destroy: vi.fn(async () => {}),
  };
  return { VerbosityLevel: { ERRORS: 0 }, getDocument: vi.fn(() => task) };
}

let blobCount = 0;

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => `blob:page-${++blobCount}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/agile-at-work");
  localStorage.clear();
  shipped.chapters = [];
  shipped.pages = [];
  emit.mockReset();
  loadPdfjs.mockReset();
  loadPdfjs.mockResolvedValue(fakePdfjs());
  // 800 px wide: below the 900 px spread threshold, so single pages.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 900,
    top: 0,
    left: 0,
    right: 800,
    bottom: 900,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    fillStyle: "",
    fillRect: () => {},
  })) as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb: BlobCallback) =>
    cb(new Blob(["jpeg"], { type: "image/jpeg" }))
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

const genericAlt = (p: number, n = 24) => `Agile at Work — page ${p} of ${n}`;
const stage = () => screen.getByRole("region", { name: "Agile at Work comic" });
const live = () => document.querySelector("[aria-live]")?.textContent;

async function openOn(page: number, content: ComicContent | undefined = FIXTURE) {
  if (page > 1) window.history.replaceState(null, "", `/agile-at-work#page=${page}`);
  const view = render(<ComicReader src={SRC} size={SIZE} content={content} />);
  await screen.findByRole("img", {
    name: new RegExp(`^(Page ${page} of 24|.*page ${page} of 24)`),
  });
  return view;
}

function next() {
  fireEvent.keyDown(window, { key: "ArrowRight" });
}

// ── The content reader ───────────────────────────────────────────────────

describe("comic content", () => {
  it("ships a content file with no problems (every tool id is in the catalog)", async () => {
    const actual = await vi.importActual<typeof import("@/lib/comic/agile-at-work-content")>(
      "@/lib/comic/agile-at-work-content"
    );
    expect(comicContentProblems(actual.AGILE_AT_WORK_CONTENT)).toEqual([]);
    for (const chapter of normalizeComicContent(actual.AGILE_AT_WORK_CONTENT).chapters) {
      expect(chapter.tools.length, chapter.title).toBeGreaterThan(0);
      expect(chapter.tools.length, chapter.title).toBeLessThanOrEqual(MAX_CHAPTER_TOOLS);
    }
  });

  it("reads the fixture as written", () => {
    expect(comicContentProblems(FIXTURE, 24)).toEqual([]);
    expect(normalizeComicContent(FIXTURE, 24)).toEqual(FIXTURE);
    expect(hasComicContent(normalizeComicContent(FIXTURE, 24))).toBe(true);
    expect(hasComicContent(EMPTY_COMIC_CONTENT)).toBe(false);
  });

  it("drops unknown tool ids, the comic itself and repeats, and keeps at most 3", () => {
    const raw = {
      chapters: [
        {
          title: "T",
          firstPage: 1,
          tools: [
            "kanban",
            "kanbn",
            "agile-at-work",
            "kanban",
            " impediments ",
            "okrs",
            "nps-csat",
          ],
        },
      ],
    };
    const [chapter] = normalizeComicContent(raw).chapters;
    expect(chapter.tools).toEqual(["kanban", "impediments", "okrs"]);
    const problems = comicContentProblems(raw);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"kanbn" is not a tool id'),
        expect.stringContaining('"agile-at-work" is not a tool id'),
        expect.stringContaining("lists 4 tools; only the first 3 are shown"),
      ])
    );
  });

  it("ignores pages and chapters past the last page, and sets no bound while it is unknown", () => {
    const raw = {
      chapters: [
        { title: "In", firstPage: 3, tools: ["kanban"] },
        { title: "Past", firstPage: 25, tools: ["kanban"] },
      ],
      pages: [
        { page: 24, alt: "Last.", lines: [] },
        { page: 25, alt: "Past.", lines: [] },
        { page: 1_000_000_000, alt: "Huge.", lines: [] },
      ],
    };
    const bounded = normalizeComicContent(raw, 24);
    expect(bounded.chapters.map((c) => c.title)).toEqual(["In"]);
    expect(bounded.pages.map((p) => p.page)).toEqual([24]);
    expect(comicContentProblems(raw, 24)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("starts on page 25, past the last page"),
        expect.stringContaining("(page 25): is past the last page"),
      ])
    );
    for (const unknown of [undefined, 0, NaN]) {
      const unbounded = normalizeComicContent(raw, unknown);
      expect(unbounded.chapters).toHaveLength(2);
      expect(unbounded.pages).toHaveLength(3);
    }
  });

  it("keeps the first of two entries for a page, sorts both lists and flags the order", () => {
    const raw = {
      chapters: [
        { title: "Second", firstPage: 9, tools: ["kanban"] },
        { title: "First", firstPage: 2, tools: ["kanban"] },
        { title: "Twin", firstPage: 9, tools: ["kanban"] },
      ],
      pages: [
        { page: 7, alt: "Seven.", lines: [] },
        { page: 3, alt: "Three.", lines: [] },
        { page: 7, alt: "Seven again.", lines: [] },
      ],
    };
    const content = normalizeComicContent(raw);
    expect(content.chapters.map((c) => c.title)).toEqual(["First", "Second"]);
    expect(content.pages.map((p) => p.alt)).toEqual(["Three.", "Seven."]);
    expect(comicContentProblems(raw)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"First": is out of page order'),
        expect.stringContaining('"Twin": another chapter already starts on page 9'),
        expect.stringContaining("page 7 is listed twice"),
      ])
    );
  });

  it("rejects page numbers that aren't whole pages, and blank titles", () => {
    const raw = {
      chapters: [
        { title: "  ", firstPage: 2, tools: ["kanban"] },
        { title: "Zero", firstPage: 0, tools: ["kanban"] },
        { title: "Text", firstPage: "4", tools: ["kanban"] },
        { title: "No tools", firstPage: 6 },
      ],
      pages: [
        { page: -1, alt: "Negative.", lines: [] },
        { page: 1.5, alt: "Fraction.", lines: [] },
        { page: Infinity, alt: "Infinite.", lines: [] },
        { page: "2", alt: "Text.", lines: [] },
      ],
    };
    const content = normalizeComicContent(raw);
    // A chapter without tools is still a chapter (Contents lists it).
    expect(content.chapters).toEqual([{ title: "No tools", firstPage: 6, tools: [] }]);
    expect(content.pages).toEqual([]);
    expect(comicContentProblems(raw)).toEqual(
      expect.arrayContaining([
        "chapters[0]: has no title",
        expect.stringContaining('"Zero": firstPage should be a page number'),
        expect.stringContaining('"No tools": lists no tools (give 1-3)'),
        "pages[0]: page should be a page number (1 or more)",
      ])
    );
  });

  it("never throws on a malformed file", () => {
    for (const raw of [
      undefined,
      null,
      "text",
      42,
      [],
      { chapters: "x", pages: 7 },
      { pages: [1] },
    ]) {
      expect(normalizeComicContent(raw, 24)).toEqual(EMPTY_COMIC_CONTENT);
    }
    expect(comicContentProblems({ chapters: "x", pages: 7 })).toEqual([
      "chapters: should be a list",
      "pages: should be a list",
    ]);
    expect(comicContentProblems(null)).toEqual([]);
    expect(comicContentProblems("text")).toEqual(["content: should be an object"]);
  });

  it("trims the lettering, drops blank lines and keeps a page that has only lines", () => {
    const raw = {
      pages: [
        {
          page: 2,
          alt: "  ",
          lines: [
            { speaker: "  Sam ", text: " Hello. " },
            { speaker: " ", text: "Caption." },
            { speaker: "Ana", text: "   " },
            "loose string",
          ],
        },
        { page: 3, alt: "", lines: [] },
      ],
    };
    const { pages } = normalizeComicContent(raw);
    expect(pages).toEqual([
      { page: 2, alt: "", lines: [{ speaker: "Sam", text: "Hello." }, { text: "Caption." }] },
    ]);
    expect(lineText(pages[0].lines[0])).toBe("Sam: Hello.");
    expect(lineText(pages[0].lines[1])).toBe("Caption.");
    const problems = comicContentProblems(raw);
    expect(problems).toContain("pages[0] (page 2): lines[2] has no text");
    expect(problems).toContain("pages[0] (page 2): lines[3] has no text");
    expect(problems).toContain(
      "pages[0] (page 2): has no alt text (the page keeps its generic alt)"
    );
  });

  it("reads 1,000 pages of transcript quickly", () => {
    const pages = Array.from({ length: 1000 }, (_, i) => ({
      page: 1000 - i,
      alt: `Alt ${i}.`,
      lines: [{ text: `Line ${i}.` }],
    }));
    const started = performance.now();
    const content = normalizeComicContent({ pages }, 1000);
    expect(performance.now() - started).toBeLessThan(500);
    expect(content.pages).toHaveLength(1000);
    expect(content.pages[0].page).toBe(1);
  });
});

describe("chapters and alt text", () => {
  const chapters = FIXTURE.chapters;

  it("finds the chapter a page belongs to", () => {
    expect(chapterForPage(chapters, 1)?.title).toBeUndefined(); // the cover, before chapter A
    expect(chapterForPage(chapters, 2)?.title).toBe("Fixture chapter A");
    expect(chapterForPage(chapters, 4)?.title).toBe("Fixture chapter A"); // A's last page
    expect(chapterForPage(chapters, 5)?.title).toBe("Fixture chapter B");
    expect(chapterForPage(chapters, 24)?.title).toBe("Fixture chapter C");
    expect(chapterForPage([], 7)).toBeNull();
  });

  it("gives each chapter's last page and its range label", () => {
    expect(chapters.map((_, i) => chapterLastPage(chapters, i, 24))).toEqual([4, 8, 24]);
    const oneEach: ComicChapter[] = [
      { title: "a", firstPage: 1, tools: [] },
      { title: "b", firstPage: 2, tools: [] },
    ];
    expect(chapterLastPage(oneEach, 0, 2)).toBe(1);
    expect(chapterLastPage(oneEach, 1, 2)).toBe(2);
    expect(pageRangeLabel(2, 4)).toBe("p. 2–4");
    expect(pageRangeLabel(7, 7)).toBe("p. 7");
  });

  it("keeps exactly the old alt text for a page without a description", () => {
    expect(pageAlt(3, 24)).toBe(genericAlt(3));
    expect(pageAlt(3, 24, { page: 3, alt: "", lines: [{ text: "Hi." }] })).toBe(genericAlt(3));
    expect(pageAlt(3, 24, { page: 3, alt: "A described page.", lines: [] })).toBe(
      "Page 3 of 24: A described page."
    );
  });

  it("resolves a chapter's tools through the catalog, in order", () => {
    const tools = chapterTools(chapters[0]);
    expect(tools.map((t) => [t.name, t.path])).toEqual(
      ["kanban", "impediments"].map((id) => [getToolById(id)!.name, getToolById(id)!.path])
    );
    // An id the catalog dropped since the file was written is skipped.
    expect(chapterTools({ title: "x", firstPage: 1, tools: ["gone", "kanban"] })).toHaveLength(1);
  });
});

// ── The resume point ─────────────────────────────────────────────────────

describe("resume point", () => {
  it("accepts what the first reader stored, and nothing else", () => {
    expect(validLastPage(7)).toBe(7);
    expect(validLastPage("7")).toBe(7);
    for (const bad of [
      null,
      undefined,
      0,
      -3,
      1.5,
      NaN,
      Infinity,
      "",
      " ",
      "seven",
      true,
      [7],
      {},
    ]) {
      expect(validLastPage(bad), String(bad)).toBeNull();
    }
    expect(resumablePage(7, 24)).toBe(7);
    expect(resumablePage(24, 24)).toBe(24);
    expect(resumablePage(1, 24)).toBeNull(); // the cover: nothing to resume
    expect(resumablePage(25, 24)).toBeNull(); // a shorter re-export
    expect(resumablePage(Number.MAX_SAFE_INTEGER, 24)).toBeNull();
  });

  it.each([
    ["a JSON number", "7"],
    ["a JSON string", '"7"'],
  ])("still offers a position saved as %s under the old key", async (_, stored) => {
    localStorage.setItem(COMIC_LAST_PAGE_KEY, stored);
    await openOn(1, EMPTY_COMIC_CONTENT);
    fireEvent.click(await screen.findByRole("button", { name: /Continue from p\. 7/ }));
    expect(await screen.findByAltText(genericAlt(7))).toBeInTheDocument();
  });

  it.each([["garbage"], ["30"], ["1"], ["null"]])(
    "offers nothing for a stored %s",
    async (stored) => {
      localStorage.setItem(COMIC_LAST_PAGE_KEY, stored);
      await openOn(1, EMPTY_COMIC_CONTENT);
      await act(async () => {});
      expect(screen.queryByRole("button", { name: /Continue from/ })).toBeNull();
    }
  );

  it("saves the page read as a JSON number under the same key", async () => {
    await openOn(1, EMPTY_COMIC_CONTENT);
    next();
    next();
    await screen.findByAltText(genericAlt(3));
    await waitFor(() => expect(localStorage.getItem(COMIC_LAST_PAGE_KEY)).toBe("3"), {
      timeout: 3000,
    });
  });

  it("leaves no raw storage call in the tool folder", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/agile-at-work");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((name) => {
        const p = path.join(d, name);
        return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
      });
    const src = files(dir)
      .map((f) =>
        readFileSync(f, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
      )
      .join("\n");
    expect(src).not.toMatch(/\blocalStorage\s*\./);
  });
});

// ── The reader ───────────────────────────────────────────────────────────

describe("reader without content", () => {
  it("adds nothing while the content is empty", async () => {
    await openOn(1, EMPTY_COMIC_CONTENT);
    next();
    const img = await screen.findByAltText(genericAlt(2));
    expect(img).not.toHaveAttribute("aria-describedby");
    expect(live()).toBe("Page 2 of 24");
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Transcript" })).toBeNull();
    expect(screen.queryByText("Try it yourself")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Try / })).toBeNull();
  });

  it("loads the shipped file on demand, and shows nothing while it is empty", async () => {
    const first = render(<ComicReader src={SRC} size={SIZE} />);
    await screen.findByAltText(genericAlt(1));
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
    first.unmount();

    // Once the owner fills it in, the same reader picks it up.
    shipped.chapters = FIXTURE.chapters;
    shipped.pages = FIXTURE.pages;
    render(<ComicReader src={SRC} size={SIZE} />);
    expect(await screen.findByRole("button", { name: "Contents" })).toBeInTheDocument();
  });
});

describe("reader with a transcript", () => {
  it("describes a page from its transcript and links its lettering", async () => {
    await openOn(1);
    // The cover has no transcript: the old alt, no description.
    expect(screen.getByAltText(genericAlt(1))).not.toHaveAttribute("aria-describedby");

    next();
    const img = await screen.findByAltText("Page 2 of 24: Fixture description two.");
    const id = img.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(
      "Speaker One: Fixture line one.Fixture caption."
    );
    // Outside the crossfade, inside the reader region.
    expect(stage()).toContainElement(document.getElementById(id!));
    expect(img).toHaveAccessibleDescription("Speaker One: Fixture line one. Fixture caption.");

    // A wordless page has a description (alt) but nothing to link.
    next();
    const three = await screen.findByAltText("Page 3 of 24: Fixture description three.");
    expect(three).not.toHaveAttribute("aria-describedby");
  });

  it("opens the Transcript panel, remembers it, and is unavailable without one", async () => {
    await openOn(1);
    const toggle = screen.getByRole("button", { name: "Transcript" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.queryByRole("region", { name: "Transcript" })).toBeNull();

    next();
    await screen.findByAltText(/^Page 2 of 24/);
    expect(toggle).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Transcript" });
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(within(panel).getByRole("heading", { name: "Page 2" })).toBeInTheDocument();
    expect(within(panel).getByText("Fixture description two.")).toBeInTheDocument();
    expect(within(panel).getByText("Fixture line one.")).toBeInTheDocument();
    expect(within(panel).getByText("Speaker One:")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(COMIC_TRANSCRIPT_KEY)).toBe("true"));

    // On screen now, so the screen-reader copy is hidden (and still describes).
    const img = screen.getByAltText(/^Page 2 of 24/);
    const desc = document.getElementById(img.getAttribute("aria-describedby")!);
    expect(desc?.parentElement).toHaveAttribute("hidden");

    // A page without a transcript: no panel, the preference kept.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await screen.findByAltText(genericAlt(1));
    expect(screen.queryByRole("region", { name: "Transcript" })).toBeNull();
    expect(localStorage.getItem(COMIC_TRANSCRIPT_KEY)).toBe("true");
  });

  it("opens with the panel open when this device left it open", async () => {
    localStorage.setItem(COMIC_TRANSCRIPT_KEY, "true");
    await openOn(4);
    const panel = await screen.findByRole("region", { name: "Transcript" });
    expect(within(panel).getByText("Four.")).toBeInTheDocument();
  });

  it("shows both pages of a spread", async () => {
    localStorage.setItem(COMIC_TRANSCRIPT_KEY, "true");
    await openOn(1);
    fireEvent.click(screen.getByRole("button", { name: "Spread" }));
    next();
    const panel = await screen.findByRole("region", { name: "Transcript" });
    expect(within(panel).getByRole("heading", { name: "Page 2" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Page 3" })).toBeInTheDocument();
    expect(within(panel).getByText("Fixture description three.")).toBeInTheDocument();

    // 4–5: page 5 has none, and says so.
    next();
    await screen.findByAltText(/^Page 4 of 24/);
    expect(
      within(screen.getByRole("region", { name: "Transcript" })).getByText(
        "Page 5 has no transcript yet."
      )
    ).toBeInTheDocument();
  });
});

describe("reader with chapters", () => {
  it("lists the chapters, marks the current one and jumps to a chapter's first page", async () => {
    await openOn(3);
    const toggle = screen.getByRole("button", { name: "Contents" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const nav = screen.getByRole("navigation", { name: "Contents" });
    expect(toggle).toHaveAttribute("aria-controls", nav.id);
    const entries = within(nav).getAllByRole("button");
    expect(entries.map((b) => b.textContent)).toEqual([
      "Fixture chapter AReadingp. 2–4, pages 2 to 4",
      "Fixture chapter Bp. 5–8, pages 5 to 8",
      "Fixture chapter Cp. 9–24, pages 9 to 24",
    ]);
    expect(entries[0]).toHaveAttribute("aria-current", "true");
    expect(entries[1]).not.toHaveAttribute("aria-current");

    fireEvent.click(entries[1]);
    expect(await screen.findByAltText(genericAlt(5))).toBeInTheDocument();
    expect(document.activeElement).toBe(stage());
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
    expect(window.location.hash).toBe("#page=5");

    fireEvent.click(toggle);
    expect(
      within(screen.getByRole("navigation", { name: "Contents" })).getByRole("button", {
        current: true,
      })
    ).toHaveAccessibleName(/^Fixture chapter B/);
  });

  it("counts a spread as the chapter its right-hand page opens", async () => {
    await openOn(1);
    fireEvent.click(screen.getByRole("button", { name: "Spread" }));
    next(); // 2–3
    next(); // 4–5: chapter B starts on page 5
    await screen.findByAltText(/^Page 4 of 24/);
    expect(screen.getByText("Fixture chapter B", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Contents" }));
    const current = within(screen.getByRole("navigation", { name: "Contents" })).getByRole(
      "button",
      { current: true }
    );
    expect(current).toHaveAccessibleName(/^Fixture chapter B/);
  });

  it("names the chapter in the live region when the view enters it", async () => {
    await openOn(1);
    expect(live()).toBe("Page 1 of 24");
    next();
    await screen.findByAltText(/^Page 2 of 24/);
    expect(live()).toBe("Page 2 of 24 — Fixture chapter A");
    next();
    await screen.findByAltText(/^Page 3 of 24/);
    expect(live()).toBe("Page 3 of 24");
    next();
    next();
    await screen.findByAltText(genericAlt(5));
    expect(live()).toBe("Page 5 of 24 — Fixture chapter B");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await screen.findByAltText(/^Page 4 of 24/);
    expect(live()).toBe("Page 4 of 24 — Fixture chapter A");
  });

  it("links each chapter's tools to their catalog paths", async () => {
    await openOn(1);
    // The cover is before chapter A: no card yet.
    expect(screen.queryByText("Try it yourself")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Contents" }));
    const nav = screen.getByRole("navigation", { name: "Contents" });
    const lists = within(nav).getAllByRole("list", { name: /^Tools from / });
    expect(
      lists.map((l) =>
        within(l)
          .getAllByRole("link")
          .map((a) => a.getAttribute("href"))
      )
    ).toEqual(FIXTURE.chapters.map((c) => c.tools.map((id) => getToolById(id)!.path)));

    next();
    await screen.findByAltText(/^Page 2 of 24/);
    const card = screen.getByRole("complementary", { name: "Tools from “Fixture chapter A”" });
    expect(
      within(card)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")])
    ).toEqual(
      ["kanban", "impediments"].map((id) => [`Try ${getToolById(id)!.name}`, getToolById(id)!.path])
    );
  });

  it("works inside the immersive overlay, without a portal of its own", async () => {
    await openOn(2);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    const dialog = await screen.findByRole("dialog", { name: "Agile at Work reader" });
    // The next-step card stays with the page, not the overlay.
    expect(within(dialog).queryByText("Try it yourself")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Contents" }));
    const nav = within(dialog).getByRole("navigation", { name: "Contents" });
    fireEvent.click(within(nav).getByRole("button", { name: /^Fixture chapter C/ }));
    expect(await within(dialog).findByAltText(genericAlt(9))).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("region", {
        name: "Agile at Work comic",
      })
    );
  });

  it("keeps the panels phone-safe: wrapping rows, no fixed widths", async () => {
    localStorage.setItem(COMIC_TRANSCRIPT_KEY, "true");
    await openOn(2);
    fireEvent.click(screen.getByRole("button", { name: "Contents" }));
    const nav = screen.getByRole("navigation", { name: "Contents" });
    const panel = screen.getByRole("region", { name: "Transcript" });
    const card = screen.getByRole("complementary", { name: /^Tools from / });
    const toggles = screen.getByRole("button", { name: "Contents" }).parentElement!;

    expect(toggles.className).toMatch(/\bflex-wrap\b/);
    for (const list of screen.getAllByRole("list", { name: /^Tools from / })) {
      expect(list.className).toMatch(/\bflex-wrap\b/);
    }
    const all = (root: HTMLElement) => [
      root,
      ...Array.from(root.querySelectorAll<HTMLElement>("*")),
    ];
    const cls = (el: Element) => (typeof el.className === "string" ? el.className : "");
    for (const root of [nav, panel, card, toggles]) {
      for (const el of all(root)) {
        expect(cls(el), cls(el)).not.toMatch(/(?:^|\s)(?:min-)?w-\[\d+(?:px|rem)\]/);
        expect(el.style.width).toBe("");
      }
    }
    // Owner-written text never sits on one unbreakable line (the toggles'
    // own short labels are the shared Button's nowrap, which is fine).
    for (const root of [nav, panel, card]) {
      for (const el of all(root)) {
        expect(cls(el), cls(el)).not.toMatch(/\bwhitespace-nowrap\b|\btruncate\b/);
      }
    }
    // Long, owner-written text wraps instead of widening the page.
    for (const title of within(nav).getAllByText(/^Fixture chapter/)) {
      expect(title.className).toMatch(/\bbreak-words\b/);
    }
  });
});
