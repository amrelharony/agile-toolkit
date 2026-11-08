import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toast inventory ratchet. An action that only echoes what the user just
 * did ("Copied", "Exported", "Downloaded") is confirmed inline by its own
 * control (components/ui/copy-button.tsx, hooks/use-flash.ts), never with a
 * success/info toast, so this fails if one comes back. The counts of
 * non-error toasts may only go down: lower a ceiling when you remove some,
 * never raise one to make room (find an inline confirmation instead).
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/** The toast layer itself, which forwards to sonner. */
const SKIP = (rel: string) =>
  rel.startsWith("src/lib/notify/") ||
  rel === "src/lib/utils/toast.ts" ||
  rel === "src/components/ui/sonner.tsx";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC)
  .map((full) => ({ rel: relative(ROOT, full).split(sep).join("/"), full }))
  .filter(({ rel }) => !SKIP(rel))
  .map(({ rel, full }) => ({ rel, text: readFileSync(full, "utf8") }));

type Helper = "plain" | "success" | "error" | "info" | "warning" | "message" | "loading";

const CALL = /\btoast(?:\.(success|error|info|warning|message|loading))?\(/g;
/** A success/info/plain toast whose first argument is a string or template literal. */
const LITERAL_CALL =
  /\btoast(?:\.(success|info|message))?\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)/g;

const ECHO = /\b(copied|exported|downloaded)\b/i;

function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const g = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) out.push(m);
  return out;
}

function titles(text: string): { helper: string; title: string }[] {
  return allMatches(LITERAL_CALL, text).map((m) => ({
    helper: m[1] ?? "plain",
    title: m[2] ?? m[3] ?? m[4] ?? "",
  }));
}

/** A success/info/message/plain toast call (not error/warning/loading). */
const NON_ERROR_CALL = /\btoast(?:\.(success|info|message))?\(/g;

/** The first argument of each non-error toast call, as source text. */
function firstArgs(text: string): { helper: string; arg: string }[] {
  const out: { helper: string; arg: string }[] = [];
  for (const m of allMatches(NON_ERROR_CALL, text)) {
    let depth = 0;
    let quote: string | null = null;
    const start = m.index + m[0].length;
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) break;
        depth--;
      } else if (c === "," && depth === 0) break;
    }
    out.push({ helper: m[1] ?? "plain", arg: text.slice(start, i).trim() });
  }
  return out;
}

/**
 * Whether a toast's first argument echoes a copy, export or download: the
 * text itself (literals, concatenation, template parts, a helper's
 * arguments), or, for a bare name, a string the same file assigns to it.
 */
function echoes(arg: string, fileText: string): boolean {
  if (ECHO.test(arg)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
    const name = arg.replace(/\$/g, "\\$");
    const assigned = new RegExp(`\\b${name}\\s*=\\s*(["'\`])([^"'\`]*)\\1`);
    return allMatches(assigned, fileText).some((m) => ECHO.test(m[2]));
  }
  return false;
}

function counts(): Record<Helper, number> {
  const out: Record<Helper, number> = {
    plain: 0,
    success: 0,
    error: 0,
    info: 0,
    warning: 0,
    message: 0,
    loading: 0,
  };
  for (const { text } of FILES) {
    for (const m of allMatches(CALL, text)) out[(m[1] as Helper | undefined) ?? "plain"] += 1;
  }
  return out;
}

/** Ceilings measured after the PR G sweep. They only ever go down. */
const CEILING: Partial<Record<Helper, number>> = {
  success: 22,
  info: 19,
  message: 1,
  plain: 10,
};

describe("toast inventory", () => {
  it("scans the app's sources", () => {
    expect(FILES.length).toBeGreaterThan(500);
  });

  it("has no success/info toast that only echoes a copy, export or download", () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      for (const { helper, title } of titles(text)) {
        if (ECHO.test(title)) offenders.push(`${rel}: toast.${helper}("${title}")`);
      }
      for (const { helper, arg } of firstArgs(text)) {
        if (echoes(arg, text)) offenders.push(`${rel}: toast.${helper}(${arg})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches an echo toast if one comes back (the scanner works)", () => {
    const sample = [
      'toast.success("Link copied");',
      'toast.success(\n  "CSV exported",\n  {}\n);',
      "toast.info(`Copied ${n} rows`);",
      'toast("Backup downloaded");',
      "toast.message('Exported');",
    ].join("\n");
    expect(titles(sample).filter(({ title }) => ECHO.test(title))).toHaveLength(5);
    // Failures stay toasts.
    expect(titles('toast.error("Couldn\'t copy the link");')).toHaveLength(0);
  });

  it("catches echo toasts built from names, concatenation or helpers", () => {
    const sample = [
      'const msg = "Copied";',
      "toast.success(msg);",
      'toast.success(label + " copied");',
      "toast.info(`${label} exported`, { id: 'x' });",
      'toast(format("Downloaded"), { kind: "success" });',
      'toast.success(saved, { id: "a" });',
    ].join("\n");
    const hits = firstArgs(sample).filter(({ arg }) => echoes(arg, sample));
    expect(hits.map((hit) => hit.arg)).toEqual([
      "msg",
      'label + " copied"',
      "`${label} exported`",
      'format("Downloaded")',
    ]);
    // Failures stay toasts.
    expect(firstArgs('toast.error(label + " copy failed");')).toHaveLength(0);
  });

  it("never grows the number of non-error toasts", () => {
    const now = counts();
    for (const [helper, ceiling] of Object.entries(CEILING) as [Helper, number][]) {
      expect(
        now[helper],
        `toast${helper === "plain" ? "" : `.${helper}`} calls: ${now[helper]} > ${ceiling}`
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it("confirms the swept echo sites inline", () => {
    const sites = [
      "src/components/share/share-link-button.tsx",
      "src/components/shared/export-button.tsx",
      "src/components/shared/invite-dialog.tsx",
      "src/components/collab/session-share-modal.tsx",
      "src/components/collab/visitor-room-chip.tsx",
      "src/components/shared/ai-prompt-drawer-content.tsx",
      "src/app/(tools)/comics/components/story-nav.tsx",
      "src/app/(tools)/estimation-guide/estimation-guide-client.tsx",
      "src/app/(tools)/incident-commander/components/active-incident-card.tsx",
      "src/app/(tools)/standup/views.tsx",
      "src/app/(tools)/planning-poker/visitor-poker-room.tsx",
      "src/app/(tools)/retro/room/visitor-retro-room.tsx",
      "src/components/collab/vote-room/vote-join-room.tsx",
      "src/components/data/your-data-dialog.tsx",
    ];
    const action =
      /\b(?:copyToClipboard|exportTo\w*|downloadFile|downloadBlob|shareSnapshotLink)\(/;
    const nonErrorToast = /\btoast(?:\.(?:success|info|message))?\(/;
    for (const site of sites) {
      const file = FILES.find((f) => f.rel === site);
      expect(file, site).toBeDefined();
      expect(/useFlash\(|<CopyButton\b/.test(file!.text), site).toBe(true);
      // And the old confirmation is gone: no success/info toast right after
      // the copy, export or download it confirmed.
      const lines = file!.text.split("\n");
      lines.forEach((line, i) => {
        if (!action.test(line)) return;
        const near = lines.slice(i, i + 6).join("\n");
        expect(nonErrorToast.test(near), `${site}:${i + 1} toasts after: ${line.trim()}`).toBe(
          false
        );
      });
    }
  });
});
