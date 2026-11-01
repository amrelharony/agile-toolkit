"use client";

import { BookImage } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

/** A book episode before its art is imported: the text is all there is so far. */
export function ArtComingSoon() {
  return (
    <EmptyState icon={BookImage} padding="lg">
      <p className="font-semibold text-text">The comic will appear here soon</p>
    </EmptyState>
  );
}
