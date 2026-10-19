"use client";

/**
 * Renders the safe markdown subset (see lib/agent/markdown) as React elements —
 * never dangerouslySetInnerHTML, so it's XSS-safe by construction.
 */

import { Fragment } from "react";
import { parseBlocks, tokenizeInline } from "@/lib/agent/markdown";

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
            return (
              <code key={i} className="rounded bg-card px-1 py-0.5 font-mono text-[0.85em]">
                {t.value}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline underline-offset-2"
              >
                {t.value}
              </a>
            );
          default:
            return <Fragment key={i}>{t.value}</Fragment>;
        }
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2">
      {parseBlocks(source).map((b, i) => {
        switch (b.type) {
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md border border-border bg-card p-2 text-xs"
              >
                <code className="font-mono">{b.text}</code>
              </pre>
            );
          case "h":
            return (
              <p key={i} className="font-semibold">
                <Inline text={b.text} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-0.5 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-0.5 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap break-words">
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
