// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getToolById } from "@/lib/constants/tools";

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

const pages = pageFiles(path.join(process.cwd(), "src", "app"));

describe("page metadata", () => {
  it("never repeats the site name the layout template already appends", () => {
    const offenders = pages.filter((f) =>
      /^\s{2}title:\s*"[^"]*Agile Toolkit"/m.test(readFileSync(f, "utf8"))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("only builds metadata for tools that exist", () => {
    for (const f of pages) {
      for (const m of Array.from(readFileSync(f, "utf8").matchAll(/toolMetadata\("([^"]+)"/g))) {
        expect(getToolById(m[1]), `${f}: unknown tool "${m[1]}"`).toBeDefined();
      }
    }
  });

  it("gives every tool page a description", () => {
    const toolPages = pages.filter((f) => f.includes(`${path.sep}(tools)${path.sep}`));
    const missing = toolPages.filter((f) => {
      const src = readFileSync(f, "utf8");
      return !/description[:,\s]/.test(src) && !src.includes("toolMetadata(");
    });
    expect(missing.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
