import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { StoryExtras } from "@/lib/comics/extras";
import type { Story, StorySummary } from "@/lib/comics/types";

const h = vi.hoisted(() => ({
  story: null as Story | null,
  summaries: [] as StorySummary[],
  released: [] as number[],
  listThrows: false,
  push: vi.fn(),
  extras: { quiz: null, tryTool: null } as StoryExtras,
  extrasCalls: [] as number[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/comics/store", () => ({
  getReleasedStory: async () => h.story,
  getStoryExtras: async (ep: number) => {
    h.extrasCalls.push(ep);
    return h.extras;
  },
  listReleasedWeekly: async (limit?: number) => (limit ? h.summaries.slice(0, limit) : h.summaries),
  listReleasedEps: async () => {
    if (h.listThrows) throw new Error("down");
    return h.released;
  },
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
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";

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
    // Never put online: the comic is in the book, so no panels and no promise that it's coming.
    expect(screen.queryByRole("button", { name: /full screen/ })).toBeNull();
    expect(screen.queryByText("The comic will appear here soon")).toBeNull();
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
    // The scan that brought someone here is counted, and the page says so.
    expect(screen.getByText(/one anonymous count when you arrive/)).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: /full screen/ })).toBeNull();
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

  it("stays out of search and points at the public address", async () => {
    const meta = await storyMetadata(params(12));
    expect(meta.title).toBe("But You Were Closed! — Agile at Work");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("/comics?ep=12");
    expect(meta.other).toEqual({ robots: "noai, noimageai" });
    expect(meta.openGraph?.images).toEqual([`https://agile.amrelharony.com${BOOK_SHARE_URL}`]);
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

  it("loads the 768 file lazily at its real size, with no srcset", async () => {
    render(await ComicStoryPage(params(30)));
    const img = screen.getByAltText("Dina holds a thick folder at her desk.");
    expect(img.getAttribute("src")).toBe(
      "https://ref.supabase.co/storage/v1/object/public/comic-panels/stories/30/one-768.webp"
    );
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("1536");
    expect(img.getAttribute("height")).toBe("1024");
    expect(img.hasAttribute("srcset")).toBe(false);
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
    expect(screen.getByText(/one anonymous count when you arrive/)).toBeTruthy();
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

  it("loads card images lazily and small", async () => {
    render(await ComicsPage());
    // The book intro's cover is its own test's business (intro-book).
    const cards = Array.from(document.querySelectorAll("img")).filter(
      (img) => !img.closest("[data-intro-overlay]")
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const img of cards) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("src")).toContain("-768.webp");
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
