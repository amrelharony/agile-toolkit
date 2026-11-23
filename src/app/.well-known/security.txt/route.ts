import { securityTxt } from "@/lib/site/owner";

/**
 * /.well-known/security.txt: where to report a security problem. Built from
 * the same contact address the privacy page shows (lib/site/owner.ts), so the
 * two can't drift. It was a file in /public; a route and a public file can't
 * share an address, so that file is gone. Built once with the site, and the
 * middleware's matcher leaves /.well-known/ alone.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(securityTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
