import type { Metadata } from "next";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import { hasVipAccess } from "@/lib/vip/access";
import { CAST } from "@/lib/vip/cast.generated";
import { VIP_DESCRIPTION, VIP_TITLE } from "@/lib/vip/constants";
import { MeetTheCastLoader } from "./loader";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: VIP_TITLE,
  description: VIP_DESCRIPTION,
  robots: { index: false, follow: false },
};

/**
 * The cards reach the browser as props on this response alone, and the loader
 * only fetches the tool's code once it renders, which a locked visitor's page
 * never does.
 */
export default async function MeetTheCastPage() {
  if (!(await hasVipAccess())) return <VipLockPanel />;
  return <MeetTheCastLoader cast={CAST} />;
}
