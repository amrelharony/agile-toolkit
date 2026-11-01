"use client";

import Link from "next/link";
import { ArrowLeft, Crown, KeyRound } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { VIP_TITLE } from "@/lib/vip/constants";

export type VipAccess = "unlocked" | "locked" | "invalid-link";

/**
 * VIP landing shell. The server page decided access from the cookie; this
 * only renders the outcome. What VIP readers get is still to come, so an
 * unlocked device sees a welcome that says its access is already saved.
 */
export function VipClient({ access }: { access: VipAccess }) {
  const unlocked = access === "unlocked";

  return (
    <ToolPageWrapper
      title={VIP_TITLE}
      description={
        unlocked
          ? "Welcome, reader of the book. This device has VIP access."
          : "For readers of the printed book."
      }
    >
      {unlocked ? <VipWelcome /> : <VipLocked invalidLink={access === "invalid-link"} />}
    </ToolPageWrapper>
  );
}

function BackToTools() {
  return (
    <Button asChild variant="toolkit" className="min-h-11 md:h-11">
      <Link href="/">
        <ArrowLeft aria-hidden="true" />
        Back to tools
      </Link>
    </Button>
  );
}

function VipLocked({ invalidLink }: { invalidLink: boolean }) {
  return (
    <EmptyState icon={KeyRound} padding="xl" action={<BackToTools />}>
      {invalidLink ? (
        <>
          <p className="font-semibold text-text">That link didn&apos;t open VIP access</p>
          <p className="mt-1">
            Scan the QR code in your copy of the book again, or check that the whole link was
            copied.
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold text-text">VIP access comes with the printed book</p>
          <p className="mt-1">
            Scan the QR code in your copy of the book, or type in the link printed next to it. This
            device will remember it after that.
          </p>
        </>
      )}
    </EmptyState>
  );
}

function VipWelcome() {
  return (
    <EmptyState icon={Crown} padding="xl" action={<BackToTools />}>
      <p className="font-semibold text-text">You&apos;re in</p>
      <p className="mt-1">
        VIP tools for readers of the book are on their way and will appear here. This device is
        already unlocked, so there&apos;s no need to scan again.
      </p>
    </EmptyState>
  );
}
