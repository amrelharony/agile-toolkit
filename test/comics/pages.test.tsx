import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { StoryExtras } from "@/lib/comics/extras";
import type { StoryGuessExtras } from "@/lib/comics/guess";
import type { Story, StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({
  story: null as Story | null,
  summaries: [] as StorySummary[],
  released: [] as number[],
  listThrows: false,
  push: vi.fn(),
  extras: { quiz: null, tryTool: null } as StoryExtras,
  extrasCalls: [] as number[],
  guess: { guess: null, tryAction: null } as StoryGuessExtras,
  totals: { views: 0, visitors: 0, readers: 0, loves: 0, shares: 0, retros: 0, tools: 0 },
  totalsMap: new Map<number, { loves: number }>(),
  owner: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  getReleasedStory: async () => h.story,
  getStoryExtras: async (ep: number) => {
    h.extrasCalls.push(ep);
    return h.extras;
  },
  getStoryGuess: async () => h.guess,
  getStoryTotals: async () => h.totals,
  listStoryTotals: async () => h.totalsMap,
  listReleasedWeekly: async (limit?: number) => (limit ? h.summaries.slice(0, limit) : h.summaries),
  listReleasedEps: async () => {
    if (h.listThrows) throw new Error("down");
    return h.released;
  },
}));
// No AuthProvider here, so everyone is a visitor unless a test says otherwise.
vi.mock("@/lib/auth/use-is-owner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/use-is-owner")>()),
  useIsOwner: () => h.owner,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  // Outside the app router there are no search params; the visit recorder reads the address.
  useSearchParams: () => null,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ComicsPage, { metadata as galleryMetadata } from "@/app/(tools)/comics/page";
import ComicStoryPage, {
  generateMetadata as storyMetadata,
  generateStaticParams as storyParams,
} from "@/app/(tools)/comics/ep/[n]/page";
import ComicLicensePage, { metadata as licenseMetadata } from "@/app/(tools)/comics/license/page";
import { BOOK_SHARE_URL } from "@/lib/book/art";
import { bookDescriptionFor } from "@/lib/comics/book-descriptions";
import { BOOK_DIALOGUE } from "@/lib/comics/book-dialogue";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { POSTER_ART } from "@/lib/comics/poster-panels.generated";

const STORAGE = "https://ref.supabase.co/storage/v1/object/public/comic-panels/";

const STORY: Story = {
  ep: 30,
  collection: "weekly",
  title: "The Unread Handover",
  lesson: "Write it down before you leave.",
  squadQuestion: "What would we lose if you left today?",
  castNames: ["Amr", "Dina"],
  themes: ["T08"],
  panels: [
    {
      pathFull: "stories/30/one-1536.webp",
      pathSmall: "stories/30/one-768.webp",
      width: 1536,
      height: 1024,
      alt: "Dina holds a thick folder at her desk.",
      dialogue: [{ speaker: "Dina", line: "Where did the notes go?" }],
      signs: ["Handover"],
    },
    {
      pathFull: "stories/30/two-1536.webp",
      pathSmall: "stories/30/two-768.webp",
      width: 1536,
      height: 1024,
      alt: "Amr shrugs by the printer.",
      dialogue: [{ speaker: "Amr", line: "I thought you had them." }],
      signs: [],
    },
  ],
  sharePath: "stories/30/share.jpg",
  bookPage: null,
  releaseAt: "2026-10-26T07:00:00.000Z",
  updatedAt: "2026-10-26T07:00:00.000Z",
};

const summary = (ep: number, title: string, extra: Partial<StorySummary> = {}): StorySummary => ({
  ep,
  title,
  lesson: `Lesson of ${title}`,
  castNames: ["Amr"],
  themes: ["T01"],
  cover: { pathSmall: `stories/${ep}/one-768.webp`, width: 1536, height: 1024 },
  releaseAt: "2026-10-26T07:00:00.000Z",
  updatedAt: "2026-10-26T07:00:00.000Z",
  ...extra,
});

const params = (n: string | number) => ({ params: { n: String(n) } });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  h.story = null;
  h.summaries = [];
  h.released = [];
  h.listThrows = false;
  h.push.mockClear();
  h.extras = { quiz: null, tryTool: null };
  h.extrasCalls = [];
  h.guess = { guess: null, tryAction: null };
  h.totals = { views: 0, visitors: 0, readers: 0, loves: 0, shares: 0, retros: 0, tools: 0 };
  h.totalsMap = new Map();
  h.owner = false;
  localStorage.clear();
  window.history.replaceState(null, "", "/comics");
  vi.stubGlobal("sendBeacon", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.querySelectorAll("[inert]").forEach((el) => el.removeAttribute("inert"));
});

/** Any image but Amr beside an empty state's balloon. */
const comicArt = () => document.querySelector('img:not([alt="Amr, waiting"])');

describe("a book episode", () => {
  beforeEach(() => {
    h.summaries = [
      summary(40, "Newest"),
      summary(39, "Older"),
      summary(38, "Oldest"),
      summary(37, "Too old"),
    ];
  });

  it("shows what its poster and kudos card print, and where to read it", async () => {
    render(await ComicStoryPage(params(12)));
    expect(screen.getByRole("heading", { level: 1, name: "But You Were Closed!" })).toBeTruthy();
    expect(screen.getByText("Real needs")).toBeTruthy();
    expect(
      screen.getByText("Before speaking for everyone, check whose voices you have not heard.")
    ).toBeTruthy();
    expect(screen.getByText("Ask your team:")).toBeTruthy();
    expect(
      screen.getByText("Who is missing from our feedback, and how will we reach them?")
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Read the full story: book page 73" })).toBeTruthy();
    expect(
      screen.getByText("Borrow Agile at Work by Amr Elharony from your Scrum Master.")
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Thank someone for this habit/ })).toHaveAttribute(
      "href",
      "/kudos?ep=12&src=comics"
    );
    // The poster's four panels, never a promise that the comic is coming.
    expect(
      screen.getAllByRole("button", { name: /^Open panel \d of 4 full screen$/ })
    ).toHaveLength(4);
    expect(screen.queryByText("The comic will appear here soon")).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
    // The scan that brought someone here is counted, and the page says so.
    expect(screen.getByText(/one anonymous count when you arrive/)).toBeTruthy();
  });

  it("shows the poster's panels, described, with the words they carry", async () => {
    render(await ComicStoryPage(params(12)));
    const panels = within(screen.getByRole("region", { name: "Comic panels" }));
    const pictures = panels.getAllByRole("img");
    expect(pictures.map((img) => img.getAttribute("src"))).toEqual(
      POSTER_ART[12].panels.map((files) => `${STORAGE}${files.small}`)
    );
    expect(pictures.map((img) => img.getAttribute("alt"))).toEqual(
      [1, 2, 3, 4].map((n) => bookDescriptionFor(12, n))
    );
    expect(pictures.every((img) => img.getAttribute("alt"))).toBe(true);
    // The speech is in the art, so the transcript carries it for a screen reader.
    const [first] = BOOK_DIALOGUE[12].panels[0].dialogue;
    expect(panels.getByText(first.line)).toBeTruthy();
    // No srcset: every page loads the 768 px file.
    expect(pictures[0].getAttribute("srcset")).toBeNull();
    expect(pictures[0].getAttribute("loading")).toBe("eager");
    expect(pictures[1].getAttribute("loading")).toBe("lazy");
  });

  it("opens a panel full screen at its larger size", async () => {
    render(await ComicStoryPage(params(12)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 2 of 4 full screen" }));
    const dialog = screen.getByRole("dialog", { name: /panel 2 of 4/ });
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      `${STORAGE}${POSTER_ART[12].panels[1].full}`
    );
  });

  it("gives the poster intro the same four panels", async () => {
    render(await ComicStoryPage(params(12)));
    const overlay = document.querySelector('[data-intro-overlay="poster"]');
    const windows = Array.from(overlay?.querySelectorAll("img") ?? []);
    expect(windows.map((img) => img.getAttribute("src"))).toEqual(
      POSTER_ART[12].panels.map((files) => `${STORAGE}${files.small}`)
    );
  });

  it("shows the words alone where there's no Supabase address to load the art from", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    render(await ComicStoryPage(params(12)));
    expect(screen.getByRole("heading", { level: 1, name: "But You Were Closed!" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Comic panels" })).toBeNull();
    expect(screen.getByText("Ask your team:")).toBeTruthy();
    const meta = await storyMetadata(params(12));
    expect(meta.openGraph?.images).toEqual([`https://agile.amrelharony.com${BOOK_SHARE_URL}`]);
  });

  it("renders all 26 from the campaign's data file", async () => {
    for (const episode of BOOK_EPISODES) {
      const { unmount } = render(await ComicStoryPage(params(episode.ep)));
      expect(screen.getByRole("heading", { level: 1, name: episode.title })).toBeTruthy();
      expect(screen.getByText(episode.lesson)).toBeTruthy();
      expect(screen.getByText(episode.question)).toBeTruthy();
      expect(
        screen.getByRole("heading", { name: `Read the full story: book page ${episode.bookPage}` })
      ).toBeTruthy();
      expect(screen.getByText(episode.theme)).toBeTruthy();
      unmount();
    }
  });

  it("ignores any row the store has for it: the print is the source", async () => {
    h.story = { ...STORY, ep: 12, collection: "book", title: "An edited title", bookPage: 73 };
    render(await ComicStoryPage(params(12)));
    expect(screen.getByRole("heading", { level: 1, name: "But You Were Closed!" })).toBeTruthy();
    expect(screen.queryByText("An edited title")).toBeNull();
    // The poster's panels, never the row's.
    const sources = within(screen.getByRole("region", { name: "Comic panels" }))
      .getAllByRole("img")
      .map((img) => img.getAttribute("src"));
    expect(sources).toEqual(POSTER_ART[12].panels.map((files) => `${STORAGE}${files.small}`));
    expect(h.extrasCalls).toEqual([]);
  });

  it("carries the poster intro, which a poster's or kudos card's scan plays, and its replay", async () => {
    render(await ComicStoryPage(params(12)));
    const overlay = document.querySelector('[data-intro-overlay="poster"]');
    expect(overlay?.textContent).toContain("But You Were Closed!");
    expect(screen.getByRole("button", { name: "Replay intro" })).toBeTruthy();
  });

  it("then the latest weekly comics", async () => {
    render(await ComicStoryPage(params(12)));
    expect(screen.getByRole("heading", { name: "The latest comics" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Newest/ }).getAttribute("href")).toBe("/comics?ep=40");
    expect(screen.queryByText("Too old")).toBeNull();
  });

  it("steps through the book's own numbers", async () => {
    render(await ComicStoryPage(params(12)));
    expect(screen.getByRole("link", { name: "Previous story" }).getAttribute("href")).toBe(
      "/comics?ep=11"
    );
    expect(screen.getByRole("link", { name: "Next story" }).getAttribute("href")).toBe(
      "/comics?ep=13"
    );
  });

  it("stays out of search, points at the public address and previews as its poster", async () => {
    const meta = await storyMetadata(params(12));
    expect(meta.title).toBe("But You Were Closed! — Agile at Work");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("/comics?ep=12");
    expect(meta.other).toEqual({ robots: "noai, noimageai" });
    expect(meta.openGraph?.images).toEqual([`${STORAGE}${POSTER_ART[12].share}`]);
    expect(meta.twitter).toMatchObject({ images: [`${STORAGE}${POSTER_ART[12].share}`] });
  });
});

describe("the plain address", () => {
  it("lists the book's 26 episodes, colour-coded, and says the weekly stories are coming", async () => {
    render(await ComicsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Agile at Work" })).toBeTruthy();
    expect(screen.getByText("A new story comes out every week, starting soon.")).toBeTruthy();
    const index = screen.getByRole("region", { name: "The 26 episodes in the book" });
    const links = within(index)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/comics?ep="));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      BOOK_EPISODES.map((e) => `/comics?ep=${e.ep}`)
    );
    expect(links[6]).toHaveTextContent("Episode 7: Nobody Owns It");
    expect(links[6]).toHaveTextContent("Ownership");
    for (const habit of ["Focus", "Ownership", "Real needs", "Trust"]) {
      expect(within(index).getAllByText(habit).length).toBeGreaterThan(0);
    }
  });

  it("shows each book episode with its poster's first panel, loaded as it nears the screen", async () => {
    render(await ComicsPage());
    const index = screen.getByRole("region", { name: "The 26 episodes in the book" });
    const links = within(index)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/comics?ep="));
    const covers = links.map((a) => a.querySelector("img"));
    expect(covers.map((img) => img?.getAttribute("src"))).toEqual(
      BOOK_EPISODES.map((e) => `${STORAGE}${POSTER_ART[e.ep].panels[0].small}`)
    );
    // The title names the link, so the picture says nothing of its own.
    expect(covers.every((img) => img?.getAttribute("alt") === "")).toBe(true);
    expect(covers.every((img) => img?.getAttribute("loading") === "lazy")).toBe(true);
  });

  it("adds each book picture only once its card nears the screen, holding its space until then", async () => {
    const observers: { margin?: string; seen: (el: Element) => void; observed: Set<Element> }[] =
      [];
    class NearObserver {
      readonly observed = new Set<Element>();
      constructor(
        readonly callback: IntersectionObserverCallback,
        readonly options: IntersectionObserverInit = {}
      ) {
        observers.push({
          margin: options.rootMargin,
          observed: this.observed,
          seen: (el) =>
            callback(
              [
                {
                  target: el,
                  isIntersecting: true,
                  intersectionRatio: 0,
                } as unknown as IntersectionObserverEntry,
              ],
              this as never
            ),
        });
      }
      observe(el: Element) {
        this.observed.add(el);
      }
      unobserve(el: Element) {
        this.observed.delete(el);
      }
      disconnect() {
        this.observed.clear();
      }
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", NearObserver);
    try {
      render(await ComicsPage());
      const index = screen.getByRole("region", { name: "The 26 episodes in the book" });
      // Nothing downloads with the page, and each card already has the picture's square.
      expect(within(index).queryAllByRole("presentation")).toEqual([]);
      const first = within(index).getByRole("link", { name: /^Episode 1:/ });
      const slot = first.firstElementChild as HTMLElement;
      expect(slot.style.aspectRatio).toBe("1536 / 1536");
      const near = observers.find((o) => o.margin === "300px 0px");
      expect(near?.observed.size).toBe(26);
      act(() => near!.seen(slot));
      const pictures = within(index).getAllByRole("presentation");
      expect(pictures).toHaveLength(1);
      expect(pictures[0].getAttribute("src")).toBe(`${STORAGE}${POSTER_ART[1].panels[0].small}`);
      expect(near?.observed.size).toBe(25);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists the book's episodes as words alone where the art can't load", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    render(await ComicsPage());
    const index = screen.getByRole("region", { name: "The 26 episodes in the book" });
    expect(within(index).queryAllByRole("img")).toEqual([]);
    expect(within(index).getAllByRole("link", { name: /^Episode \d+:/ })).toHaveLength(26);
  });

  it("offers the open kudos cards' scanners a way to thank someone", async () => {
    render(await ComicsPage());
    expect(screen.getByRole("link", { name: /Thank someone/ })).toHaveAttribute(
      "href",
      "/kudos?src=comics"
    );
  });
});

describe("a number that isn't released", () => {
  it("says coming soon and carries no content", async () => {
    h.story = null;
    render(await ComicStoryPage(params(31)));
    expect(screen.getByText("This comic is coming soon")).toBeTruthy();
    expect(comicArt()).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(screen.queryByText("The lesson")).toBeNull();
    expect(screen.queryByText("Ask your team:")).toBeNull();
  });

  it("names no address for a number that isn't one, never the internal page", async () => {
    const meta = await storyMetadata(params("abc"));
    expect(meta.alternates).toEqual({ canonical: null });
    expect(meta.openGraph).not.toHaveProperty("url");
  });

  it("gives search engines and link previews nothing either", async () => {
    const meta = await storyMetadata(params(31));
    expect(meta.title).toBe("Coming soon — Agile at Work");
    expect(meta.robots).toEqual({ index: false, follow: true });
    // The book's share image, which says nothing about next Sunday's story.
    expect(meta.openGraph?.images).toEqual([`https://agile.amrelharony.com${BOOK_SHARE_URL}`]);
    expect(meta.alternates?.canonical).toBeUndefined();
  });
});

describe("the story reader", () => {
  beforeEach(() => {
    h.story = STORY;
    h.released = [27, 30, 33];
  });

  it("loads the 768 file at its real size, with no srcset", async () => {
    render(await ComicStoryPage(params(30)));
    const img = screen.getByAltText("Dina holds a thick folder at her desk.");
    expect(img.getAttribute("src")).toBe(
      "https://ref.supabase.co/storage/v1/object/public/comic-panels/stories/30/one-768.webp"
    );
    expect(img.getAttribute("width")).toBe("1536");
    expect(img.getAttribute("height")).toBe("1024");
    expect(img.hasAttribute("srcset")).toBe(false);
  });

  it("opens on the first panel at high priority and leaves the rest lazy", async () => {
    render(await ComicStoryPage(params(30)));
    const first = screen.getByAltText("Dina holds a thick folder at her desk.");
    expect(first.getAttribute("loading")).toBe("eager");
    expect(first.getAttribute("fetchpriority")).toBe("high");
    const second = screen.getByAltText("Amr shrugs by the printer.");
    expect(second.getAttribute("loading")).toBe("lazy");
    expect(second.hasAttribute("fetchpriority")).toBe(false);
  });

  it("keeps dialogue and descriptions in the page with the transcript closed", async () => {
    render(await ComicStoryPage(params(30)));
    const line = screen.getByText("Where did the notes go?");
    expect(line.closest("figcaption")?.className).toBe("sr-only");
    expect(screen.getByText("Dina:")).toBeTruthy();
    expect(screen.getByText("Handover")).toBeTruthy();
    expect(screen.getByText("Amr shrugs by the printer.").closest("figcaption")?.className).toBe(
      "sr-only"
    );
  });

  it("the transcript button only shows what's already there", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Show transcript" }));
    expect(screen.getByText("Where did the notes go?").closest("figcaption")?.className).not.toBe(
      "sr-only"
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));
    expect(screen.getByText("Where did the notes go?").closest("figcaption")?.className).toBe(
      "sr-only"
    );
  });

  it("offers no download", async () => {
    render(await ComicStoryPage(params(30)));
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("opens the 1536 file full screen, moves with the arrows and closes on Escape", async () => {
    render(await ComicStoryPage(params(30)));
    expect(document.body.innerHTML).not.toContain("one-1536");

    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.parentElement).toBe(document.body);
    expect(within(dialog).getByRole("img").getAttribute("src")).toContain("one-1536.webp");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(screen.getByRole("dialog")).getByRole("img").getAttribute("src")).toContain(
      "two-1536.webp"
    );
    // Arrows belong to the overlay while it's open, not to the story nav.
    expect(h.push).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("keeps focus on the overlay's buttons at the ends of the panel list", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    // The trap moves focus in on the next frame; let it, so it can't mask a drop later.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const dialog = screen.getByRole("dialog");
    const src = () => within(dialog).getByRole("img").getAttribute("src");
    const previous = within(dialog).getByRole("button", { name: "Previous panel" });
    const next = within(dialog).getByRole("button", { name: "Next panel" });

    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.hasAttribute("disabled")).toBe(false);
    fireEvent.click(previous);
    expect(src()).toContain("one-1536.webp");

    next.focus();
    fireEvent.click(next);
    expect(src()).toContain("two-1536.webp");
    // A native disabled here is what drops focus out of the dialog.
    expect(next.hasAttribute("disabled")).toBe(false);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(next);

    fireEvent.click(next);
    expect(src()).toContain("two-1536.webp");
    expect(previous.getAttribute("aria-disabled")).toBe("false");
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("makes the page behind inert while the overlay is open", async () => {
    const { container } = render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    expect(container.closest("[inert]") ?? container.hasAttribute("inert")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("zooms with the browser's own pinch", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    const scroller = within(screen.getByRole("dialog")).getByRole("img").parentElement!;
    expect(scroller.style.touchAction).toBe("pan-x pan-y pinch-zoom");
  });

  it("fills the height on an upright phone, panning from the panel's left edge", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    const img = within(screen.getByRole("dialog")).getByRole("img");
    const classes = img.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "m-auto",
        "max-sm:portrait:h-full",
        "max-sm:portrait:max-w-none",
        "max-sm:portrait:shrink-0",
      ])
    );
    // Elsewhere it still fits the screen, as before.
    expect(classes).toEqual(expect.arrayContaining(["max-h-full", "max-w-full", "object-contain"]));
    // Centring the row would cut a wider panel's left edge off; m-auto doesn't.
    expect(img.parentElement!.className).not.toMatch(/justify-center|items-center/);
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("swipes between panels, but not while the page is pinch-zoomed", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    const dialog = screen.getByRole("dialog");
    const src = () => within(dialog).getByRole("img").getAttribute("src");
    const scroller = within(dialog).getByRole("img").parentElement!;
    const swipe = (dx: number) => {
      fireEvent.touchStart(scroller, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchEnd(scroller, {
        touches: [],
        changedTouches: [{ clientX: 300 + dx, clientY: 300 }],
      });
    };

    swipe(-20);
    expect(src()).toContain("one-1536.webp");
    swipe(-120);
    expect(src()).toContain("two-1536.webp");
    swipe(-120);
    expect(src()).toContain("two-1536.webp");

    vi.stubGlobal("visualViewport", { scale: 2.5 });
    swipe(120);
    expect(src()).toContain("two-1536.webp");
    vi.stubGlobal("visualViewport", { scale: 1 });
    swipe(120);
    expect(src()).toContain("one-1536.webp");
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("pans a wide panel to its edge before a swipe moves on, and starts the next at its beginning", async () => {
    render(await ComicStoryPage(params(30)));
    fireEvent.click(screen.getByRole("button", { name: "Open panel 1 of 2 full screen" }));
    const dialog = screen.getByRole("dialog");
    const src = () => within(dialog).getByRole("img").getAttribute("src");
    const scroller = within(dialog).getByRole("img").parentElement!;
    // A height-filled panel on an upright phone: 900 px wide in a 360 px screen.
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 900 });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 360 });
    Object.defineProperty(scroller, "scrollLeft", { configurable: true, writable: true, value: 0 });
    const swipeLeft = () => {
      fireEvent.touchStart(scroller, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchEnd(scroller, {
        touches: [],
        changedTouches: [{ clientX: 100, clientY: 300 }],
      });
    };

    swipeLeft();
    expect(src()).toContain("one-1536.webp");
    scroller.scrollLeft = 540;
    swipeLeft();
    expect(src()).toContain("two-1536.webp");
    expect(scroller.scrollLeft).toBe(0);
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("moves between released stories, by link and by arrow key", async () => {
    render(await ComicStoryPage(params(30)));
    expect(screen.getByRole("link", { name: "Previous story" }).getAttribute("href")).toBe(
      "/comics?ep=27"
    );
    expect(screen.getByRole("link", { name: "Next story" }).getAttribute("href")).toBe(
      "/comics?ep=33"
    );
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(h.push).toHaveBeenCalledWith("/comics?ep=33");
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(h.push).toHaveBeenCalledWith("/comics?ep=27");
  });

  it("leaves arrow keys alone while someone types", async () => {
    render(
      <>
        <input aria-label="typing" />
        {await ComicStoryPage(params(30))}
      </>
    );
    fireEvent.keyDown(screen.getByLabelText("typing"), { key: "ArrowRight" });
    expect(h.push).not.toHaveBeenCalled();
  });

  it("shares a link with the share sheet where there is one", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { share }));
    render(await ComicStoryPage(params(30)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share a link" }));
    });
    expect(share).toHaveBeenCalledWith({
      title: STORY.title,
      url: `${window.location.origin}/comics?ep=30`,
    });
  });

  it("shows the lesson, the question and the rights notice", async () => {
    render(await ComicStoryPage(params(30)));
    expect(screen.getByText(STORY.lesson)).toBeTruthy();
    expect(screen.getByText(STORY.squadQuestion)).toBeTruthy();
    expect(screen.queryByText(/Read the full story/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Thank someone for this habit/ })).toBeNull();
    expect(screen.getByText(/private property of this website/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the licence" }).getAttribute("href")).toBe(
      "/comics/license"
    );
    // A weekly story counts its reading too, and says so.
    expect(screen.getByText(/anonymous counts: that you arrived/)).toBeTruthy();
    expect(screen.queryByText(/one anonymous count when you arrive/)).toBeNull();
  });

  it("puts a heart with the readers' count under the panels", async () => {
    h.totals = { ...h.totals, loves: 24 };
    render(await ComicStoryPage(params(30)));
    const heart = screen.getByRole("button", { name: "Love this" });
    expect(heart.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("24 readers love this")).toBeTruthy();
  });

  it("names the licence and credit in structured data, using the small files", async () => {
    render(await ComicStoryPage(params(30)));
    const script = document.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.innerHTML);
    expect(data["@type"]).toBe("ComicStory");
    expect(data.url).toBe("https://agile.amrelharony.com/comics?ep=30");
    expect(data.image).toHaveLength(2);
    expect(data.image[0]).toMatchObject({
      "@type": "ImageObject",
      license: "https://agile.amrelharony.com/comics/license",
      acquireLicensePage: "https://agile.amrelharony.com/comics/license",
      creditText: "Amr Elharony",
      copyrightNotice: "© Amr Elharony",
    });
    expect(script!.innerHTML).not.toContain("1536.webp");
  });

  it("can't be broken out of by a title", async () => {
    h.story = { ...STORY, title: "</script><script>alert(1)</script>" };
    render(await ComicStoryPage(params(30)));
    expect(document.querySelector('script[type="application/ld+json"]')!.innerHTML).not.toContain(
      "</script>"
    );
  });

  it("is indexable at its public address, and only a weekly story is", async () => {
    const meta = await storyMetadata(params(30));
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("/comics?ep=30");
    expect(meta.other).toEqual({ robots: "noai, noimageai" });
    expect(meta.openGraph?.images).toEqual([
      "https://ref.supabase.co/storage/v1/object/public/comic-panels/stories/30/share.jpg",
    ]);
  });
});

describe("a story's quiz and its own tool", () => {
  const QUIZ = [
    { question: "What should come first?", options: ["Everything", "One job"], answer: 1 },
    {
      question: "Who says what can wait?",
      options: ["Nobody", "The team", "The loudest"],
      answer: 1,
      explain: "Together.",
    },
  ];

  beforeEach(() => {
    h.story = STORY;
    h.released = [30];
  });

  it("shows no quiz until the portal gives the story one", async () => {
    render(await ComicStoryPage(params(30)));
    expect(screen.queryByRole("heading", { name: "A quick quiz" })).toBeNull();
    expect(h.extrasCalls).toEqual([30]);
  });

  it("checks the answers once every question has one, and starts again", async () => {
    h.extras = { quiz: QUIZ, tryTool: null };
    render(await ComicStoryPage(params(30)));
    const quiz = screen.getByRole("region", { name: "A quick quiz" });
    const check = within(quiz).getByRole("button", { name: "Check my answers" });
    expect(check).toBeDisabled();
    fireEvent.click(within(quiz).getByRole("radio", { name: "One job" }));
    fireEvent.click(within(quiz).getByRole("radio", { name: "Nobody" }));
    fireEvent.click(check);
    expect(within(quiz).getByRole("status")).toHaveTextContent("1 of 2 right");
    expect(within(quiz).getByText("Right.")).toBeTruthy();
    expect(within(quiz).getByText(/Not quite\. It's: The team/)).toBeTruthy();
    expect(within(quiz).getByText("Together.")).toBeTruthy();
    // The button pressed is gone: focus goes to the score, then back to the first answer.
    expect(document.activeElement).toBe(within(quiz).getByRole("status"));
    fireEvent.click(within(quiz).getByRole("button", { name: "Try again" }));
    expect(within(quiz).getByRole("radio", { name: "One job" })).not.toBeChecked();
    expect(document.activeElement).toBe(within(quiz).getByRole("radio", { name: "Everything" }));
  });

  it("links the story's own tool over its theme's", async () => {
    h.extras = { quiz: null, tryTool: "retro-actions" };
    render(await ComicStoryPage(params(30)));
    const team = screen.getByRole("region", { name: "Take it to your team" });
    expect(within(team).getByRole("link", { name: "Retro Actions" })).toHaveAttribute(
      "href",
      "/retro-actions"
    );
  });

  it("reads no extras for a book episode that has no story yet", async () => {
    h.story = null;
    render(await ComicStoryPage(params(12)));
    expect(h.extrasCalls).toEqual([]);
  });
});

describe("a story's guess, Seen this at work and Try it this week", () => {
  const GUESS = {
    question: "What does Amr do next?",
    options: ["Asks Dina where she saved them", "Prints them again", "Waits for Friday"],
    happened: 1,
    note: "Printing again fixed today, not next time.",
  };

  type Call = { url: string; init?: RequestInit };
  let calls: Call[];
  let reply: { counts: number[]; shares: number[] | null };

  beforeEach(() => {
    h.story = STORY;
    h.released = [30];
    h.guess = { guess: GUESS, tryAction: "Ask who else keeps notes only on paper." };
    calls = [];
    reply = { counts: [1, 0, 0], shares: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (String(url).startsWith("/api/comics/taps")) return Response.json(reply);
        return new Response(null, { status: 204 });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const taps = (method: string) =>
    calls.filter(
      (c) => c.url.startsWith("/api/comics/taps") && (c.init?.method ?? "GET") === method
    );

  it("hides the last panel, its description and its transcript until the reader guesses", async () => {
    render(await ComicStoryPage(params(30)));
    expect(screen.getByRole("img", { name: /Panel 2 is hidden until you guess/ })).toBeTruthy();
    expect(screen.queryByAltText("Amr shrugs by the printer.")).toBeNull();
    expect(screen.queryByText("Amr shrugs by the printer.")).toBeNull();
    expect(screen.queryByText("I thought you had them.")).toBeNull();
    // The picture still loads behind the cover, so the reveal doesn't wait.
    const covered = document.querySelectorAll("img[src*='two-768']");
    expect(covered).toHaveLength(1);
    expect(covered[0].getAttribute("loading")).toBe("lazy");
    // Only the panels already read open full screen.
    expect(screen.getAllByRole("button", { name: /Open panel \d of 2 full screen/ })).toHaveLength(
      1
    );
    const question = screen.getByRole("region", { name: GUESS.question });
    expect(within(question).getAllByRole("button")).toHaveLength(4);
  });

  it("reveals the panel on a pick, counts it once, and shows what happened", async () => {
    render(await ComicStoryPage(params(30)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Waits for Friday" }));
    });
    expect(screen.getByAltText("Amr shrugs by the printer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open panel 2 of 2 full screen" })).toBeTruthy();
    expect(taps("POST")).toHaveLength(1);
    expect(JSON.parse(String(taps("POST")[0].init?.body))).toEqual({
      ep: 30,
      kind: "guess",
      choice: 2,
    });
    const results = screen.getByRole("region", { name: GUESS.question });
    expect(within(results).getByText("What happened").closest("li")).toHaveTextContent(
      "Prints them again"
    );
    expect(within(results).getByText("Your guess").closest("li")).toHaveTextContent(
      "Waits for Friday"
    );
    expect(within(results).getByText(/You're the first to guess/)).toBeTruthy();
    expect(within(results).getByText(GUESS.note)).toBeTruthy();
    // Focus goes to the panel that just appeared, which carries its own description.
    expect(document.activeElement?.tagName).toBe("FIGURE");
    expect(document.activeElement).toHaveAccessibleName(/Amr shrugs by the printer/);
  });

  it("scrolls the revealed panel in clear of the sticky header", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      render(await ComicStoryPage(params(30)));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Waits for Friday" }));
      });
      const figure = document.activeElement as HTMLElement;
      expect(figure.tagName).toBe("FIGURE");
      expect(scrolled).toEqual([figure]);
      // The header's height plus a gap; on a phone html's scroll padding adds Amr's space.
      expect(figure.className.split(/\s+/)).toContain(
        "scroll-mt-[calc(var(--header-h,56px)+0.5rem)]"
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("shows how readers picked once there are enough of them", async () => {
    reply = { counts: [6, 30, 4], shares: [15, 75, 10] };
    render(await ComicStoryPage(params(30)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Prints them again" }));
    });
    const results = screen.getByRole("region", { name: "What readers picked" });
    expect(within(results).getByText("75%")).toBeTruthy();
    expect(within(results).getByText("15%")).toBeTruthy();
  });

  it("lets a reader skip the guess without counting anything", async () => {
    render(await ComicStoryPage(params(30)));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Just show me" }));
    });
    expect(screen.getByAltText("Amr shrugs by the printer.")).toBeTruthy();
    expect(taps("POST")).toHaveLength(0);
    expect(taps("GET")).toHaveLength(1);
    expect(screen.queryByText("Your guess")).toBeNull();
  });

  it("remembers the guess on this device: no second count, no cover", async () => {
    localStorage.setItem(
      "agile-toolkit:comics:reading",
      JSON.stringify({ read: {}, sent: {}, asked: {}, guessed: { 30: 0 }, seen: {} })
    );
    await act(async () => {
      render(await ComicStoryPage(params(30)));
    });
    expect(screen.getByAltText("Amr shrugs by the printer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Just show me" })).toBeNull();
    expect(taps("POST")).toHaveLength(0);
    expect(taps("GET")[0].url).toBe("/api/comics/taps?ep=30&kind=guess");
    expect(screen.getByText("Your guess").closest("li")).toHaveTextContent(
      "Asks Dina where she saved them"
    );
  });

  it("keeps the whole story as before when there's no guess", async () => {
    h.guess = { guess: null, tryAction: null };
    render(await ComicStoryPage(params(30)));
    expect(screen.getByAltText("Amr shrugs by the printer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Just show me" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Try it this week" })).toBeNull();
  });

  it("asks once whether the reader has seen this at work, then says how many have", async () => {
    reply = { counts: [21, 4], shares: [84, 16] };
    render(await ComicStoryPage(params(30)));
    const seen = screen.getByRole("region", { name: "Seen this at work?" });
    await act(async () => {
      fireEvent.click(within(seen).getByRole("button", { name: "Yes, I've seen this" }));
    });
    expect(within(seen).queryByRole("button")).toBeNull();
    expect(within(seen).getByRole("status")).toHaveTextContent(
      "Thanks. 84% of readers have seen this at work."
    );
    expect(document.activeElement).toBe(within(seen).getByRole("status"));
    expect(JSON.parse(String(taps("POST")[0].init?.body))).toEqual({
      ep: 30,
      kind: "seen",
      choice: 0,
    });
  });

  it("puts Try it this week above the team's tool", async () => {
    render(await ComicStoryPage(params(30)));
    const team = screen.getByRole("region", { name: "Take it to your team" });
    expect(within(team).getByRole("heading", { name: "Try it this week" })).toBeTruthy();
    expect(within(team).getByText("Ask who else keeps notes only on paper.")).toBeTruthy();
  });
});

describe("static generation", () => {
  it("prerenders every book episode, so an outage can't lose a printed link", async () => {
    h.released = [27, 28];
    const eps = (await storyParams()).map((p) => Number(p.n));
    expect(eps).toEqual([...BOOK_EPISODES.map((e) => e.ep), 27, 28]);
  });

  it("falls back to the book alone if the weekly list fails", async () => {
    h.listThrows = true;
    expect(await storyParams()).toHaveLength(26);
  });

  it("asks scrapers to leave the gallery and licence pages alone too", () => {
    expect(galleryMetadata.other).toEqual({ robots: "noai, noimageai" });
    expect(licenseMetadata.other).toEqual({ robots: "noai, noimageai" });
  });
});

describe("the gallery", () => {
  beforeEach(() => {
    // Radix Select leans on layout APIs jsdom doesn't have.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.scrollIntoView ??= () => {};
    h.summaries = [
      summary(30, "Newest story", { themes: ["T01"], castNames: ["Amr"] }),
      summary(29, "Handover story", { themes: ["T08"], castNames: ["Dina"] }),
      summary(28, "Forecast story", { themes: ["T03"], castNames: ["Amr", "Dina"] }),
    ];
  });

  it("leads with this week's story and lists the rest newest first", async () => {
    render(await ComicsPage());
    expect(screen.getByRole("heading", { level: 2, name: "Newest story" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Read this story/ }).getAttribute("href")).toBe(
      "/comics?ep=30"
    );
    const weekly = screen.getByRole("region", { name: "Weekly stories" });
    const cards = within(weekly)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(cards[0]).toContain("Handover story");
    expect(cards[1]).toContain("Forecast story");
    expect(cards).toHaveLength(2);
  });

  it("shows readers' favourites once a story has five loves", async () => {
    h.totalsMap = new Map([
      [29, { loves: 12 }],
      [28, { loves: 3 }],
    ]);
    render(await ComicsPage());
    const favourites = screen.getByRole("region", { name: "Readers' favourites" });
    const cards = within(favourites).getAllByRole("listitem");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("Handover story");
    expect(cards[0].textContent).toContain("Loved by 12 readers");
  });

  it("leaves favourites out until a story has enough loves", async () => {
    h.totalsMap = new Map([[29, { loves: 4 }]]);
    render(await ComicsPage());
    expect(screen.queryByRole("region", { name: "Readers' favourites" })).toBeNull();
  });

  it("opens on this week's cover at high priority and loads the other cards lazily, all small", async () => {
    h.totalsMap = new Map([[29, { loves: 12 }]]);
    render(await ComicsPage());
    // The book intro's cover is its own test's business (intro-book).
    const art = Array.from(document.querySelectorAll("img")).filter(
      (img) => !img.closest("[data-intro-overlay]")
    );
    const thisWeek = within(screen.getByRole("region", { name: "Newest story" })).getByRole(
      "presentation"
    );
    const bookIndex = screen.getByRole("region", { name: "The 26 episodes in the book" });
    const cards = art.filter((img) => img !== thisWeek && !bookIndex.contains(img));
    expect(thisWeek.getAttribute("loading")).toBe("eager");
    expect(thisWeek.getAttribute("fetchpriority")).toBe("high");
    expect(thisWeek.getAttribute("src")).toContain("-768.webp");
    // Readers' favourites and the weekly list.
    expect(cards.length).toBe(3);
    for (const img of cards) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.hasAttribute("fetchpriority")).toBe(false);
      expect(img.getAttribute("src")).toContain("-768.webp");
    }
    // And the book's 26 posters, small and lazy too.
    const book = art.filter((img) => bookIndex.contains(img));
    expect(book.length).toBe(26);
    for (const img of book) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.hasAttribute("fetchpriority")).toBe(false);
      expect(img.getAttribute("src")).toMatch(/\/posters\/ep-\d{2}\.p1\.[0-9a-f]{10}\.768\.webp$/);
    }
  });

  it.each([
    ["Theme", "Capability, onboarding and knowledge resilience", ["Handover story"]],
    ["Character", "Dina", ["Handover story", "Forecast story"]],
  ])("filters by %s", async (label, option, expected) => {
    render(await ComicsPage());
    const trigger = screen.getByRole("combobox", { name: label });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("option", { name: option }));
    const weekly = screen.getByRole("region", { name: "Weekly stories" });
    const cards = within(weekly)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("h3")?.textContent);
    expect(cards).toEqual(expected);
  });

  it("says when nothing matches and offers a way back", async () => {
    h.summaries = [
      summary(30, "One", { themes: ["T01"], castNames: ["Amr"] }),
      summary(29, "Two", { themes: ["T08"], castNames: ["Dina"] }),
    ];
    render(await ComicsPage());
    for (const [label, option] of [
      ["Theme", "Shared language and direct understanding"],
      ["Character", "Dina"],
    ]) {
      const trigger = screen.getByRole("combobox", { name: label });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(await screen.findByRole("option", { name: option }));
    }
    expect(screen.getByText("No stories match these filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText("No stories match these filters.")).toBeNull();
  });

  it("discloses the anonymous count", async () => {
    render(await ComicsPage());
    expect(screen.getByText(/one anonymous count when you arrive/)).toBeTruthy();
  });

  it("gives About the book a touch-sized target", async () => {
    render(await ComicsPage());
    const classes = screen.getByRole("link", { name: "About the book" }).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["inline-flex", "items-center", "pointer-coarse:min-h-11"])
    );
  });

  it("shows visitors no portal link, in a row that already holds its space", async () => {
    render(await ComicsPage());
    expect(screen.queryByRole("link", { name: "Comics portal" })).toBeNull();
    const row = screen.getByRole("link", { name: /Read this story/ }).parentElement!;
    expect(row.className.split(/\s+/)).toContain("pointer-coarse:min-h-11");
  });

  it("puts the owner's portal link beside this week's story, touch-sized, moving nothing", async () => {
    h.owner = true;
    render(await ComicsPage());
    const portal = screen.getByRole("link", { name: "Comics portal" });
    expect(portal.getAttribute("href")).toBe("/settings/comics");
    expect(portal.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["inline-flex", "items-center", "pointer-coarse:min-h-11"])
    );
    // Not a line of its own above the story, which pushed the page down as it appeared.
    const read = screen.getByRole("link", { name: /Read this story/ });
    expect(portal.parentElement).toBe(read.parentElement);
    // Nor a second line where the row is narrow: the row never wraps, and the
    // link gives way, cut short, while the story's button keeps its size.
    expect(read.parentElement!.className.split(/\s+/)).toContain("flex-nowrap");
    expect(read.className.split(/\s+/)).toContain("shrink-0");
    expect(portal.className.split(/\s+/)).toContain("min-w-0");
    expect(within(portal).getByText("Comics portal").className.split(/\s+/)).toContain("truncate");
  });
});

describe("the licence page", () => {
  it("explains the difference in plain language", () => {
    render(<ComicLicensePage />);
    expect(screen.getByText("Individuals")).toBeTruthy();
    expect(screen.getByText(/share the link/)).toBeTruthy();
    expect(screen.getByText(/Intranets, training, slides, newsletters and printed/)).toBeTruthy();
    expect(screen.getByText(/no editing or cropping/)).toBeTruthy();
    expect(screen.getByText(/covers the comic only/)).toBeTruthy();
  });

  it("says under the form what is kept and for how long, and links the privacy page", () => {
    const { container } = render(<ComicLicensePage />);
    const note = container.querySelector<HTMLElement>("[data-privacy-note]")!;
    expect(note.textContent).toBe(
      "We keep what you send so Amr can reply, until you ask us to remove it. We don't keep your IP address. More in What leaves your browser."
    );
    expect(within(note).getByRole("link", { name: "What leaves your browser" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    // Under the form, not inside it.
    const form = container.querySelector("form")!;
    expect(form.contains(note)).toBe(false);
    expect(form.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("validates inline before sending anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ComicLicensePage />);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Enter your work email.")).toBeTruthy();
    expect(screen.getByLabelText(/Work email/).getAttribute("aria-invalid")).toBe("true");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the request with the honeypot empty, and clears on success", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<ComicLicensePage />);
    const type = (label: RegExp, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type(/Your name/, "Sara");
    type(/Company/, "Acme");
    type(/Work email/, "sara@acme.example");
    type(/How would you like/, "Training slides");
    type(/Team size/, "40");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/comics/licence");
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "Sara",
      company: "Acme",
      email: "sara@acme.example",
      intendedUse: "Training slides",
      teamSize: "40",
      website: "",
    });
    expect(screen.getByRole("status").textContent).toContain("your request is in");
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe("");
  });

  it("keeps what was typed if the send fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    );
    render(<ComicLicensePage />);
    const type = (label: RegExp, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type(/Your name/, "Sara");
    type(/Company/, "Acme");
    type(/Work email/, "sara@acme.example");
    type(/How would you like/, "Training slides");
    type(/Team size/, "40");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    });
    expect(screen.getByText(/couldn't take your request/)).toBeTruthy();
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe("Sara");
  });

  it("offers another way through when the inbox is full", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "inbox_full" }, { status: 503 }))
    );
    render(<ComicLicensePage />);
    const type = (label: RegExp, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type(/Your name/, "Sara");
    type(/Company/, "Acme");
    type(/Work email/, "sara@acme.example");
    type(/How would you like/, "Training slides");
    type(/Team size/, "40");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("inbox is full");
    expect(screen.queryByText(/couldn't take your request/)).toBeNull();
    expect(screen.getByRole("link", { name: "amrelharony.com" }).getAttribute("href")).toBe(
      "https://amrelharony.com"
    );
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe("Sara");
  });
});
