/**
 * Tiny, safe markdown parser for agent chat replies. Covers the subset models
 * actually emit: headings, bullet and numbered lists (one level of nesting,
 * numbering kept), GFM pipe tables, quotes, rules, fenced code (with its
 * language), and inline **bold** / *italic* / `code` / [links](url).
 *
 * Pure (returns plain data, no React) so it's unit-testable; the <Markdown>
 * component maps the output to React elements. Because rendering never uses
 * dangerouslySetInnerHTML, any embedded HTML is shown as literal text (XSS-safe);
 * the only injection vector — a link href — is restricted to http(s)/mailto and
 * the site's own pages ("/retro") here, with anything else degraded to plain
 * text.
 *
 * Streaming: a reply is re-rendered on every chunk, so the text is cut into
 * segments at blank lines outside code fences (never inside a list that the
 * next lines continue), and `createBlockParser` keeps each finished segment's
 * blocks. Only the trailing segment, the one still growing, is parsed again.
 * Cutting there never changes the result: every block the parser makes ends
 * at such a blank line, so `parseBlocks` is the same parse in one go.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string; internal?: true };

/** One list item: its own text (first line, then continuation lines) and one level of nested lists. */
export interface ListItem {
  text: string;
  children?: ListBlock[];
}

export type ListBlock =
  | { type: "ul"; items: ListItem[] }
  /** `start` is the first item's own number, so "3. Three" renders as 3. */
  | { type: "ol"; start: number; items: ListItem[] };

/** A column's alignment from the table's separator row (`:--`, `:-:`, `--:`). */
export type TableAlign = "left" | "center" | "right" | null;

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string } // any heading level: the chat shows them all as h3
  | { type: "code"; text: string; lang?: string } // fenced code block
  | ListBlock
  | { type: "table"; head: string[]; align: TableAlign[]; rows: string[][] }
  | { type: "quote"; paragraphs: string[] }
  | { type: "hr" };

const SAFE_HREF = /^(https?:|mailto:)/i;
/**
 * A path on this site ("/retro", "/retro/abc?x=1"): one leading slash, never
 * two ("//evil.com" is another host) and never a slash then a backslash
 * ("/\evil.com", which browsers read as "//evil.com").
 */
const INTERNAL_HREF = /^\/(?![/\\])/;

// Order matters: code first so `**` inside a code span isn't treated as bold.
// Underscore italics are gated to word boundaries (CommonMark forbids
// intraword `_emphasis_`) so snake_case ids the model emits in prose — e.g.
// `workspace_sprint_create` (see system-prompt) — aren't split and italicized.
// `*italic*` is unaffected.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\n]+?\*|(?<![A-Za-z0-9])_[^_\n]+?_(?![A-Za-z0-9]))|(\[[^\]]+\]\([^)\s]+\))/;

/** Split a line of text into inline tokens (bold/italic/code/link/text). */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let rest = text;
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push({ type: "text", value: rest });
      break;
    }
    if (m.index > 0) out.push({ type: "text", value: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push({ type: "code", value: tok.slice(1, -1) });
    } else if (tok.startsWith("**")) {
      out.push({ type: "bold", value: tok.slice(2, -2) });
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push({ type: "italic", value: tok.slice(1, -1) });
    } else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (lm && INTERNAL_HREF.test(lm[2])) {
        out.push({ type: "link", value: lm[1], href: lm[2], internal: true });
      } else if (lm && SAFE_HREF.test(lm[2])) {
        out.push({ type: "link", value: lm[1], href: lm[2] });
      } else {
        out.push({ type: "text", value: tok }); // unsafe / malformed → literal
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

// ── Line shapes ─────────────────────────────────────────────────────────

/** A list item line: indent, marker ("-", "*", "+", "1." or "1)"), then its text. */
const LIST_RE = /^([ \t]*)(?:[-*+]|(\d{1,9})[.)])[ \t]+(.*)$/;
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
/** Three or more of one of -, * or _, with nothing else but spaces. */
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>/;
/** One cell of a table's separator row. */
const SEP_CELL_RE = /^:?-+:?$/;
/** A fence's language, kept only when it looks like one ("ts", "c++", "objective-c"). */
const LANG_RE = /^[A-Za-z0-9_+#.-]{1,24}$/;

const isBlank = (line: string) => line.trim() === "";

/** Leading whitespace width, a tab counting to the next multiple of 4. */
function indentOf(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w += 1;
    else if (ch === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
}

interface Marker {
  indent: number;
  ordered: boolean;
  num: number;
  text: string;
}

function listMarker(line: string): Marker | null {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return {
    indent: indentOf(m[1]),
    ordered: m[2] !== undefined,
    num: m[2] !== undefined ? parseInt(m[2], 10) : 0,
    text: m[3],
  };
}

interface Fence {
  indent: number;
  char: string;
  len: number;
  lang?: string;
}

/**
 * The fence a line opens: ``` or ~~~ (3 or more), with an optional language.
 * At any indent, since models indent a step's code under its list item (the
 * chat has no indented code blocks, so nothing else claims the indent).
 */
function openFence(line: string): Fence | null {
  const m = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  const info = m[3].trim();
  if (m[2][0] === "`" && info.includes("`")) return null; // CommonMark: not a fence
  const word = info.split(/\s+/)[0] ?? "";
  return {
    indent: indentOf(m[1]),
    char: m[2][0],
    len: m[2].length,
    lang: LANG_RE.test(word) ? word : undefined,
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const t = line.trim();
  let n = 0;
  while (n < t.length && t[n] === fence.char) n++;
  return n >= fence.len && t.slice(n).trim() === "";
}

/** `line` without up to `cols` columns of its leading whitespace. */
function dedent(line: string, cols: number): string {
  let w = 0;
  let k = 0;
  while (k < line.length && w < cols && (line[k] === " " || line[k] === "\t")) {
    w += line[k] === "\t" ? 4 - (w % 4) : 1;
    k++;
  }
  return line.slice(k);
}

/** A table row's cells: split on unescaped pipes, outside `code`, edge pipes dropped. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "`" && s.indexOf("`", i + 1) !== -1) {
      const end = s.indexOf("`", i + 1);
      cur += s.slice(i, end + 1).replace(/\\\|/g, "|");
      i = end;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Lines `i` and `i + 1` open a table: a header row with a pipe, then a
 * separator row with a pipe and as many cells. Until the separator has
 * arrived in full, a streaming table stays a paragraph.
 */
function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const sep = lines[i + 1];
  if (sep === undefined || !head.includes("|") || !sep.includes("|")) return false;
  const sepCells = splitRow(sep);
  return sepCells.every((c) => SEP_CELL_RE.test(c)) && sepCells.length === splitRow(head).length;
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/** A line that starts a block of its own, so it ends a paragraph, a list or a table. */
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return (
    openFence(line) !== null ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    isTableStart(lines, i)
  );
}

/**
 * After a blank line, whether `line` carries on a list whose items sit at
 * `base`: a sibling item of the same kind, a nested item, or a continuation
 * line indented under an item. A rule or a fence never does.
 */
function continuesList(line: string, base: number, ordered: boolean): boolean {
  if (openFence(line) || HR_RE.test(line)) return false;
  const mk = listMarker(line);
  if (mk) return mk.indent >= base + 2 || mk.ordered === ordered;
  return indentOf(line) >= base + 2;
}

function nextNonBlank(lines: string[], from: number): number {
  for (let j = from; j < lines.length; j++) if (!isBlank(lines[j])) return j;
  return -1;
}

const normalize = (src: string) => src.replace(/\r\n?/g, "\n");

// ── Segments ────────────────────────────────────────────────────────────

/**
 * Cut a reply at blank lines that end every block: outside code fences, and
 * not where the next line could carry on a list. The list check errs on the
 * side of keeping lines together (its base is the least indent of any item
 * since the list began, and any item continues it), so it never splits a
 * list the parser would continue; keeping too much together only costs
 * caching.
 */
export function splitSegments(src: string): string[] {
  const lines = normalize(src).split("\n");
  const segments: string[] = [];
  let buf: string[] = [];
  let fence: Fence | null = null;
  let listBase: number | null = null;
  const flush = () => {
    if (buf.length) segments.push(buf.join("\n"));
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      buf.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = openFence(line);
    if (opened) {
      fence = opened;
      listBase = null;
      buf.push(line);
      continue;
    }
    if (isBlank(line)) {
      if (listBase !== null) {
        const j = nextNonBlank(lines, i + 1);
        const next = j === -1 ? "" : lines[j];
        if (
          j !== -1 &&
          !openFence(next) &&
          !HR_RE.test(next) &&
          (listMarker(next) !== null || indentOf(next) >= listBase + 2)
        ) {
          buf.push(line);
          continue;
        }
      }
      flush();
      listBase = null;
      continue;
    }
    const mk = listMarker(line);
    if (mk) listBase = listBase === null ? mk.indent : Math.min(listBase, mk.indent);
    else if (listBase !== null && indentOf(line) < listBase + 2) listBase = null;
    buf.push(line);
  }
  flush();
  return segments;
}

// ── Blocks ──────────────────────────────────────────────────────────────

/**
 * A list from line `start`, which is an item. Items of the same kind
 * at the first item's indent are siblings, even across blank lines (a loose
 * list); a change of kind there starts a new list. Items indented 2 or more
 * spaces further are one nested level (deeper ones join it). Other lines
 * indented that far continue the item above. Anything else ends the list.
 */
function parseList(lines: string[], start: number): { block: ListBlock; next: number } {
  const first = listMarker(lines[start]) as Marker;
  const base = first.indent;
  const items: ListItem[] = [];
  let item: ListItem | null = null;
  let nested: { block: ListBlock; indent: number; item: ListItem | null } | null = null;
  let gap = false; // a blank line came before this one, inside the list
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      const j = nextNonBlank(lines, i);
      if (j === -1 || !continuesList(lines[j], base, first.ordered)) break;
      gap = true;
      i = j;
      continue;
    }
    if (i !== start && startsBlock(lines, i)) break;
    const mk = listMarker(line);
    if (mk && mk.indent < base + 2) {
      if (mk.ordered !== first.ordered) break;
      item = { text: mk.text };
      items.push(item);
      nested = null;
    } else if (mk && item) {
      if (!nested || (nested.block.type === "ol") !== mk.ordered) {
        const block: ListBlock = mk.ordered
          ? { type: "ol", start: mk.num, items: [] }
          : { type: "ul", items: [] };
        nested = { block, indent: mk.indent, item: null };
        (item.children ??= []).push(block);
      }
      nested.item = { text: mk.text };
      nested.block.items.push(nested.item);
    } else if (item && indentOf(line) >= base + 2) {
      const target = nested?.item && indentOf(line) >= nested.indent + 2 ? nested.item : item;
      target.text += (gap ? "\n\n" : "\n") + line.trim();
    } else {
      break;
    }
    gap = false;
    i++;
  }
  const block: ListBlock = first.ordered
    ? { type: "ol", start: first.num, items }
    : { type: "ul", items };
  return { block, next: i };
}

/**
 * Parse one segment (or any text, uncut and uncached) into blocks, before
 * numberLists. Exported so a test can check that cutting a reply into
 * segments never changes what it parses to.
 */
export function parseSegment(src: string): Block[] {
  const lines = normalize(src).split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = openFence(line);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i], fence)) {
        // Drop up to the fence's own indent from each line (CommonMark).
        buf.push(dedent(lines[i], fence.indent));
        i++;
      }
      i++; // consume closing fence (if present)
      blocks.push(
        fence.lang
          ? { type: "code", text: buf.join("\n"), lang: fence.lang }
          : { type: "code", text: buf.join("\n") }
      );
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push({ type: "h", text: h[1] });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const paragraphs: string[] = [];
      let para: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        // Nested quotes ("> > x") flatten into this one.
        const inner = lines[i].replace(/^(?: {0,3}> ?)+/, "");
        if (isBlank(inner)) {
          if (para.length) paragraphs.push(para.join("\n"));
          para = [];
        } else {
          para.push(inner.trim());
        }
        i++;
      }
      if (para.length) paragraphs.push(para.join("\n"));
      if (paragraphs.length) blocks.push({ type: "quote", paragraphs });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (
        i < lines.length &&
        !isBlank(lines[i]) &&
        lines[i].includes("|") &&
        !openFence(lines[i]) &&
        !HEADING_RE.test(lines[i]) &&
        !QUOTE_RE.test(lines[i])
      ) {
        // A short row is padded with empty cells; a long one loses its extras (GFM).
        const cells = splitRow(lines[i]).slice(0, head.length);
        while (cells.length < head.length) cells.push("");
        rows.push(cells);
        i++;
      }
      blocks.push({ type: "table", head, align, rows });
      continue;
    }

    if (listMarker(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !listMarker(lines[i]) &&
      !startsBlock(lines, i)
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length === 0) {
      // Defensive: a line no rule above took. Show it as text, never loop.
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}

/**
 * Numbering across a reply. A numbered list already starts at its first
 * item's own number ("2. Then" after a paragraph renders as 2). When a
 * model numbers every step "1." and puts text between the steps, each step
 * is a one-item list that starts at the same number as the one before:
 * that one carries on the count (1, 2, 3, not 1, 1, 1). Only paragraphs,
 * code and quotes may sit between them. Changed lists are new objects; the
 * parsed ones are never mutated, since the parser's cache shares them.
 */
export function numberLists(blocks: Block[]): Block[] {
  let prev: { written: number; start: number; count: number } | null = null;
  return blocks.map((b) => {
    if (b.type === "ol") {
      const carry = prev !== null && prev.count === 1 && b.start === prev.written;
      const start = carry && prev ? prev.start + 1 : b.start;
      prev = { written: b.start, start, count: b.items.length };
      return start === b.start ? b : { ...b, start };
    }
    if (b.type !== "p" && b.type !== "code" && b.type !== "quote") prev = null;
    return b;
  });
}

/**
 * A parser that remembers each segment's blocks from its last call, so a
 * streaming reply re-parses only the segment still growing. Each call keeps
 * only the segments it saw, so the cache never outgrows one reply.
 */
export function createBlockParser(): (src: string) => Block[] {
  let cache = new Map<string, Block[]>();
  return (src) => {
    const seen = new Map<string, Block[]>();
    const blocks: Block[] = [];
    for (const segment of splitSegments(src)) {
      const parsed = seen.get(segment) ?? cache.get(segment) ?? parseSegment(segment);
      seen.set(segment, parsed);
      blocks.push(...parsed);
    }
    cache = seen;
    return numberLists(blocks);
  };
}

/** Parse text into block-level markdown structures. */
export function parseBlocks(src: string): Block[] {
  return numberLists(splitSegments(src).flatMap(parseSegment));
}

// ── Direction ───────────────────────────────────────────────────────────

/** Letters of right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, NKo and their presentation forms. */
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;
/** Letters of the common left-to-right scripts: Latin, Greek, Cyrillic. */
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/**
 * The direction of the first strong letter, as `dir="auto"` would find it,
 * or undefined when there is none. The renderer gives a table this, because
 * `dir="auto"` on the table would skip its cells (they carry their own).
 */
export function textDirection(text: string): "rtl" | "ltr" | undefined {
  for (const ch of text) {
    if (RTL_LETTER.test(ch)) return "rtl";
    if (LTR_LETTER.test(ch)) return "ltr";
  }
  return undefined;
}
