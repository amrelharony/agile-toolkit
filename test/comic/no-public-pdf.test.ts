// @vitest-environment node
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The comic is private: its PDF lives in the private Supabase bucket and is
 * reached only through /comic/<token>. Everything under public/ is served to
 * anyone, so a PDF there (e.g. the old public/comics/agile-at-work.pdf, put
 * back by habit, `git add -f` or a GitHub web upload — none of which honour
 * .gitignore) would bypass the private link. Fail CI instead of deploying it.
 */

const PUBLIC_DIR = path.resolve(__dirname, "../../public");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("public/", () => {
  it("has no comics folder", () => {
    expect(existsSync(path.join(PUBLIC_DIR, "comics"))).toBe(false);
  });

  it("serves no PDF files", () => {
    const pdfs = walk(PUBLIC_DIR)
      .filter((file) => /\.pdf$/i.test(file))
      .map((file) => path.relative(PUBLIC_DIR, file));
    expect(pdfs).toEqual([]);
  });

  it("still holds the pdf.js workers (they are .mjs, not PDFs)", () => {
    // Guards the walk itself: a wrong PUBLIC_DIR would make the check above vacuous.
    const files = walk(PUBLIC_DIR).map((file) => path.relative(PUBLIC_DIR, file));
    expect(files).toContain("pdf.worker.legacy.min.mjs");
  });
});
