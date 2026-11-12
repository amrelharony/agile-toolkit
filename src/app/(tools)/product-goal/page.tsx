import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ProductGoalClient } from "./product-goal-client";

export const metadata: Metadata = toolMetadata("product-goal");

export default function Page() {
  return <ProductGoalClient />;
}
