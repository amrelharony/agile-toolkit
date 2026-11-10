/**
 * Who runs the site and how to reach him, in one place: the sidebar, the
 * privacy page (/privacy) and /.well-known/security.txt all read it, so they
 * can't name different people or addresses. No imports: safe on the server,
 * in the browser and in a route handler.
 */

/** Mirrors `metadataBase` in src/app/layout.tsx. */
const SITE_URL = "https://agile.amrelharony.com";

/** The site's owner, as the sidebar and the site's metadata name him. */
export const SITE_OWNER = {
  name: "Amr El Harony",
  url: "https://amrelharony.com",
} as const;

/**
 * The one public contact address: privacy questions, removal requests,
 * accessibility problems and security reports all go here. Change it here and
 * the privacy page and security.txt follow.
 */
export const CONTACT_EMAIL = "a.elharony@gmail.com";

/** RFC 9116 wants an end date; renew it before then. */
const SECURITY_TXT_EXPIRES = "2027-05-23T00:00:00.000Z";

/** /.well-known/security.txt (RFC 9116): where to report a security problem. */
export function securityTxt(): string {
  return [
    `Contact: mailto:${CONTACT_EMAIL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_URL}/.well-known/security.txt`,
    "",
  ].join("\n");
}
