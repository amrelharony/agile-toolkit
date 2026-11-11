import Link from "@/components/motion/transition-link";
import { PRIVACY_PATH, PRIVACY_TITLE } from "@/lib/site/owner";

/**
 * One line under a form that keeps what people type: what is kept and for how
 * long (`note`, from lib/site/disclosures.ts), then a link to the privacy page.
 * The link sits in a sentence, so it keeps the inline touch exception.
 */
export function FormPrivacyNote({ note }: { note: string }) {
  return (
    <p data-privacy-note="" className="text-xs text-sub">
      {note} More in <Link href={PRIVACY_PATH}>{PRIVACY_TITLE}</Link>.
    </p>
  );
}
