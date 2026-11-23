// @vitest-environment node
/**
 * View transitions have one door each. Only lib/motion/view-transition.ts
 * starts one, so the wait cap, the clean-up and the plain-swap rules hold for
 * every caller. Only the VIEW TRANSITIONS block in globals.css names a layer,
 * so the held layers and their order live in one place, and no stray name can
 * collide with them (two elements with one name make the browser skip the
 * whole transition). Comments count too: a mention elsewhere is how a second
 * door starts.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** The only files that may call the browser's start function. */
const START_ALLOWED = ["src/lib/motion/view-transition.ts"];

/**
 * The only files that may name a view-transition layer. globals.css only
 * inside its VIEW TRANSITIONS block (checked below). The reader's
 * reader-motion.css joins this list in its own PR.
 */
const NAME_ALLOWED = ["src/app/globals.css"];

const SCANNED = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return SCANNED.test(entry.name) ? [full] : [];
  });
}

const sources = files(SRC).map((full) => ({
  file: path.relative(ROOT, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

function filesMentioning(pattern: RegExp): string[] {
  return sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
}

/** The VIEW TRANSITIONS block: from its banner to the next banner. */
function viewTransitionsBlock(css: string): { start: number; end: number } {
  const banner = /^ {3}VIEW TRANSITIONS\b/m.exec(css);
  expect(banner, "globals.css has a VIEW TRANSITIONS banner").not.toBeNull();
  const start = banner!.index;
  const next = css.indexOf("/* ═══", css.indexOf("═══ */", start));
  expect(next).toBeGreaterThan(start);
  return { start, end: next };
}

describe("view-transition guards", () => {
  it("scans the source tree", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((s) => s.file)).toContain("src/lib/motion/view-transition.ts");
  });

  it("starts a view transition only in lib/motion/view-transition.ts", () => {
    expect(filesMentioning(/startViewTransition/)).toEqual(START_ALLOWED);
  });

  it("names a view-transition layer only in the allowed files", () => {
    const naming = filesMentioning(/view-transition-name|viewTransitionName/);
    for (const file of naming) expect(NAME_ALLOWED, `${file} names a layer`).toContain(file);
  });

  it("names layers in globals.css only inside the VIEW TRANSITIONS block", () => {
    const css = sources.find((s) => s.file === "src/app/globals.css")!.text;
    const { start, end } = viewTransitionsBlock(css);
    const at = Array.from(css.matchAll(/view-transition-name/g)).map((m) => m.index!);
    expect(at.length).toBeGreaterThan(0);
    for (const i of at) {
      expect(i, `view-transition-name at offset ${i}`).toBeGreaterThan(start);
      expect(i, `view-transition-name at offset ${i}`).toBeLessThan(end);
    }
  });
});
