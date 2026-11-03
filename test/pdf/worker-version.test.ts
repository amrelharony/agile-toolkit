// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * pdf.js refuses to run when the API and worker versions differ ("The API
 * version … does not match the Worker version …"), and the workers in
 * public/ are committed copies that nothing refreshes automatically. These
 * checks turn a pdfjs-dist bump without `npm run pdf:worker` into a red test
 * instead of a broken Canvas PDF import in production.
 */

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel));
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const installed = (
  JSON.parse(read("node_modules/pdfjs-dist/package.json").toString("utf8")) as { version: string }
).version;

/** The build stamps `pdfjsVersion = x.y.z` into the licence header. */
function embeddedVersion(rel: string): string | null {
  const head = read(rel).subarray(0, 2048).toString("utf8");
  return /pdfjsVersion = (\d+\.\d+\.\d+)/.exec(head)?.[1] ?? null;
}

describe("self-hosted pdf.js workers", () => {
  it("reads a concrete installed pdfjs-dist version", () => {
    expect(installed).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("public/pdf.worker.legacy.min.mjs matches the installed pdfjs-dist (run `npm run pdf:worker`)", () => {
    expect(embeddedVersion("public/pdf.worker.legacy.min.mjs")).toBe(installed);
  });

  it("public/pdf.worker.legacy.min.mjs is a byte copy, not reformatted by a commit hook", () => {
    // lint-staged runs prettier over *.mjs — a reformatted worker keeps its
    // version header but is no longer the file pdf.js shipped.
    expect(sha256(read("public/pdf.worker.legacy.min.mjs"))).toBe(
      sha256(read("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"))
    );
  });

  it("public/pdf.worker.min.mjs (modern build, kept for one release) matches the installed pdfjs-dist", () => {
    // Nothing loads it any more; if this fails after an upgrade, delete the
    // file rather than refreshing it.
    expect(embeddedVersion("public/pdf.worker.min.mjs")).toBe(installed);
  });
});
