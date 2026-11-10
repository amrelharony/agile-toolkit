import type { Metadata } from "next";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { keyArt } from "@/lib/ink/drawings/pages/key";
import { TOOLS_STAY_FREE } from "@/lib/site/disclosures";
import { CONTACT_EMAIL, PRIVACY_TITLE, SITE_OWNER } from "@/lib/site/owner";
import {
  NO_ACCOUNT_LINE,
  REACH_LABEL,
  RETENTION_LINE,
  accessibilityLines,
  otherProcessors,
  privacyRows,
  processors,
  securityChecks,
  securityHosts,
  type PrivacyItem,
} from "@/lib/site/privacy";

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description:
    "What the Agile Toolkit sends from your browser and what it keeps, part by part. Who runs it, how to get in touch, and what a security team can check in two minutes.",
};

// Built once with the site: it reads the tool registry, the security policy
// and build-time settings, never a request.
export const dynamic = "force-static";

const H2 = "font-display text-lg font-semibold text-text";

/*
 * Both tables are real tables, so one pasted into an email stays a table. Below
 * md each row stacks: a cell becomes a block, the header row is kept for
 * screen readers only, and each cell shows its column's name above it. A table
 * element that is displayed as a block loses its table meaning in some
 * browsers, so every part carries its role.
 */
const TABLE = "block w-full border-collapse text-left text-sm md:table";
const THEAD = "max-md:sr-only md:table-header-group";
const TBODY = "block md:table-row-group";
const TR = "block border-t border-rule px-4 py-4 max-md:first:border-t-0 md:table-row md:p-0";
const TH_COL = "px-4 py-3 align-bottom text-xs font-semibold text-sub";
const TH_ROW = "block font-semibold text-text md:table-cell md:px-4 md:py-4 md:align-top";
const TD = "mt-3 block md:mt-0 md:table-cell md:px-4 md:py-4 md:align-top";

/** A column's name above its cell, for the stacked rows. The header row names it for screen readers. */
function CellLabel({ children }: { children: string }) {
  return (
    <Eyebrow aria-hidden="true" className="mb-1 md:hidden">
      {children}
    </Eyebrow>
  );
}

/** What one cell says: plain sentences, and the site's own words as quotes. */
function Items({ items }: { items: PrivacyItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) =>
        item.says ? (
          <figure key={item.text} className="border-l-2 border-rule pl-3">
            <figcaption className="text-xs font-semibold text-sub">{item.says}</figcaption>
            <blockquote className="mt-1 text-text">{item.text}</blockquote>
          </figure>
        ) : (
          <p key={item.text} className="text-text">
            {item.text}
          </p>
        )
      )}
    </div>
  );
}

/**
 * /privacy: what leaves a visitor's browser, part by part; who runs the site
 * and how to get in touch; who processes what; that the tools stay free; how
 * accessibility is tested; and what a security team can check. /about and
 * /contact redirect here (next.config.mjs).
 *
 * Every fact is lib/site/privacy.ts's, which takes its wording from what the
 * site already tells people (lib/site/disclosures.ts) and its numbers from
 * where they are set. The page adds no tracking of its own.
 */
export default function PrivacyPage() {
  const rows = privacyRows();
  return (
    <ToolPageWrapper
      art={keyArt}
      title={PRIVACY_TITLE}
      description="What this site sends, where it goes and what is kept. Who runs it, and how to get in touch."
    >
      <div className="max-w-4xl space-y-8">
        <section aria-labelledby="parts-heading" className="space-y-3">
          <h2 id="parts-heading" className={H2}>
            Part by part
          </h2>
          <p className="max-w-prose text-sub">
            Every tool works without an account. Each row is one part of the site: what your browser
            sends when you use it, and what is kept afterwards. Where the site already tells you
            this at the time, the row quotes those words.
          </p>
          <Card>
            <table role="table" className={TABLE}>
              <caption className="sr-only">
                What leaves your browser and what is kept, for each part of the site
              </caption>
              <thead role="rowgroup" className={THEAD}>
                <tr role="row">
                  <th role="columnheader" scope="col" className={`${TH_COL} md:w-48`}>
                    Part of the site
                  </th>
                  <th role="columnheader" scope="col" className={TH_COL}>
                    What leaves your browser
                  </th>
                  <th role="columnheader" scope="col" className={`${TH_COL} md:w-[36%]`}>
                    What is kept
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={TBODY}>
                {rows.map((row) => (
                  <tr key={row.id} role="row" data-row={row.id} className={TR}>
                    <th role="rowheader" scope="row" className={TH_ROW}>
                      {row.part}
                      <span className="mt-1 block text-xs font-normal text-sub">{row.when}</span>
                    </th>
                    <td role="cell" className={TD}>
                      <CellLabel>What leaves your browser</CellLabel>
                      <Items items={row.leaves} />
                    </td>
                    <td role="cell" className={TD}>
                      <CellLabel>What is kept</CellLabel>
                      <Items items={row.kept} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        <section id="contact" aria-labelledby="contact-heading" className="space-y-3">
          <h2 id="contact-heading" className={H2}>
            Who runs this site, and how to get in touch
          </h2>
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <p className="text-text">
                The Agile Toolkit is built and run by{" "}
                <a
                  href={SITE_OWNER.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  {SITE_OWNER.name}
                </a>
                .
              </p>
              <p className="text-sub">
                Write about privacy, a removal, an accessibility problem or a security report:
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {/* Plain text, not a link: one click selects it all, ready to copy. */}
                <span
                  data-contact-address=""
                  className="select-all break-all font-mono text-base text-text"
                >
                  {CONTACT_EMAIL}
                </span>
                <CopyButton text={CONTACT_EMAIL} label="Copy address" />
              </div>
              <p className="text-sub">
                {RETENTION_LINE} To have yours removed, write to the address above.
              </p>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="processors-heading" className="space-y-3">
          <h2 id="processors-heading" className={H2}>
            Who processes what, and where
          </h2>
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <dl className="space-y-3">
                {processors().map((processor) => (
                  <div key={processor.name}>
                    <dt className="font-semibold text-text">{processor.name}</dt>
                    <dd className="mt-1 text-sub">{processor.does}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sub">{otherProcessors()}</p>
            </CardContent>
          </Card>
        </section>

        <section id="accessibility" aria-labelledby="free-heading" className="space-y-3">
          <h2 id="free-heading" className={H2}>
            Free, and tested for accessibility
          </h2>
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <p className="text-text">{TOOLS_STAY_FREE}</p>
              <dl className="space-y-3">
                {accessibilityLines().map((line) => (
                  <div key={line.label}>
                    <dt className="font-semibold text-text">{line.label}</dt>
                    <dd className="mt-1 text-sub">{line.text}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </section>

        <section id="security" aria-labelledby="security-heading" className="space-y-3">
          <h2 id="security-heading" className={H2}>
            For your security team
          </h2>
          <p className="max-w-prose text-sub">Four things you can check in two minutes.</p>
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <ol className="list-decimal space-y-3 pl-5">
                {securityChecks().map((check) => (
                  <li key={check.label} className="text-sub">
                    <span className="font-semibold text-text">{check.label}.</span> {check.text}
                  </li>
                ))}
              </ol>
              <p className="text-text">{NO_ACCOUNT_LINE}</p>
            </CardContent>
          </Card>

          <h3 id="hosts-heading" className="pt-2 font-display text-base font-semibold text-text">
            Every outside host the security policy allows
          </h3>
          <p className="max-w-prose text-sub">
            The Content-Security-Policy header names every host a page may contact. This list is
            built from the same file as the header, so it is the whole of it.
          </p>
          <Card>
            <table role="table" aria-labelledby="hosts-heading" className={TABLE}>
              <thead role="rowgroup" className={THEAD}>
                <tr role="row">
                  <th role="columnheader" scope="col" className={TH_COL}>
                    Host
                  </th>
                  <th role="columnheader" scope="col" className={`${TH_COL} md:w-44`}>
                    Whose it is
                  </th>
                  <th role="columnheader" scope="col" className={`${TH_COL} md:w-[42%]`}>
                    When it is used
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className={TBODY}>
                {securityHosts().map((host) => (
                  <tr key={host.source} role="row" data-host={host.source} className={TR}>
                    <th role="rowheader" scope="row" className={TH_ROW}>
                      <span className="break-all font-mono text-xs">{host.source}</span>
                      <span className="mt-1 block font-mono text-xs font-normal text-sub">
                        {host.directives.join(", ")}
                      </span>
                    </th>
                    <td role="cell" className={TD}>
                      <CellLabel>Whose it is</CellLabel>
                      <p className="text-text">{host.who}</p>
                      <p className="text-xs font-semibold text-sub">{REACH_LABEL[host.reach]}</p>
                    </td>
                    <td role="cell" className={TD}>
                      <CellLabel>When it is used</CellLabel>
                      <p className="text-text">{host.when}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </ToolPageWrapper>
  );
}
