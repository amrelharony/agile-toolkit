import path from "node:path";
import type { NextRequest } from "next/server";
import { COLOR_EDITION_COOKIE, isColorEditionKey } from "@/lib/comic/color-edition-access";
import { servePdf } from "@/lib/comic/serve-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The colour edition's PDF. Kept out of public/ (the CDN would hand that to
 * anyone) and bundled into this function instead: next.config.mjs adds it to
 * the route's file trace. The middleware matcher skips this path, as it does
 * the public comic, so pdf.js's range requests don't each cost the owner a
 * session check; the cookie check here is the gate.
 */
const COLOR_PDF_FILE = path.join(process.cwd(), "private", "comics", "agile-at-work-color.pdf");

const NO_INDEX = "noindex, nofollow";

export async function GET(request: NextRequest) {
  if (!(await isColorEditionKey(request.cookies.get(COLOR_EDITION_COOKIE)?.value))) {
    return new Response("Scan the QR code in your printed copy to read the colour edition.", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": NO_INDEX,
      },
    });
  }
  return servePdf(COLOR_PDF_FILE, request.headers.get("range"), {
    // `private`: a shared cache must never answer for the cookie check. The
    // reader's `?v=<hash>` URL changes whenever the file does.
    "Cache-Control": "private, max-age=86400",
    "Content-Disposition": 'inline; filename="Agile-at-Work-Colour.pdf"',
    "X-Robots-Tag": NO_INDEX,
  });
}
