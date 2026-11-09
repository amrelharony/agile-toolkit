import type { Metadata } from "next";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { Card, CardContent } from "@/components/ui/card";
import { LICENSE_PATH } from "@/lib/comics/rights";
import { comicMetadata } from "../comic-metadata";
import { LicenceForm } from "./licence-form";
import { scrollArt } from "@/lib/ink/drawings/pages/scroll";

export const metadata: Metadata = comicMetadata({
  title: "Comic licence — Agile at Work",
  description:
    "Individuals can read and share the comics for free. Companies need a licence for intranets, training, slides, newsletters and printed copies.",
  canonical: LICENSE_PATH,
});

/*
 * OWNER APPROVAL NEEDED. Everything in TERMS is a plain-language draft written
 * from the comics plan, not legal advice. The owner must approve this wording,
 * ideally after a lawyer has read it, before companies start relying on it.
 */
const TERMS = [
  {
    who: "Individuals",
    what: "Read the comics and share the link with anyone. It's free.",
  },
  {
    who: "Companies",
    what: "Intranets, training, slides, newsletters and printed copies need a licence.",
  },
  {
    who: "Everyone",
    what: "Use the comics as they are: no editing or cropping.",
  },
];

export default function ComicLicensePage() {
  return (
    <ToolPageWrapper
      art={scrollArt}
      title="Comic licence"
      description="How you can use the Agile at Work comics"
    >
      <div className="max-w-2xl space-y-6">
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <dl className="space-y-3">
              {TERMS.map((term) => (
                <div key={term.who}>
                  <dt className="font-semibold text-text">{term.who}</dt>
                  <dd className="mt-1 text-sub">{term.what}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sub">
              This licence covers the comic only. The tools on this site stay free.
            </p>
            <p className="text-sm text-sub">
              © Amr Elharony. The comics are the private property of this website.
            </p>
          </CardContent>
        </Card>

        <section aria-labelledby="licence-request-heading" className="space-y-3">
          <h2 id="licence-request-heading" className="font-display text-lg font-semibold text-text">
            Ask for a licence
          </h2>
          <p className="text-sub">
            Tell us what you have in mind, and we&apos;ll agree the terms and payment with you
            directly.
          </p>
          <LicenceForm />
        </section>
      </div>
    </ToolPageWrapper>
  );
}
