#!/usr/bin/env node
/**
 * Build-time facts about the "Agile at Work" comic PDF.
 *
 * next.config.mjs calls `readComicAsset()` once per `next dev` / `next build`
 * and exposes the result as NEXT_PUBLIC_COMIC_PDF_SIZE and
 * NEXT_PUBLIC_COMIC_PDF_VERSION, which `comicAsset()` in
 * src/lib/comic/agile-at-work.ts reads back. Deciding at build time (instead of
 * an `fs.existsSync` at request time) matters on Vercel: public/ is served by
 * the CDN and is not traced into server functions, so a runtime check there
 * would always report "missing".
 *
 * `version` is the first 12 hex chars of the file's SHA-256. The reader
 * requests `/comics/agile-at-work.pdf?v=<version>`, so a replaced PDF never
 * mixes with cached byte ranges of the old one. Both values are "" when the
 * file is absent, empty, or not a PDF (e.g. a Git LFS pointer that was never
 * smudged) — the reader then shows "coming soon" and the home banner and
 * sitemap entry stay hidden.
 *
 * Adding or replacing the PDF needs a `next dev` restart locally; on Vercel the
 * push that adds it triggers a rebuild.
 *
 *   node scripts/comic-asset.mjs        # print { size, version }
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const COMIC_PDF_FILE = fileURLToPath(
  new URL("../public/comics/agile-at-work.pdf", import.meta.url)
);

const ABSENT = Object.freeze({ size: "", version: "" });

/** The PDF spec allows the `%PDF-` header anywhere in the first 1024 bytes. */
const HEADER_WINDOW = 1024;

/**
 * @param {string} [file] Absolute path; defaults to public/comics/agile-at-work.pdf.
 * @returns {Promise<{ size: string; version: string }>} Strings, because
 *   next.config `env` values must be strings.
 */
export async function readComicAsset(file = COMIC_PDF_FILE) {
  let info;
  try {
    info = await stat(file);
  } catch {
    return { ...ABSENT };
  }
  if (!info.isFile() || info.size === 0) return { ...ABSENT };

  // Stream the hash so a 50 MB comic doesn't sit in memory during the build.
  const hash = createHash("sha256");
  let head = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    if (head.length < HEADER_WINDOW) {
      head = Buffer.concat([head, chunk.subarray(0, HEADER_WINDOW - head.length)]);
    }
    hash.update(chunk);
  }
  if (!head.includes("%PDF-")) {
    console.warn(
      `[comic-asset] ${file} is not a PDF (no %PDF- header) — treating the comic as unavailable.`
    );
    return { ...ABSENT };
  }
  return { size: String(info.size), version: hash.digest("hex").slice(0, 12) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(await readComicAsset());
}
