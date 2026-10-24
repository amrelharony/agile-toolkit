import { NextResponse, type NextRequest } from "next/server";
import {
  VIP_COOKIE,
  VIP_COOKIE_MAX_AGE,
  VIP_COOKIE_PATH,
  VIP_ROUTE,
  isVipKey,
  normalizeVipKey,
} from "@/lib/vip/book-access";

export const dynamic = "force-dynamic";

/**
 * The link printed in the book: /vip/<key>.
 *
 * A valid key is remembered in an httpOnly cookie on this device, then the
 * visitor lands on /vip, so the key never stays in the address bar, the
 * history or a screenshot of the page. An unknown key lands on the same page
 * with `?link=invalid`, which explains what went wrong. Either way the
 * redirect carries no Referer and is never cached.
 */
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const valid = await isVipKey(params.key);

  const target = request.nextUrl.clone();
  target.pathname = VIP_ROUTE;
  target.search = "";
  if (!valid) target.searchParams.set("link", "invalid");

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (valid) {
    response.cookies.set({
      name: VIP_COOKIE,
      value: normalizeVipKey(params.key) ?? "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: VIP_COOKIE_PATH,
      maxAge: VIP_COOKIE_MAX_AGE,
    });
  }
  return response;
}
