import type { Metadata } from "next";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import { BOOK_EPISODES } from "@/lib/comics/book-episodes";
import { isBookEp, parseEp } from "@/lib/comics/entry";
import { hasVipAccess } from "@/lib/vip/access";
import { VIP_DESCRIPTION, VIP_TITLE } from "@/lib/vip/constants";
import { SquadSessionLoader } from "./loader";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: VIP_TITLE,
  description: VIP_DESCRIPTION,
  robots: { index: false, follow: false },
};

/**
 * Pick an episode with ?ep=NN. The episode list, like the tool's code, only
 * reaches a device with access: as props here, and through a loader a locked page
 * never renders.
 */
export default async function SquadSessionPage({
  searchParams,
}: {
  searchParams: { ep?: string | string[] };
}) {
  if (!(await hasVipAccess())) return <VipLockPanel />;
  const parsed = parseEp(searchParams.ep);
  const ep = parsed !== null && isBookEp(parsed) ? parsed : null;
  return <SquadSessionLoader episodes={BOOK_EPISODES} ep={ep} />;
}
