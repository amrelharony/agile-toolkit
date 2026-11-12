"use client";

/**
 * Renders the safe markdown subset (see lib/agent/markdown) as React elements —
 * never dangerouslySetInnerHTML, so it's XSS-safe by construction.
 *
 * - Tables sit in a labelled region that scrolls sideways and takes focus, so
 *   a keyboard can scroll it; cells are `font-data` with quiet `border-rule`
 *   lines (DNA-SPEC section 4).
 * - Headings at any level are h3: the panel's own title is the h2.
 * - Text blocks carry `dir="auto"`, so an Arabic reply reads right to left.
 *   A list carries it on the ul/ol rather than on each li, so the logical
 *   `ps-5` padding and the markers follow the list's direction: an li with
 *   its own direction would hang its marker outside the list's padding, and
 *   `dir="auto"` on the list would skip every li that had one. A table takes
 *   its header's direction (column order) and each cell its own.
 * - Code keeps its fence's language as `data-lang` and a small label; code
 *   is always left to right.
 * - An external link has an icon and "(opens in a new tab)" for screen readers.
 * - Each block renders through a memo, and the parser keeps finished blocks
 *   (createBlockParser), so while a reply streams only its last block
 *   re-renders.
 */

import { Fragment, memo, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  createBlockParser,
  textDirection,
  tokenizeInline,
  type Block,
  type ListBlock,
  type ListItem,
  type TableAlign,
} from "@/lib/agent/markdown";

/** The accessible name of a table's scrolling region. */
const TABLE_REGION_LABEL = "Table, scrolls sideways";

function Inline({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) => {
        switch (t.type) {
          case "bold":
            return <strong key={i}>{t.value}</strong>;
          case "italic":
            return <em key={i}>{t.value}</em>;
          case "code":
            // On the reply's card a chip needs its own ground and line to show.
            return (
              <code
                key={i}
                className="rounded border border-rule bg-surface-deep px-1 py-0.5 font-data text-[0.85em]"
              >
                {t.value}
              </code>
            );
          case "link":
            // The site's own pages open here, in the same tab (the chat stays
            // open across the navigation); anything else opens a new tab.
            // No prefetch: the model writes these paths (and tool results or
            // pasted text can steer it), so nothing is fetched until a click.
            if (t.internal) {
              return (
                <Link
                  key={i}
                  href={t.href}
                  prefetch={false}
                  className="text-accent underline underline-offset-2"
                >
                  {t.value}
                </Link>
              );
            }
            // A mail link hands off to the mail app: no new tab to announce.
            if (/^mailto:/i.test(t.href)) {
              return (
                <a key={i} href={t.href} className="text-accent underline underline-offset-2">
                  {t.value}
                </a>
              );
            }
            return (
              <a
                key={i}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                {/* A no-break space keeps the icon with the last word and
                    spaces the hidden words from the link's own. */}
                {t.value}
                {" "}
                <ExternalLink aria-hidden="true" className="inline-block h-3 w-3 align-baseline" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            );
          default:
            return <Fragment key={i}>{t.value}</Fragment>;
        }
      })}
    </>
  );
}

function ItemView({ item }: { item: ListItem }) {
  return (
    <li className="whitespace-pre-wrap break-words">
      <Inline text={item.text} />
      {item.children?.map((list, k) => (
        <ListView key={k} list={list} nested />
      ))}
    </li>
  );
}

function ListView({ list, nested = false }: { list: ListBlock; nested?: boolean }) {
  const items = list.items.map((item, j) => <ItemView key={j} item={item} />);
  const space = nested ? "mt-0.5 space-y-0.5 ps-5" : "space-y-0.5 ps-5";
  if (list.type === "ol") {
    return (
      <ol dir="auto" start={list.start} className={`list-decimal ${space}`}>
        {items}
      </ol>
    );
  }
  return (
    <ul dir="auto" className={`${nested ? "list-[circle]" : "list-disc"} ${space}`}>
      {items}
    </ul>
  );
}

const ALIGN: Record<NonNullable<TableAlign>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function TableView({ block }: { block: Extract<Block, { type: "table" }> }) {
  const align = (j: number) => {
    const a = block.align[j];
    return a ? ALIGN[a] : "text-start";
  };
  return (
    <div
      role="region"
      aria-label={TABLE_REGION_LABEL}
      tabIndex={0}
      className="overflow-x-auto overscroll-x-contain"
    >
      <table
        dir={textDirection(block.head.join(" "))}
        className="min-w-full border-collapse font-data text-xs"
      >
        <thead>
          <tr>
            {block.head.map((cell, j) => (
              <th
                key={j}
                scope="col"
                dir="auto"
                className={`border border-rule bg-surface-deep px-2 py-1 align-top font-semibold ${align(j)}`}
              >
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, k) => (
            <tr key={k}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  dir="auto"
                  className={`border border-rule px-2 py-1 align-top ${align(j)}`}
                >
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeView({ block }: { block: Extract<Block, { type: "code" }> }) {
  return (
    <div className="rounded-md border border-border bg-card">
      {block.lang ? (
        // The region's name says the language; this is the label for the eye.
        <div
          aria-hidden="true"
          className="border-b border-rule px-2 py-0.5 font-data text-xs text-sub"
        >
          {block.lang}
        </div>
      ) : null}
      <pre
        data-lang={block.lang}
        dir="ltr"
        role="region"
        aria-label={block.lang ? `Code, ${block.lang}, scrolls sideways` : "Code, scrolls sideways"}
        tabIndex={0}
        className="overflow-x-auto overscroll-x-contain p-2 text-xs"
      >
        <code className="font-data">{block.text}</code>
      </pre>
    </div>
  );
}

const BlockView = memo(function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "code":
      return <CodeView block={block} />;
    case "h":
      return (
        <h3 dir="auto" className="break-words text-sm font-semibold">
          <Inline text={block.text} />
        </h3>
      );
    case "ul":
    case "ol":
      return <ListView list={block} />;
    case "table":
      return <TableView block={block} />;
    case "quote":
      return (
        <blockquote dir="auto" className="space-y-1 border-s-2 border-rule ps-3 text-sub">
          {block.paragraphs.map((text, j) => (
            <p key={j} className="whitespace-pre-wrap break-words">
              <Inline text={text} />
            </p>
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="border-rule" />;
    default:
      return (
        <p dir="auto" className="whitespace-pre-wrap break-words">
          <Inline text={block.text} />
        </p>
      );
  }
});

export function Markdown({ source }: { source: string }) {
  // One parser per reply: it keeps the finished blocks, so each streamed
  // chunk parses only the last one, and the memo skips the rest.
  const [parse] = useState(createBlockParser);
  const blocks = useMemo(() => parse(source), [parse, source]);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
