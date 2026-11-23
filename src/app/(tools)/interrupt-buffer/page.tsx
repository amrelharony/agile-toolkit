import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { InterruptBufferClient } from "./interrupt-buffer-client";

export const metadata: Metadata = toolMetadata("interrupt-buffer");

export default function Page() {
  return <InterruptBufferClient />;
}
