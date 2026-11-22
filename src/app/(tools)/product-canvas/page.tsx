import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ProductCanvasClient } from "./product-canvas-client";

export const metadata: Metadata = toolMetadata("product-canvas");

export default function Page() {
  return <ProductCanvasClient />;
}
