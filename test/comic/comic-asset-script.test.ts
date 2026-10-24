// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  COMIC_COLOR_PDF_FILE,
  COMIC_PDF_FILE,
  readComicAsset,
} from "../../scripts/comic-asset.mjs";

/**
 * scripts/comic-asset.mjs runs inside next.config.mjs at build time and
 * decides whether the comic exists at all — exercise it against real files.
 */

const dir = mkdtempSync(path.join(tmpdir(), "comic-asset-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, contents: string | Buffer): string {
  const p = path.join(dir, name);
  writeFileSync(p, contents);
  return p;
}

describe("comic files", () => {
  it("keeps the colour edition out of public/, where the CDN would serve it", () => {
    const repo = path.resolve(path.dirname(COMIC_PDF_FILE), "..", "..");
    expect(path.relative(repo, COMIC_PDF_FILE)).toBe(
      path.join("public", "comics", "agile-at-work.pdf")
    );
    expect(path.relative(repo, COMIC_COLOR_PDF_FILE)).toBe(
      path.join("private", "comics", "agile-at-work-color.pdf")
    );
  });
});

describe("readComicAsset", () => {
  it("reports size and a short content hash for a PDF", async () => {
    const body = "%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n";
    const result = await readComicAsset(file("comic.pdf", body));
    expect(result).toEqual({
      size: String(Buffer.byteLength(body)),
      version: createHash("sha256").update(body).digest("hex").slice(0, 12),
    });
  });

  it("changes the version when the file's bytes change", async () => {
    const a = await readComicAsset(file("a.pdf", "%PDF-1.7\nfirst\n"));
    const b = await readComicAsset(file("b.pdf", "%PDF-1.7\nsecond\n"));
    expect(a.version).not.toBe(b.version);
  });

  it("returns empty strings when the file is missing or empty", async () => {
    expect(await readComicAsset(path.join(dir, "nope.pdf"))).toEqual({ size: "", version: "" });
    expect(await readComicAsset(file("empty.pdf", ""))).toEqual({ size: "", version: "" });
  });

  it("rejects a non-PDF such as an unsmudged Git LFS pointer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 42\n";
    expect(await readComicAsset(file("lfs.pdf", pointer))).toEqual({ size: "", version: "" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
