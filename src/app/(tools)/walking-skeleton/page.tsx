import type { Metadata } from "next";
import { WalkingSkeletonClient } from "./walking-skeleton-client";

export const metadata: Metadata = {
  title: "Walking Skeleton Builder",
  description:
    "Define the smallest end-to-end implementation that proves the architecture works (Cockburn).",
};

export default function Page() {
  return <WalkingSkeletonClient />;
}
