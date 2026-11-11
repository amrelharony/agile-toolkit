// @vitest-environment node
/**
 * Where the cast's code may go. Rig data reaches a browser only as props from
 * a server page: no "use client" file imports the rigs, and there is no
 * client-side index of them. Life reads the DOM and imports no manifest. The
 * two client pieces stay small.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(t|j)sx?$/.test(name) ? [full] : [];
  });
}

const RIG_DATA = /["'](?:@\/lib\/cast|\.{1,2}(?:\/[\w.-]+)*)\/rigs(?:\.generated)?["']/;
/** Leading line and block comments (a block never runs past its own end), then the directive. */
const isClient = (src: string) =>
  /^\s*(?:\/\/[^\n]*\n\s*|\/\*(?:[^*]|\*(?!\/))*\*\/\s*)*["']use client["']/.test(src);

/** Walking and reading all of src/ is slow on a busy machine. */
const SLOW = 60_000;

describe("the rig data", () => {
  it(
    "is imported by no client file",
    () => {
      const offenders: string[] = [];
      let clients = 0;
      for (const file of walk(path.join(ROOT, "src"))) {
        const src = readFileSync(file, "utf8");
        if (!isClient(src)) continue;
        clients += 1;
        if (RIG_DATA.test(src)) offenders.push(path.relative(ROOT, file));
      }
      expect(offenders).toEqual([]);
      // The walk did find the client files (a broken walk would pass vacuously).
      expect(clients).toBeGreaterThan(50);
    },
    SLOW
  );

  it("would be caught if a client file imported it", () => {
    for (const spec of [
      "@/lib/cast/rigs",
      "@/lib/cast/rigs.generated",
      "./rigs",
      "../../lib/cast/rigs.generated",
    ]) {
      expect(RIG_DATA.test(`"use client";\nimport { RIGS } from "${spec}";`), spec).toBe(true);
    }
    expect(RIG_DATA.test(`import type { RigManifest } from "@/lib/cast/rig-types";`)).toBe(false);
    expect(isClient(`/** doc */\n"use client";`)).toBe(true);
  });

  it("is read by life only from the DOM", () => {
    const life = read("src/lib/cast/life.ts");
    expect(life).not.toMatch(RIG_DATA);
    expect(life).not.toMatch(/rig-types/);
    expect(read("src/components/cast/cast-life.tsx")).not.toMatch(RIG_DATA);
  });

  it("keeps the figure server-safe and life out of it", () => {
    const figure = read("src/components/cast/cast-figure.tsx");
    expect(isClient(figure)).toBe(false);
    expect(figure).not.toMatch(/lib\/cast\/life|cast-life/);
    expect(isClient(read("src/components/cast/cast-life.tsx"))).toBe(true);
    expect(isClient(read("src/lib/cast/life.ts"))).toBe(false);
  });
});

describe("the client pieces", () => {
  it("load life lazily: cast-life imports it only with import()", () => {
    const marker = read("src/components/cast/cast-life.tsx");
    expect(marker).toMatch(/import\("@\/lib\/cast\/life"\)/);
    expect(marker).not.toMatch(/^import [^;]*["']@\/lib\/cast\/life["']/m);
  });

  it(
    "stay small: the marker under 1 KB and life with its clips under 6 KB, minified and gzipped",
    async () => {
      // Their own code, as a production build ships it; the helpers they import
      // (springs, quiet state, Save-Data) are shared with the rest of the site.
      const require = createRequire(path.join(ROOT, "package.json"));
      const ts = require("typescript") as typeof import("typescript");
      const { minify } = require("next/dist/compiled/terser") as {
        minify: (code: string, options: object) => Promise<{ code?: string }>;
      };
      const shipped = async (rel: string) => {
        const js = ts.transpileModule(read(rel), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText;
        const out = await minify(js, { module: true, compress: true, mangle: true });
        return gzipSync(out.code ?? js).length;
      };
      expect(await shipped("src/components/cast/cast-life.tsx")).toBeLessThan(1024);
      const life =
        (await shipped("src/lib/cast/life.ts")) + (await shipped("src/lib/cast/clips.ts"));
      expect(life).toBeLessThan(6 * 1024);
    },
    SLOW
  );
});
