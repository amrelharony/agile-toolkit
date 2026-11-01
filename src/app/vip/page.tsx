import type { Metadata } from "next";
import { cookies } from "next/headers";
import { VIP_COOKIE, isVipKey } from "@/lib/vip/book-access";
import { VIP_TITLE } from "@/lib/vip/constants";
import { VipClient, type VipAccess } from "./vip-client";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: VIP_TITLE,
  description: "VIP access to the Agile Toolkit for readers of the printed book.",
  robots: { index: false, follow: false },
};

/**
 * /vip — where the link printed in the book lands. The link (./[key]/route.ts)
 * sets the cookie checked here; without it the visitor is told how to get in.
 */
export default async function VipPage({
  searchParams,
}: {
  searchParams: { link?: string | string[] };
}) {
  const unlocked = await isVipKey(cookies().get(VIP_COOKIE)?.value);
  const access: VipAccess = unlocked
    ? "unlocked"
    : searchParams.link === "invalid"
      ? "invalid-link"
      : "locked";
  return <VipClient access={access} />;
}
