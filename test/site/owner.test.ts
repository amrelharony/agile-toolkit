// @vitest-environment node
/**
 * Who runs the site and how to get in touch is kept once (lib/site/owner.ts).
 * /.well-known/security.txt is built from it, where it used to be a file in
 * /public with its own copy of the address.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET, dynamic } from "@/app/.well-known/security.txt/route";
import { CONTACT_EMAIL, SITE_OWNER, securityTxt } from "@/lib/site/owner";
import { SITE_METADATA } from "@/lib/seo/site-metadata";

const root = process.cwd();

describe("the site's owner and contact address", () => {
  it("names the owner as the site's metadata does", () => {
    expect(SITE_OWNER.name).toBe("Amr El Harony");
    expect(SITE_OWNER.url).toBe("https://amrelharony.com");
    const title = SITE_METADATA.title as { default: string };
    expect(title.default).toContain(SITE_OWNER.name);
  });

  it("is what the sidebar's Built by link reads, not a second copy", () => {
    const sidebar = readFileSync(path.join(root, "src/components/layout/sidebar.tsx"), "utf8");
    expect(sidebar).toContain("href={SITE_OWNER.url}");
    expect(sidebar).toContain("{SITE_OWNER.name}");
    expect(sidebar).not.toContain('"https://amrelharony.com"');
  });

  it("has one contact address, a plain email address", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});

describe("/.well-known/security.txt", () => {
  it("is served as plain text, built once with the site", async () => {
    expect(dynamic).toBe("force-static");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(securityTxt());
  });

  it("says what the file in /public said, with the contact address from the constant", () => {
    expect(securityTxt()).toBe(
      [
        `Contact: mailto:${CONTACT_EMAIL}`,
        "Expires: 2027-05-23T00:00:00.000Z",
        "Preferred-Languages: en",
        "Canonical: https://agile.amrelharony.com/.well-known/security.txt",
        "",
      ].join("\n")
    );
  });

  it("carries a real end date, and names this site as its home", () => {
    const text = securityTxt();
    const expires = /^Expires: (.+)$/m.exec(text)?.[1];
    expect(Number.isNaN(Date.parse(expires ?? ""))).toBe(false);
    expect(String(SITE_METADATA.metadataBase)).toBe("https://agile.amrelharony.com/");
    expect(text).toContain(`Canonical: ${SITE_METADATA.metadataBase}.well-known/security.txt`);
  });

  it("is not also a file in /public, which would clash with the route", () => {
    expect(existsSync(path.join(root, "public/.well-known/security.txt"))).toBe(false);
  });
});

/** Every source file under `dir`, the folders whose names start with a dot included. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(?:tsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the contact address in the source", () => {
  it("is written once, in lib/site/owner.ts, and read from there by everything else", () => {
    const holders = [...sourceFiles(path.join(root, "src")), path.join(root, "next.config.mjs")]
      .filter((file) => readFileSync(file, "utf8").includes(CONTACT_EMAIL))
      .map((file) => path.relative(root, file).replace(/\\/g, "/"));
    expect(holders).toEqual(["src/lib/site/owner.ts"]);
  });
});
