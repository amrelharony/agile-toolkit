import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Kudos copy uses American spelling: "under-recognized", "Recognize
 * someone", "recognize them?". The fairness hint said "under-recognised"
 * and "recognise them?".
 *
 * Code identifiers from the fairness library (`underRecognised`) are API
 * names, not copy, and are left alone: the pattern skips a "recognis" that
 * follows a letter.
 */

const KUDOS_DIR = join(process.cwd(), "src", "app", "(tools)", "kudos");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

describe("Kudos spelling", () => {
  it("has no British 'recognise' spellings in the kudos tool", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(KUDOS_DIR)) {
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/(?<![A-Za-z])[Rr]ecognis(e|ed|es|ing)\b/.test(line)) {
            hits.push(`${file.slice(KUDOS_DIR.length)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it("uses the American spelling in the fairness hint", () => {
    const client = readFileSync(join(KUDOS_DIR, "kudos-client.tsx"), "utf8");
    expect(client).toContain('"looks under-recognized this month"');
    expect(client).toContain('" — recognize them?"');
  });
});
