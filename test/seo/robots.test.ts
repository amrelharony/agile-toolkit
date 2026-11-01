// @vitest-environment node
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

/**
 * /robots.txt: the public tools are crawlable; the owner-only API and
 * settings, the auth flow, the squad-guest tree and the not-authorized
 * page are not. Known AI crawlers are also told to stay out of the comics.
 * The sitemap entries point at the canonical domain.
 */

function groups() {
  const { rules } = robots();
  if (!Array.isArray(rules)) throw new Error("expected one rule block per audience");
  return rules;
}

function rule() {
  const group = groups().find((g) => g.userAgent === "*");
  if (!group) throw new Error("expected a rule block for every crawler");
  return group;
}

const AI_CRAWLERS = [
  "GPTBot",
  "CCBot",
  "Google-Extended",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Bytespider",
];

function aiRule() {
  const group = groups().find((g) => g.userAgent !== "*");
  if (!group) throw new Error("expected a rule block for AI crawlers");
  return group;
}

describe("robots", () => {
  it("lets every crawler index the site root", () => {
    expect(rule().userAgent).toBe("*");
    expect(rule().allow).toBe("/");
  });

  it("keeps owner-only, auth and guest routes out of the index", () => {
    const disallow = rule().disallow;
    expect(disallow).toEqual(
      expect.arrayContaining(["/api/", "/auth/", "/settings/", "/guest/", "/not-authorized"])
    );
  });

  it("keeps visitor live-room join links out of the index", () => {
    expect(rule().disallow).toEqual(expect.arrayContaining(["/join/"]));
  });

  it("does not block any tool route", () => {
    const disallow = [rule().disallow ?? []].flat();
    for (const path of ["/", "/planning-poker", "/retro", "/comics", "/history"]) {
      expect(disallow.some((prefix) => path.startsWith(prefix))).toBe(false);
    }
  });

  it("tells the known AI crawlers to stay out of the comics", () => {
    expect(aiRule().userAgent).toEqual(AI_CRAWLERS);
    expect(aiRule().disallow).toEqual(expect.arrayContaining(["/comics"]));
    expect(rule().disallow).not.toContain("/comics");
  });

  it("keeps the private paths closed to AI crawlers too", () => {
    // A crawler obeys only the group that names it, not the "*" group as well.
    expect(aiRule().disallow).toEqual(expect.arrayContaining([rule().disallow].flat()));
  });

  it("points at both sitemaps on the canonical domain", () => {
    expect(robots().sitemap).toEqual([
      "https://agile.amrelharony.com/sitemap.xml",
      "https://agile.amrelharony.com/comics/sitemap.xml",
    ]);
  });
});
