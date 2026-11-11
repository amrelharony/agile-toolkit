import Link from "@/components/motion/transition-link";
import { ArrowLeft, BookOpen, KeyRound } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { BOOK_PATH } from "@/lib/book/book";
import { VIP_TITLE } from "@/lib/vip/constants";
import { vipArt } from "@/lib/ink/drawings/sections/vip";

/**
 * What a VIP address shows without access. It takes no props on purpose, so it
 * can't carry a title, a count, art or any tool's text: all a locked visitor
 * learns is how to get in. Every VIP page renders this before reading anything.
 */
export function VipLockPanel() {
  return (
    <ToolPageWrapper art={vipArt} title={VIP_TITLE} description="For readers of the printed book.">
      <VipLockedMessage />
    </ToolPageWrapper>
  );
}

/** How to get in, shared with the /vip page itself. */
export function VipLockedMessage({ invalidLink = false }: { invalidLink?: boolean }) {
  return (
    <EmptyState
      icon={KeyRound}
      padding="xl"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="toolkit" className="min-h-11 md:h-11">
            <Link href={BOOK_PATH}>
              <BookOpen aria-hidden="true" />
              About the book
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11 md:h-11">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Back to tools
            </Link>
          </Button>
        </div>
      }
    >
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
