import Link from "next/link";
import { PRIVACY_PATH, PRIVACY_TITLE } from "@/lib/site/owner";

/**
 * One line under a form that keeps what people type: what is kept and for how
 * long (`note`, from lib/site/disclosures.ts), then a link to the privacy page.
 * The link sits in a sentence, so it keeps the inline touch exception.
 *
 * Without a `note` it is the link's sentence alone, for a card whose own
 * points already say what is kept (the one before Amr's AI). `onNavigate`
 * runs as the link is followed, so a panel or dialog it sits in can close.
 */
export function FormPrivacyNote({ note, onNavigate }: { note?: string; onNavigate?: () => void }) {
  return (
    <p data-privacy-note="" className="text-xs text-sub">
      {note && `${note} `}More in{" "}
      <Link href={PRIVACY_PATH} onClick={onNavigate}>
        {PRIVACY_TITLE}
      </Link>
      .
    </p>
  );
}
