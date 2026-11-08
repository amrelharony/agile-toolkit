import { Fragment, type ReactNode } from "react";

/**
 * Renders the Markdown the tools export (lib per tool: `markdown.ts`) as
 * React elements — never as HTML, so a snapshot link can't inject markup.
 *
 * Supports what those exports emit: `#`–`###` headings, paragraphs, `-`/`*`
 * and `1.` lists (nested by two spaces), `- [ ]` / `- [x]` checklists, GFM
 * tables (with `<br>` inside cells), `>` quotes, `---` rules, and inline
 * **bold**, *italic*, `code` and [links](https://…) to http(s) or relative
 * URLs. Anything else is shown as text.
 */

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; header: string[]; rows: string[][] };

interface ListItem {
  text: string;
  checked?: boolean;
  children: ListItem[];
}

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const CHECK_RE = /^\[( |x|X)\]\s+(.*)$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length as 1 | 2 | 3, text: h[2].trim() });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (line.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: parts.join(" ") });
      continue;
    }
    const lm = LIST_RE.exec(line);
    if (lm) {
      const ordered = /\d+\./.test(lm[2]);
      const root: ListItem[] = [];
      const stack: { indent: number; items: ListItem[] }[] = [
        { indent: lm[1].length, items: root },
      ];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (!m) {
          // A wrapped continuation line belongs to the previous item.
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && stack[stack.length - 1].items.length) {
            const items = stack[stack.length - 1].items;
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        const indent = m[1].length;
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
        const top = stack[stack.length - 1];
        const check = CHECK_RE.exec(m[3]);
        const item: ListItem = {
          text: check ? check[2] : m[3],
          checked: check ? check[1].toLowerCase() === "x" : undefined,
          children: [],
        };
        if (indent > top.indent && top.items.length) {
          const parent = top.items[top.items.length - 1];
          parent.children.push(item);
          stack.push({ indent, items: parent.children });
        } else {
          top.items.push(item);
        }
        i++;
      }
      blocks.push({ type: "list", ordered, items: root });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s/.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !(lines[i].trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("/") && !h.startsWith("//")) return h;
  return null;
}

/** Inline formatting: **bold**, *italic*, `code`, [text](url), <br>. */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|<br\s*\/?>|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      out.push(
        <code key={key} className="rounded bg-surface px-1 font-mono text-xs">
          {m[3]}
        </code>
      );
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            className="text-accent underline-offset-2 hover:underline"
            rel="noopener noreferrer"
          >
            {m[4]}
          </a>
        ) : (
          <Fragment key={key}>{m[4]}</Fragment>
        )
      );
    } else if (m[0].startsWith("<br")) out.push(<br key={key} />);
    else out.push(<em key={key}>{m[6] ?? m[7]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function List({ items, ordered, depth }: { items: ListItem[]; ordered: boolean; depth: number }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 ${depth ? "mt-1" : ""}`}
    >
      {items.map((it, idx) => (
        <li
          key={idx}
          className={
            it.checked !== undefined ? "list-none -ml-5 flex items-start gap-2" : undefined
          }
        >
          {it.checked !== undefined && (
            <span aria-hidden="true" className="mt-0.5 font-mono text-xs text-sub">
              {it.checked ? "☑" : "☐"}
            </span>
          )}
          {/* min-w-0: in a checklist row this span is a flex item, which
              otherwise refuses to shrink below a long URL's width. */}
          <span className="min-w-0">
            {it.checked !== undefined && (
              <span className="sr-only">{it.checked ? "Done: " : "To do: "}</span>
            )}
            {renderInline(it.text, `li${depth}-${idx}`)}
            {it.children.length > 0 && (
              <List items={it.children} ordered={false} depth={depth + 1} />
            )}
          </span>
        </li>
      ))}
    </Tag>
  );
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  // break-words: a long unbroken token (a Docs/Drive ID, a hash, a bare URL)
  // in a shared board wraps instead of widening the page on a phone, the way
  // the tools' own card text does. Tables reset it below and keep scrolling.
  return (
    <div className="min-w-0 space-y-4 break-words text-sm leading-relaxed text-text">
      {blocks.map((b, idx) => {
        switch (b.type) {
          case "heading": {
            const cls =
              b.level === 1
                ? "font-display text-xl font-bold"
                : b.level === 2
                  ? "font-display text-base font-semibold pt-2"
                  : "text-sm font-semibold";
            const H = (b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
            return (
              <H key={idx} className={cls}>
                {renderInline(b.text, `h${idx}`)}
              </H>
            );
          }
          case "paragraph":
            return <p key={idx}>{renderInline(b.text, `p${idx}`)}</p>;
          case "quote":
            return (
              <blockquote key={idx} className="border-l-2 border-accent/50 pl-3 text-sub">
                {renderInline(b.text, `q${idx}`)}
              </blockquote>
            );
          case "rule":
            return <hr key={idx} className="border-border" />;
          case "list":
            return <List key={idx} items={b.items} ordered={b.ordered} depth={0} />;
          case "table":
            return (
              <div
                key={idx}
                className="overflow-x-auto break-normal rounded-lg border border-border"
              >
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-xs text-sub">
                    <tr>
                      {b.header.map((c, ci) => (
                        <th key={ci} scope="col" className="px-3 py-2 font-semibold">
                          {renderInline(c, `th${idx}-${ci}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border align-top">
                        {row.map((c, ci) => (
                          <td key={ci} className="px-3 py-2">
                            {renderInline(c, `td${idx}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
