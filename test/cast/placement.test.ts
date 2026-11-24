// @vitest-environment node
/**
 * Where the cast's code may go. Rig data reaches a browser only as props from
 * a server page: no "use client" file imports the rigs, and there is no
 * client-side index of them. Life reads the DOM and imports no manifest. The
 * two client pieces stay small, counted with every helper only they import.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const posix = (rel: string) => rel.split(path.sep).join("/");

const STATIC =
  /^(?:import|export) (?!type\s)[^;]*?\sfrom ["']([^"']+)["']|^import ["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** A module specifier as a repo path under src/, or null for a package. */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join("src", spec.slice(2))
    : spec.startsWith(".")
      ? path.join(path.dirname(from), spec)
      : null;
  if (!base) return null;
  const file = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"]
    .map((x) => base + x)
    .find((f) => existsSync(path.join(ROOT, f)));
  return file ? posix(file) : null;
}

interface Graph {
  /** Each file's value imports (never `import type`), by repo path. */
  imports: Map<string, string[]>;
  /** The files a build ships: everything reached from the app routes, import() included. */
  live: Set<string>;
}

let built: Graph | null = null;

/** `from` and everything reached from it through `next`. */
function reach(from: string[], next: (file: string) => string[]): Set<string> {
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) {
    for (const dep of next(queue.pop()!)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

function graph(): Graph {
  if (built) return built;
  const imports = new Map<string, string[]>();
  const later = new Map<string, string[]>();
  for (const abs of walk(path.join(ROOT, "src"))) {
    const file = posix(path.relative(ROOT, abs));
    const src = readFileSync(abs, "utf8");
    const specs = (re: RegExp) =>
      Array.from(src.matchAll(re), (m) => resolve(file, m[1] ?? m[2])).filter(
        (f): f is string => f !== null
      );
    imports.set(file, specs(STATIC));
    later.set(file, specs(DYNAMIC));
  }
  const entries = Array.from(imports.keys()).filter((f) =>
    /^src\/(app\/|middleware\.|instrumentation)/.test(f)
  );
  const live = reach(entries, (file) => [...(imports.get(file) ?? []), ...(later.get(file) ?? [])]);
  return (built = { imports, live });
}

/**
 * What a production build ships with `entry`: the entry and every file it
 * imports, less any file a shipped file outside that set also imports (that
 * one goes to a chunk the rest of the site shares, and takes along whatever
 * only it imports).
 */
function chunkOf(entry: string): string[] {
  const { imports, live } = graph();
  const chunk = reach([entry], (file) => imports.get(file) ?? []);
  const shared = (file: string) =>
    Array.from(imports).some(
      ([from, deps]) => live.has(from) && !chunk.has(from) && deps.includes(file)
    );
  for (let changed = true; changed; ) {
    changed = false;
    for (const file of Array.from(chunk)) {
      if (file !== entry && shared(file)) {
        chunk.delete(file);
        changed = true;
      }
    }
  }
  return Array.from(chunk);
}

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
    "count every helper only life imports in its chunk",
    () => {
      expect(graph().live.size).toBeGreaterThan(100);
      // Today nothing the site ships imports the springs, the stage, the
      // tokens or the quiet check but life, so they ship in its chunk.
      const life = chunkOf("src/lib/cast/life.ts");
      expect(life).toEqual(
        expect.arrayContaining([
          "src/lib/cast/life.ts",
          "src/lib/cast/clips.ts",
          "src/lib/notify/quiet-now.ts",
        ])
      );
      // The quiet state and the dialog check ship with the notification layer.
      expect(life).not.toContain("src/lib/notify/quiet-state.ts");
      expect(life).not.toContain("src/lib/notify/dialog-open.ts");
      // Save-Data's check is shared with the intros and the holidays.
      expect(chunkOf("src/components/cast/cast-life.tsx")).not.toContain(
        "src/lib/holiday/save-data.ts"
      );
    },
    SLOW
  );

  it(
    "stay small: the marker under 1 KB and life's chunk under 6 KB, minified and gzipped",
    async () => {
      // As a production build ships them: each chunk's files minified, then
      // gzipped together. Helpers the rest of the site imports aren't counted.
      const require = createRequire(path.join(ROOT, "package.json"));
      const ts = require("typescript") as typeof import("typescript");
      const { minify } = require("next/dist/compiled/terser") as {
        minify: (code: string, options: object) => Promise<{ code?: string }>;
      };
      const minified = async (rel: string) => {
        const js = ts.transpileModule(read(rel), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
        }).outputText;
        const out = await minify(js, { module: true, compress: true, mangle: true });
        return out.code ?? js;
      };
      const shipped = async (entry: string) => {
        const code = await Promise.all(chunkOf(entry).map(minified));
        return gzipSync(code.join("\n")).length;
      };
      expect(await shipped("src/components/cast/cast-life.tsx")).toBeLessThan(1024);
      expect(await shipped("src/lib/cast/life.ts")).toBeLessThan(6 * 1024);
    },
    SLOW
  );
});
