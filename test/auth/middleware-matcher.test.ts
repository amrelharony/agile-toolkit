// @vitest-environment node
/**
 * Which paths the middleware runs on at all.
 *
 * `config.matcher` is compiled by Next, not used as written: the source is
 * wrapped with an optional `/_next/data/<build>` prefix and an optional
 * `.json` suffix, then turned into a regex by path-to-regexp. This compiles
 * it the same way — by hand, and with Next's own parser as a cross-check —
 * and pins the exempt / checked lists.
 *
 * Both case modes are tested: the matcher regex is applied case-sensitively
 * under `next start` but has been compiled with the `i` flag elsewhere, and
 * the answer must be right either way.
 */

import { describe, expect, it } from "vitest";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { config } from "@/middleware";

const [source] = config.matcher;

/** The wrap Next applies in getMiddlewareMatchers (no i18n, no basePath). */
const byHand = `^(?:/(_next/data/[^/]{1,}))?${source}(\\.json)?[\\/#\\?]?$`;
const byNext = tryToParsePath(`/:nextData(_next/data/[^/]{1,})?${source}(.json)?`).regexStr;

const MODES = [
  ["by hand, case-sensitive", new RegExp(byHand)],
  ["by hand, case-insensitive", new RegExp(byHand, "i")],
  ["Next's parser, case-sensitive", new RegExp(byNext!)],
  ["Next's parser, case-insensitive", new RegExp(byNext!, "i")],
] as const;

/** Served straight from /public (or by Next) without running middleware. */
const EXEMPT = [
  "/comics/feed.xml",
  "/comics/sitemap.xml",
  "/.well-known/security.txt",
  "/mascot/amr.7d281181.webp",
  "/media/cover-1080.5f45323b.webp",
  "/media/share-site.2525b046.jpg",
  "/AT.svg",
  "/pdf.worker.legacy.min.mjs",
  "/pdf.worker.min.mjs",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/_next/static/chunks/main.js",
  "/_next/image",
];

/** Must reach the middleware: pages, owner pages, every API route. */
const CHECKED = [
  "/",
  "/comics",
  "/comics/",
  "/comics/ep/27",
  "/comics/poster/1",
  "/comics/license",
  "/comics/agile-at-work.pdf",
  "/comics/other.xml",
  "/comics/sub/feed.xml",
  "/comics/sub/x.pdf",
  "/x/comics/a.pdf",
  "/api/comics/x.pdf",
  "/api/comics/hit",
  "/api/comics/licence",
  "/api/foo.json",
  "/api/kudos",
  "/api/auth/owner",
  "/agile-at-work",
  "/settings/access-tokens",
  "/settings/squads",
  "/settings/comics",
  "/settings/comics/import",
  "/api/comics/stories",
  "/api/comics/upload-url",
  "/auth/callback",
  "/mascot/mascot.png",
  "/mascot/mascot.glb",
  "/mascot/sub/m.webp",
  "/book",
  "/media",
  "/media/",
  "/media/cover.png",
  "/media/sub/cover.webp",
  "/x/media/cover.webp",
];

describe("middleware matcher", () => {
  it("the hand-written wrap agrees with Next's own compilation", () => {
    expect(byNext).toBeTruthy();
    for (const path of [...EXEMPT, ...CHECKED]) {
      expect(new RegExp(byHand).test(path), path).toBe(new RegExp(byNext!).test(path));
    }
  });

  for (const [mode, re] of MODES) {
    describe(mode, () => {
      it.each(EXEMPT)("skips %s", (path) => {
        expect(re.test(path)).toBe(false);
      });

      it.each(CHECKED)("runs on %s", (path) => {
        expect(re.test(path)).toBe(true);
      });
    });
  }
});
