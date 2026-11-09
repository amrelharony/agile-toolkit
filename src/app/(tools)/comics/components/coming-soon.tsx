"use client";

import Link from "next/link";
import { ArrowLeft, BookImage } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { COMICS_ROUTE } from "@/lib/comics/entry";
import { comicsArt } from "@/lib/ink/drawings/pages/comics";

/**
 * A number that isn't released, or doesn't exist. It takes no story on purpose,
 * so a page for an unreleased number has no title or art it could give away.
 */
export function ComingSoon() {
  return (
    <ToolPageWrapper
      art={comicsArt}
      title="Agile at Work"
      description="Workplace comics by Amr Elharony"
    >
      <EmptyState
        icon={BookImage}
        padding="lg"
        action={
          <Button asChild variant="toolkit">
            <Link href={COMICS_ROUTE} prefetch={false}>
              <ArrowLeft aria-hidden="true" />
              See all comics
            </Link>
          </Button>
        }
      >
        <p className="font-semibold text-text">This comic is coming soon</p>
      </EmptyState>
    </ToolPageWrapper>
  );
}
