import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every toast goes through lib/utils/toast.ts, so the notification policy
 * (lib/notify/policy.ts) sees it: its kind, the quiet state, dialogs,
 * typing, dedupe and the burst cap. Importing sonner directly would skip
 * all of that. Only the Toaster wrapper and the notify layer may.
 * (ESLint's no-restricted-imports says the same in the editor.)
 */

const ROOT = join(__dirname, "..", "..");

const ALLOWED = (rel: string) =>
  rel === "src/components/ui/sonner.tsx" || rel.startsWith("src/lib/notify/");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A real import (or re-export) of sonner; a comment that mentions one doesn't count. */
const SONNER_IMPORT =
  /(?:^\s*(?:import|export)\b[^;]*?\bfrom\s*["']sonner(?:\/[^"']*)?["']|\bimport\s*\(\s*["']sonner(?:\/[^"']*)?["']\s*\)|\brequire\(\s*["']sonner["']\s*\)|^\s*import\s*["']sonner["'])/m;

describe("no direct sonner", () => {
  const files = sourceFiles(join(ROOT, "src")).map((full) => ({
    rel: relative(ROOT, full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));

  it("only the toaster wrapper and lib/notify import sonner", () => {
    const offenders = files
      .filter(({ rel, text }) => !ALLOWED(rel) && SONNER_IMPORT.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the allowed files really are the ones that do", () => {
    const users = files.filter(({ text }) => SONNER_IMPORT.test(text)).map(({ rel }) => rel);
    expect(users).toContain("src/components/ui/sonner.tsx");
    expect(users).toContain("src/lib/notify/notify.ts");
  });

  it("the pattern catches every import form", () => {
    for (const line of [
      'import { toast } from "sonner";',
      'import {\n  toast,\n  type ExternalToast,\n} from "sonner";',
      'export { toast } from "sonner";',
      "import { toast } from 'sonner'",
      'const { toast } = await import("sonner");',
      'const s = require("sonner");',
      'import "sonner";',
    ]) {
      expect(SONNER_IMPORT.test(line), line).toBe(true);
    }
    expect(SONNER_IMPORT.test('import { toast } from "@/lib/utils/toast";')).toBe(false);
    expect(SONNER_IMPORT.test(' * Drop-in replacement for `import { toast } from "sonner"`.')).toBe(
      false
    );
  });

  it("ESLint blocks sonner outside the same files", () => {
    const config = JSON.parse(readFileSync(join(ROOT, ".eslintrc.json"), "utf8")) as {
      rules?: Record<string, unknown>;
      overrides?: { files: string[]; rules?: Record<string, unknown> }[];
    };
    expect(JSON.stringify(config.rules?.["no-restricted-imports"] ?? "")).toContain("sonner");
    const allowed = (config.overrides ?? []).find((o) =>
      o.files.includes("src/components/ui/sonner.tsx")
    );
    expect(allowed?.files).toContain("src/lib/notify/**/*");
  });
});
