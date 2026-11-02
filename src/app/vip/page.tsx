import type { Metadata } from "next";
import { listEarlyWeekly } from "@/lib/comics/store";
import type { StorySummary } from "@/lib/comics/types";
import { hasVipAccess } from "@/lib/vip/access";
import { VIP_DESCRIPTION, VIP_TITLE } from "@/lib/vip/constants";
import { VipClient, type VipAccess } from "./vip-client";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: VIP_TITLE,
  description: VIP_DESCRIPTION,
  robots: { index: false, follow: false },
};

/** The tools still work during a Supabase outage, so the hub shouldn't fail with the comics. */
async function earlyComics(): Promise<StorySummary[]> {
  try {
    return await listEarlyWeekly();
  } catch (err) {
    console.warn("[vip] couldn't read the early comics:", err);
    return [];
  }
}

/**
 * /vip — where the link printed in the book lands. The link (./[key]/route.ts)
 * sets the cookie checked here; without it the visitor is told how to get in, and
 * no story is read at all.
 */
export default async function VipPage({
  searchParams,
}: {
  searchParams: { link?: string | string[] };
}) {
  const unlocked = await hasVipAccess();
  const access: VipAccess = unlocked
    ? "unlocked"
    : searchParams.link === "invalid"
      ? "invalid-link"
      : "locked";
  return <VipClient access={access} earlyComics={unlocked ? await earlyComics() : []} />;
}
