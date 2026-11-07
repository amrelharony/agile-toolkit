// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import nextConfig from "../../next.config.mjs";
import { getToolByPath, tools } from "@/lib/constants/tools";
import { navPathname } from "@/lib/comics/entry";

/** /agile-at-work is gone for good; /comics is the one home of the comic. */

describe("the old reader", () => {
  it("redirects permanently to /comics", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toContainEqual({
      source: "/agile-at-work",
      destination: "/comics",
      permanent: true,
    });
    expect(redirects).toContainEqual({
      source: "/agile-at-work/:path*",
      destination: "/comics",
      permanent: true,
    });
  });

  it("has left the catalog", () => {
    expect(tools.some((t) => t.id === "agile-at-work" || t.path === "/agile-at-work")).toBe(false);
    expect(tools.find((t) => t.id === "comics")).toMatchObject({
      kind: "reading",
      category: "Library",
      path: "/comics",
    });
  });

  it("leaves no PDF cache rule, and lets the page load Supabase art", async () => {
    const headers = await nextConfig.headers!();
    expect(headers.some((rule) => rule.source.startsWith("/comics"))).toBe(false);
    const csp = headers
      .find((rule) => rule.source === "/(.*)")!
      .headers.find((header) => header.key === "Content-Security-Policy")!.value;
    const imgSrc = csp.split(";").find((part) => part.trim().startsWith("img-src"));
    expect(imgSrc).toContain("https://*.supabase.co");
  });

  it("is gone from Lighthouse, which measures the new pages instead", () => {
    const config = JSON.parse(readFileSync(path.join(process.cwd(), "lighthouserc.json"), "utf8"));
    const urls: string[] = config.ci.collect.url;
    expect(urls).toContain("http://localhost:3000/comics");
    expect(urls).toContain("http://localhost:3000/comics?ep=01&src=poster");
    expect(urls.some((url) => url.includes("agile-at-work"))).toBe(false);
  });

  it("took its PDF script with it", () => {
    expect(existsSync(path.join(process.cwd(), "scripts/comic-asset.mjs"))).toBe(false);
  });
});

describe("pages behind the rewrite", () => {
  // A rewritten page is prerendered at its internal path but hydrates at
  // /comics. Anything in the shell that keys off the path has to give the same
  // answer for both, or the first render won't match the HTML.
  it.each(["/comics", "/comics/ep/27", "/comics/poster/1", "/comics/license"])(
    "%s counts as the comics for navigation",
    (pathname) => {
      expect(navPathname(pathname)).toBe("/comics");
      expect(getToolByPath(pathname)?.id).toBe("comics");
    }
  );

  it("leaves every other path alone", () => {
    expect(navPathname("/retro")).toBe("/retro");
    expect(navPathname("/comicsx")).toBe("/comicsx");
    expect(getToolByPath("/retro")?.id).toBe("retro");
    expect(getToolByPath("/comicsx")).toBeUndefined();
  });
});
