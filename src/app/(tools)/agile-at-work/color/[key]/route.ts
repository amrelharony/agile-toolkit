import { NextResponse, type NextRequest } from "next/server";
import { COLOR_EDITION_ROUTE } from "@/lib/comic/agile-at-work";
import {
  COLOR_EDITION_COOKIE,
  COLOR_EDITION_COOKIE_MAX_AGE,
  COLOR_EDITION_COOKIE_PATH,
  isColorEditionKey,
  normalizeColorEditionKey,
} from "@/lib/comic/color-edition-access";

export const dynamic = "force-dynamic";

/**
 * The link printed as a QR code in the book: /agile-at-work/color/<key>.
 *
 * A valid key is remembered in an httpOnly cookie on this device, then the
 * visitor lands on the colour reader, so the key never stays in the address
 * bar, the history or a screenshot of the page. An unknown key lands on the
 * same page with `?link=invalid`, which explains what went wrong. Either way
 * the redirect carries no Referer and is never cached.
 */
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const valid = await isColorEditionKey(params.key);

  const target = request.nextUrl.clone();
  target.pathname = COLOR_EDITION_ROUTE;
  target.search = "";
  if (!valid) target.searchParams.set("link", "invalid");

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (valid) {
    response.cookies.set({
      name: COLOR_EDITION_COOKIE,
      value: normalizeColorEditionKey(params.key) ?? "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: COLOR_EDITION_COOKIE_PATH,
      maxAge: COLOR_EDITION_COOKIE_MAX_AGE,
    });
  }
  return response;
}
