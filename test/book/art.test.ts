// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BOOK_SHARE_URL,
  COVER_INTRO_SIZE,
  COVER_INTRO_URL,
  COVER_SIZE,
  COVER_SMALL_SIZE,
  COVER_SMALL_URL,
  COVER_URL,
  SHARE_SIZE,
  SITE_SHARE_URL,
} from "@/lib/book/art";

const read = (url: string) => readFileSync(path.join(process.cwd(), "public", url));

/** A lossy WebP's frame size, from its VP8 header. */
function webpSize(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 16).toString("ascii")).toBe("WEBPVP8 ");
  return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
}

/** A JPEG's size, from its first start-of-frame marker. */
function jpegSize(bytes: Buffer) {
  expect(bytes.readUInt16BE(0)).toBe(0xffd8);
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes.readUInt16BE(at);
    if (marker >= 0xffc0 && marker <= 0xffc2) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  throw new Error("no frame header");
}

const FILES = [COVER_URL, COVER_INTRO_URL, COVER_SMALL_URL, BOOK_SHARE_URL, SITE_SHARE_URL];

describe("the book's art", () => {
  it.each(FILES)("%s is named after its content, so immutable caching is safe", (url) => {
    const prefix = createHash("sha256").update(read(url)).digest("hex").slice(0, 8);
    expect(url).toMatch(new RegExp(`^/media/[a-z0-9-]+\\.${prefix}\\.(?:webp|jpg)$`));
  });

  it("has the square cover at each size", () => {
    expect(webpSize(read(COVER_URL))).toEqual({ width: COVER_SIZE, height: COVER_SIZE });
    expect(webpSize(read(COVER_INTRO_URL))).toEqual({
      width: COVER_INTRO_SIZE,
      height: COVER_INTRO_SIZE,
    });
    expect(webpSize(read(COVER_SMALL_URL))).toEqual({
      width: COVER_SMALL_SIZE,
      height: COVER_SMALL_SIZE,
    });
  });

  it("has share images of the size link previews ask for", () => {
    expect(jpegSize(read(BOOK_SHARE_URL))).toEqual(SHARE_SIZE);
    expect(jpegSize(read(SITE_SHARE_URL))).toEqual(SHARE_SIZE);
  });

  it("stays small enough for a phone on a slow connection", () => {
    expect(read(COVER_SMALL_URL).length).toBeLessThan(120 * 1024);
    expect(read(COVER_INTRO_URL).length).toBeLessThan(160 * 1024);
    for (const url of FILES) expect(read(url).length).toBeLessThan(300 * 1024);
  });

  it("is everything in public/media: no back cover, proof or story art", () => {
    const dir = path.join(process.cwd(), "public", "media");
    expect(readdirSync(dir).sort()).toEqual(FILES.map((url) => path.basename(url)).sort());
  });
});
