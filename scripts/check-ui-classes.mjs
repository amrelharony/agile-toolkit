/**
 * Guard against UI patterns the 2026-10 UX overhaul removed.
 *
 *   node scripts/check-ui-classes.mjs          # scan src/, exit 1 on findings
 *
 * - Text smaller than 12 px (text-[8|9|10|11px]): unreadable, and paired with
 *   muted colour it failed contrast. Use text-xs or larger.
 * - Brand/status hex in class names (text-[#00ff88], bg-[#ef4444]/10, …):
 *   fixed hex ignores the theme and was unreadable in light mode. Use the
 *   tokens (accent, accent-green, success, warning, danger, info).
 * - Solid accent hover fills (hover:bg-accent without an opacity): the
 *   accent is the bright brand colour, so the label vanished on hover. Tint
 *   with hover:bg-accent/10.
 * - Opacity modifiers on border-border (border-border/40): --border is
 *   already translucent and the base layer paints every border with it.
 * - Own-colour text on a tint of itself stronger than 20% (bg-accent/25 with
 *   text-accent on the same line, hover and other variants included): the
 *   light theme's tokens keep 4.5:1 only up to /20
 *   (test/design/theme-contrast.test.ts). Use /20 or less, or text-text.
 *
 * Exits 0 when clean. Prints file:line and the offending class otherwise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RULES = [
  {
    id: "text-below-12px",
    re: /(?<![\w-])(?:[a-z0-9-]+:)*text-\[(?:[0-9]|1[01])(?:\.\d+)?px\](?![\w\]-])/g,
    hint: "use text-xs (12px) or larger",
  },
  {
    id: "brand-hex-class",
    re: /(?<![\w-])(?:[a-z0-9-]+:)*(?:text|bg|border|ring|from|to|via|fill|stroke|outline|decoration)-\[#(?:00ff88|00f0ff|00e1ff|ffaa00|ff00aa|22c55e|ef4444|eab308)\](?:\/\d+)?(?![\w-])/gi,
    hint: "use theme tokens (accent, accent-green, success, warning, danger, info)",
  },
  {
    id: "solid-accent-hover",
    re: /(?<![\w-])hover:bg-accent(?![\w/-])/g,
    hint: "tint instead: hover:bg-accent/10",
  },
  {
    id: "border-border-opacity",
    re: /(?<![\w-])(?:[a-z0-9-]+:)*border-border\/\d+(?![\w-])/g,
    hint: "drop the modifier: --border is already translucent",
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

// Solid status dots (bg-[#22c55e] with no opacity) read fine in every theme.
const ALLOWED = /^(?:[a-z0-9-]+:)*bg-\[#(?:22c55e|ef4444|eab308)\]$/i;

// Colours used as text on tints of themselves. Up to 60% counts as a tint;
// above that the fill is near-solid and own-colour text is a different bug.
const TINT_TOKENS =
  "accent|accent-cyan|accent-3|accent-green|accent-amber|accent-magenta|primary|success|warning|danger|error|info|destructive|status-green|status-yellow|status-red";
const TINT_RE = new RegExp(
  `(?<![\\w-])(?:[a-z0-9-]+:)*bg-(${TINT_TOKENS})\\/(\\d+)(?![\\w-])`,
  "g"
);
const MAX_OWN_TINT = 20;

function strongOwnTints(line) {
  const found = [];
  for (const m of line.matchAll(TINT_RE)) {
    const pct = Number(m[2]);
    if (pct <= MAX_OWN_TINT || pct > 60) continue;
    const ownText = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*text-${m[1]}(?![\\w/-])`);
    if (ownText.test(line)) found.push(m[0]);
  }
  return found;
}

export function findViolations(source) {
  const found = [];
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // comments
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (ALLOWED.test(m[0])) continue;
        found.push({ line: i + 1, rule: rule.id, match: m[0], hint: rule.hint });
      }
    }
    for (const match of strongOwnTints(line)) {
      found.push({
        line: i + 1,
        rule: "strong-own-tint",
        match,
        hint: `tint at most /${MAX_OWN_TINT} under its own text colour, or use text-text`,
      });
    }
  });
  return found;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(process.cwd(), "src");
  let total = 0;
  for (const file of walk(root)) {
    for (const v of findViolations(readFileSync(file, "utf8"))) {
      total++;
      console.log(
        `${path.relative(process.cwd(), file)}:${v.line}  ${v.rule}  ${v.match}  (${v.hint})`
      );
    }
  }
  if (total > 0) {
    console.log(`\n${total} UI class violation(s).`);
    process.exit(1);
  }
  console.log("UI classes OK.");
}
