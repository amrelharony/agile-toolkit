/**
 * The gate itself: what a VIP address sends to a device without access. It runs
 * the real pages and the real key check against a test-only hash, and looks at
 * both the rendered page and the props of the element, which is what would reach
 * the browser in the RSC payload.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";

const KEY = "testkey12345";

const h = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  storeCalls: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/vip/book-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vip/book-access")>();
  const hashes = [createHash("sha256").update("testkey12345").digest("hex")];
  return {
    ...actual,
    isVipKey: (raw: string | null | undefined) => actual.isVipKey(raw, hashes),
  };
});
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) =>
      h.cookies[name] === undefined ? undefined : { name, value: h.cookies[name] },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/comics/store", () => {
  const counted =
    <T,>(value: T) =>
    async () => {
      h.storeCalls += 1;
      return value;
    };
  return {
    listEarlyWeekly: counted([]),
    getEarlyStory: counted({ status: "none" }),
    getReleasedStory: counted(null),
    EARLY_WINDOW_DAYS: 28,
  };
});

import SquadSessionPage from "@/app/(tools)/squad-session/page";
import MeetTheCastPage from "@/app/(tools)/meet-the-cast/page";
import WhichColleaguePage from "@/app/(tools)/which-colleague/page";
import EarlyComicsPage from "@/app/(tools)/comics/early/page";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { CAST } from "@/lib/vip/cast.generated";
import { WHICH_COLLEAGUE_GAME } from "@/lib/vip/which-colleague-questions";

const HINT = { "agile-toolkit:vip-hint": "1" };

/** Everything that must never reach a locked visitor, whichever tool they asked for. */
const SECRETS = [
  ...CAST.flatMap((c) => [c.human_want, c.strength, c.overused_strength]),
  ...CAST.flatMap((c) => c.relationship_hooks.map((r) => r.collision)),
  ...BOOK_EPISODES.map((e) => e.lesson),
  ...WHICH_COLLEAGUE_GAME.questions.map((q) => q.prompt),
  WHICH_COLLEAGUE_GAME.discussion,
  // Tool text and names of cards.
  "Squad Session Kit",
  "Meet the Cast",
  "Which Colleague Are You?",
  "Dependable Beaver",
  "Read the story",
];

const PAGES: [string, () => Promise<ReactElement>][] = [
  ["squad-session", () => SquadSessionPage({ searchParams: { ep: "1" } })],
  ["meet-the-cast", () => MeetTheCastPage()],
  ["which-colleague", () => WhichColleaguePage()],
  ["comics/early", () => EarlyComicsPage({ searchParams: {} })],
  ["comics/early?ep=30", () => EarlyComicsPage({ searchParams: { ep: "30" } })],
];

beforeEach(() => {
  h.cookies = {};
  h.storeCalls = 0;
});
afterEach(cleanup);

describe.each(PAGES)("%s without access", (_name, page) => {
  async function expectLocked() {
    const el = await page();
    expect(el.type).toBe(VipLockPanel);
    // No props at all, so there's nothing for the RSC payload to carry.
    expect(el.props).toEqual({});
    const { container } = render(el);
    const html = container.innerHTML;
    for (const secret of SECRETS) expect(html).not.toContain(secret);
    expect(html).toContain("VIP access comes with the printed book");
    // Not a query, so no difference between a number that exists and one that doesn't.
    expect(h.storeCalls).toBe(0);
  }

  it("shows the lock panel to a visitor with no cookie", async () => {
    await expectLocked();
  });

  it("isn't fooled by a forged hint cookie", async () => {
    h.cookies = { ...HINT };
    await expectLocked();
  });

  it("treats an invalid key in the cookie as no key", async () => {
    h.cookies = { "agile-toolkit:vip": "a-forged-value", ...HINT };
    await expectLocked();
  });

  it("treats an empty key the same way", async () => {
    h.cookies = { "agile-toolkit:vip": "" };
    await expectLocked();
  });
});

describe("with a valid key", () => {
  beforeEach(() => {
    h.cookies = { "agile-toolkit:vip": KEY };
  });

  it("Meet the Cast hands over the cards as props", async () => {
    const el = await MeetTheCastPage();
    expect(el.type).not.toBe(VipLockPanel);
    expect((el.props as { cast: unknown[] }).cast).toHaveLength(30);
  });

  it("Squad Session Kit hands over the 26 episodes and the picked one", async () => {
    const el = await SquadSessionPage({ searchParams: { ep: "7" } });
    const props = el.props as { episodes: unknown[]; ep: number | null };
    expect(props.episodes).toHaveLength(26);
    expect(props.ep).toBe(7);
  });

  it("Squad Session Kit ignores a number that isn't a book episode", async () => {
    const el = await SquadSessionPage({ searchParams: { ep: "30" } });
    expect((el.props as { ep: number | null }).ep).toBeNull();
  });
});

describe("how the pages are built", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), "src", file), "utf8");

  it.each(["squad-session", "meet-the-cast", "which-colleague", "comics/early"])(
    "%s is dynamic and asks not to be indexed",
    (id) => {
      const src = read(`app/(tools)/${id}/page.tsx`);
      expect(src).toContain('export const dynamic = "force-dynamic"');
      expect(src).toContain("robots: { index: false, follow: false }");
      expect(src).toContain("hasVipAccess");
    }
  );

  it.each([
    ["squad-session", "squad-session-client"],
    ["meet-the-cast", "meet-the-cast-client"],
    ["which-colleague", "which-colleague-client"],
  ])("%s only reaches its client code through a loader", (id, client) => {
    const page = read(`app/(tools)/${id}/page.tsx`);
    expect(page).not.toContain(client);
    expect(page).toContain('from "./loader"');
    const loader = read(`app/(tools)/${id}/loader.tsx`);
    expect(loader).toContain('import dynamic from "next/dynamic"');
    expect(loader).toContain(`import("./${client}")`);
  });

  it("no client module imports the bible text or the key hashes", () => {
    const client = [
      "app/vip/vip-client.tsx",
      "components/vip/vip-lock-panel.tsx",
      "app/(tools)/meet-the-cast/meet-the-cast-client.tsx",
      "app/(tools)/meet-the-cast/cast-card.tsx",
      "app/(tools)/which-colleague/which-colleague-client.tsx",
      "app/(tools)/squad-session/squad-session-client.tsx",
      "lib/vip/cast.ts",
      "lib/vip/which-colleague.ts",
      "lib/vip/hint.ts",
      "lib/vip/use-vip-hint.ts",
      "lib/vip/constants.ts",
    ];
    for (const file of client) {
      expect(existsSync(path.join(process.cwd(), "src", file)), file).toBe(true);
      const src = read(file);
      for (const secret of ["cast.generated", "which-colleague-questions", "book-access"]) {
        expect(src, `${file} imports ${secret}`).not.toMatch(
          new RegExp(`from ["'][^"']*${secret}["']`)
        );
      }
    }
  });

  it("the bible modules refuse to load outside the server", () => {
    expect(read("lib/vip/cast.generated.ts")).toContain('import "server-only"');
    expect(read("lib/vip/which-colleague-questions.ts")).toContain('import "server-only"');
    expect(read("lib/vip/access.ts")).toContain('import "server-only"');
  });

  it("released comic pages and the root layout never read the cookie", () => {
    for (const file of [
      "app/layout.tsx",
      "app/(tools)/comics/page.tsx",
      "app/(tools)/comics/ep/[n]/page.tsx",
    ]) {
      const src = read(file);
      expect(src, file).not.toContain("next/headers");
      expect(src, file).not.toContain("hasVipAccess");
    }
  });
});
