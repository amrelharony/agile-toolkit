/**
 * A sectioned document's credit line (lib/sectioned): where its format comes
 * from, shown under the document. Plain text; the credit's words become a
 * link when it has a valid https address, and its licence follows in
 * brackets when the owner cleared one. Nothing renders without a credit.
 */

import { creditUrl, type SectionCredit } from "@/lib/sectioned/model";
import { cn } from "@/lib/utils";

export function SectionCreditLine({
  credit,
  className,
}: {
  credit: SectionCredit | undefined;
  className?: string;
}) {
  const text = credit?.text.replace(/\s+/g, " ").trim();
  if (!credit || !text) return null;
  const url = creditUrl(credit);
  const licence = credit.licence?.replace(/\s+/g, " ").trim();
  return (
    <p className={cn("text-xs text-sub", className)}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-text"
        >
          {text}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        text
      )}
      {licence ? ` (${licence})` : null}
    </p>
  );
}
