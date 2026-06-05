/**
 * Tiny, safe markdown parser for agent chat replies. Covers the subset models
 * actually emit: headings, bullet/numbered lists, fenced code, and inline
 * **bold** / *italic* / `code` / [links](url).
 *
 * Pure (returns plain data, no React) so it's unit-testable; the <Markdown>
 * component maps the output to React elements. Because rendering never uses
 * dangerouslySetInnerHTML, any embedded HTML is shown as literal text (XSS-safe);
 * the only injection vector — a link href — is restricted to http(s)/mailto here,
 * with anything else degraded to plain text.
 */

export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string } // heading → emphasized line
  | { type: "code"; text: string } // fenced code block
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

const SAFE_HREF = /^(https?:|mailto:)/i;

// Order matters: code first so `**` inside a code span isn't treated as bold.
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+?\*\*)|(\*[^*\n]+?\*|_[^_\n]+?_)|(\[[^\]]+\]\([^)\s]+\))/;

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
      if (lm && SAFE_HREF.test(lm[2])) {
        out.push({ type: "link", value: lm[1], href: lm[2] });
      } else {
        out.push({ type: "text", value: tok }); // unsafe / malformed → literal
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

const LIST_RE = /^\s*([-*]|\d+\.)\s+/;
const HEADING_RE = /^#{1,6}\s+(.*)$/;

/** Parse text into block-level markdown structures. */
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if present)
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      blocks.push({ type: "h", text: h[1] });
      i++;
      continue;
    }

    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        items.push(lines[i].replace(LIST_RE, ""));
        i++;
      }
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trimStart().startsWith("```") &&
      !HEADING_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }
  return blocks;
}
