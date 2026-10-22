// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Nothing every visitor downloads may advertise the private comic. The
 * shared chrome (header, mascot, toasts, sign-in links) used to recognise
 * the reader by its /comic/ path, which put the comic's title, route and
 * storage keys in the root layout chunk. Now the reader announces itself
 * through lib/stores/reader-page-store, and this walks the import graph of
 * the root layout and the 404 page — static and lazy imports alike, type
 * imports aside — to keep the comic's modules, and its strings, out of it.
 * (After a build, the same strings must be absent from .next/static except
 * in the reader route's own chunks.)
 */

const ROOT = process.cwd();
const ENTRIES = ["src/app/layout.tsx", "src/app/not-found.tsx"];
const COMIC_MODULES = ["src/lib/comic/", "src/components/comic/", "src/app/read/"];
const COMIC_STRINGS = /agile[ -]at[ -]work|\/comic\b|toolkit:comic:/i;
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const candidate of [
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null; // CSS, JSON, assets
}

/** Specifiers of every import that ships code, and every string in the file. */
function scan(file: string): { imports: string[]; strings: string[] } {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const imports: string[] = [];
  const strings: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text);
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, strings };
}

function sharedGraph(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = ENTRIES.map((entry) => path.join(ROOT, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const { imports, strings } = scan(file);
    seen.set(file, strings);
    for (const spec of imports) {
      const next = resolve(spec, file);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

describe("the shared bundle", () => {
  const graph = sharedGraph();
  const files = Array.from(graph.keys(), (file) => path.relative(ROOT, file));

  it("is walked from the real chrome", () => {
    for (const file of [
      "src/components/layout/header.tsx",
      "src/components/layout/app-toaster.tsx",
      "src/components/agent/mascot/mascot-assistant.tsx",
      "src/lib/auth/sign-in-href.ts",
      "src/lib/stores/reader-page-store.ts",
    ]) {
      expect(files).toContain(file);
    }
  });

  it("imports none of the comic's modules", () => {
    const comic = files.filter((file) => COMIC_MODULES.some((dir) => file.startsWith(dir)));
    expect(comic).toEqual([]);
  });

  it("carries no comic title, route or storage key in its strings", () => {
    const hits = Array.from(graph).flatMap(([file, strings]) =>
      strings.filter((s) => COMIC_STRINGS.test(s)).map((s) => `${path.relative(ROOT, file)}: ${s}`)
    );
    expect(hits).toEqual([]);
  });
});
