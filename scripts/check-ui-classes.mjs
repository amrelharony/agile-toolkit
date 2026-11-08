/**
 * Guard against UI patterns the 2026-10 UX overhaul removed.
 *
 *   node scripts/check-ui-classes.mjs          # scan src/, exit 1 on findings
 *
 * - Text smaller than 12 px (text-[8|9|10|11px]): unreadable, and paired with
 *   muted colour it failed contrast. Use text-xs or larger.
 * - Brand/status hex in class names (text-[#00ff88], bg-[#ef4444]/10, …):
 *   fixed hex ignores the theme and was unreadable on paper. Use the tokens
 *   (accent, accent-green, success, warning, danger, info). Covers the old neon
 *   hexes and the comic's own palette, which would break night and high contrast.
 * - Solid accent hover fills (hover:bg-accent without an opacity): the
 *   accent is the bright brand colour, so the label vanished on hover. Tint
 *   with hover:bg-accent/10.
 * - Opacity modifiers on border-border (border-border/40): --border is
 *   already translucent and the base layer paints every border with it.
 * - Own-colour text on a tint of itself stronger than 20% (bg-accent/25 with
 *   text-accent on the same line, hover and other variants included): the
 *   three themes' tokens keep 4.5:1 only up to /20
 *   (test/design/theme-contrast.test.ts). Use /20 or less, or text-text.
 * - A rigid header search pill (shrink-0, flex-shrink-0 or flex-none, any
 *   variant, on the element marked data-header-search): a pill that can't
 *   give width back pushed the 768–1040 px header wider than the screen,
 *   taking help, theme, the account menu and Amr off it. Use a min-width
 *   floor instead.
 * - A width breakpoint shrinking a touch primitive (md:h-9, md:min-h-0,
 *   md:w-9 in Button, IconButton, Input, Textarea, ToggleGroup): a landscape
 *   phone or a tablet is md+ but still touch, so it got 36 px controls. Shrink
 *   for a mouse only: md-fine:h-9 (or pointer-fine:).
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
    re: /(?<![\w-])(?:[a-z0-9-]+:)*(?:text|bg|border|ring|from|to|via|fill|stroke|outline|decoration)-\[#(?:00ff88|00f0ff|00e1ff|ffaa00|ff00aa|22c55e|ef4444|eab308|873a16|1c4f94|6a3560|1c5f3d|6f510c|9c1c2e|174f9c|4c5b20|784a10|8a2a54|eda86a)\](?:\/\d+)?(?![\w-])/gi,
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

const HEADER_SEARCH_MARKER = "data-header-search";
// A class that stops a flex item shrinking. Not after `:` or `]`, so an
// arbitrary child variant (`[&>svg]:shrink-0`) — about the children — passes.
const RIGID_FLEX_RE =
  /(?<![\w:\]-])(?:[a-z0-9-]+:)*!?(?:shrink-0|flex-shrink-0|flex-none)(?![\w-])/g;

/**
 * The JSX opening tag that starts at `start` (a `<`), with comments inside
 * `{…}` blanked out (same length, so offsets still map to lines). Skips
 * strings and `{…}` expressions, so `=>` and `>` in them don't end the tag.
 */
function openingTag(source, start) {
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += source[i + 1] ?? "";
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    const next = source[i + 1];
    if (depth > 0 && c === "/" && (next === "/" || next === "*")) {
      let stop = next === "/" ? source.indexOf("\n", i) : source.indexOf("*/", i + 2);
      if (stop === -1) stop = source.length;
      else if (next === "*") stop += 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
      continue;
    }
    out += c;
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) break;
  }
  return out;
}

function rigidHeaderSearch(source) {
  const found = [];
  if (!source.includes(HEADER_SEARCH_MARKER)) return found;
  const tagStarts = [...source.matchAll(/<[A-Za-z]/g)].map((m) => m.index);
  for (const marker of source.matchAll(new RegExp(HEADER_SEARCH_MARKER, "g"))) {
    // The nearest tag start before the marker whose opening tag spans it.
    for (let k = tagStarts.length - 1; k >= 0; k--) {
      const start = tagStarts[k];
      if (start > marker.index) continue;
      const tag = openingTag(source, start);
      if (start + tag.length <= marker.index) continue;
      for (const m of tag.matchAll(RIGID_FLEX_RE)) {
        const line = source.slice(0, start + m.index).split("\n").length;
        found.push({
          line,
          rule: "rigid-header-search",
          match: m[0],
          hint: "the header search must shrink: give it a min-width floor, not shrink-0",
        });
      }
      break;
    }
  }
  return found;
}

// The primitives whose size is a touch target. Their compact desktop size has
// to be scoped to a mouse (md-fine:, pointer-fine:), not to a width.
const TOUCH_PRIMITIVES = new Set([
  "src/components/ui/button.tsx",
  "src/components/ui/icon-button.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/ui/toggle-group.tsx",
]);
// Shrinks already on master that another fix moves to a pointer variant.
// Input belongs to the form-fields fix (claude/mobile-form-fields): drop the
// entry when it lands. Anything new in these files still fails.
const PENDING_SHRINKS = new Map([["src/components/ui/input.tsx", new Set(["md:h-9"])]]);
// A size utility (h, w, min-h, min-w, size) with a number, px, or an
// arbitrary value, behind a chain of variants that includes a width
// breakpoint. A chain that also says pointer-fine is scoped to a mouse.
const WIDTH_SHRINK_RE =
  /(?<![\w-])((?:[a-z0-9-]+:)*)(?:min-)?(?:h|w|size)-(?:\d[\d.]*|px|\[[^\]\s]+\])(?![\w\]-])/g;
const SCREEN_VARIANT = /(?:^|:)(?:xs|sm|md|lg|xl|2xl|3xl):/;

function widthShrinks(line, file) {
  if (!file || !TOUCH_PRIMITIVES.has(file)) return [];
  const pending = PENDING_SHRINKS.get(file);
  const found = [];
  for (const m of line.matchAll(WIDTH_SHRINK_RE)) {
    const chain = `:${m[1]}`;
    if (!SCREEN_VARIANT.test(chain) || /(?:^|:)pointer-fine:/.test(chain)) continue;
    if (pending?.has(m[0])) continue;
    found.push(m[0]);
  }
  return found;
}

/**
 * @param {string} source file contents
 * @param {string} [file] repo-relative path with forward slashes; enables the
 *   rules that only apply to some files (touch primitives)
 */
export function findViolations(source, file) {
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
    for (const match of widthShrinks(line, file)) {
      found.push({
        line: i + 1,
        rule: "touch-primitive-width-shrink",
        match,
        hint: "touch screens of any width keep 44 px: shrink for a mouse with md-fine: (or pointer-fine:)",
      });
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
  found.push(...rigidHeaderSearch(source));
  return found;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(process.cwd(), "src");
  let total = 0;
  for (const file of walk(root)) {
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    for (const v of findViolations(readFileSync(file, "utf8"), rel)) {
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
