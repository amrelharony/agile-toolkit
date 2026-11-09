import type { Metadata } from "next";
import { Smile } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { VipLockPanel } from "@/components/vip/vip-lock-panel";
import { hasVipAccess } from "@/lib/vip/access";
import { CAST } from "@/lib/vip/cast.generated";
import { VIP_DESCRIPTION, VIP_TITLE } from "@/lib/vip/constants";
import {
  WHICH_COLLEAGUE_APPROVED,
  WHICH_COLLEAGUE_GAME,
} from "@/lib/vip/which-colleague-questions";
import { WhichColleagueLoader } from "./loader";
import { balloonArt } from "@/lib/ink/drawings/pages/balloon";

// Reads the access cookie, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: VIP_TITLE,
  description: VIP_DESCRIPTION,
  robots: { index: false, follow: false },
};

/**
 * Locked: the lock panel. Unlocked but not yet approved by the owner: "coming
 * soon", with no question text. Only an approved, unlocked page sends the game.
 */
export default async function WhichColleaguePage() {
  if (!(await hasVipAccess())) return <VipLockPanel />;
  if (!WHICH_COLLEAGUE_APPROVED) {
    return (
      <ToolPageWrapper
        art={balloonArt}
        title="Coming soon"
        description="For readers of the printed book."
      >
        <EmptyState icon={Smile} padding="xl">
          <p className="font-semibold text-text">This one is coming soon</p>
        </EmptyState>
      </ToolPageWrapper>
    );
  }
  return <WhichColleagueLoader game={WHICH_COLLEAGUE_GAME} cast={CAST} />;
}
