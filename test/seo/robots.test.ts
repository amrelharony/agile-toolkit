// @vitest-environment node
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

/**
 * /robots.txt: the public tools are crawlable; the owner-only API and
 * settings, the auth flow, the squad-guest tree and the not-authorized
 * page are not. The sitemap entry points at the canonical domain.
 */

function rule() {
  const { rules } = robots();
  if (Array.isArray(rules)) throw new Error("expected a single rule block");
  return rules;
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

  it("does not block any tool route", () => {
    const disallow = [rule().disallow ?? []].flat();
    for (const path of ["/", "/planning-poker", "/retro", "/agile-at-work", "/history"]) {
      expect(disallow.some((prefix) => path.startsWith(prefix))).toBe(false);
    }
  });

  it("points at the sitemap on the canonical domain", () => {
    expect(robots().sitemap).toBe("https://agile.amrelharony.com/sitemap.xml");
  });
});
