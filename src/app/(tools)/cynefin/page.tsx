import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CynefinClient } from "./cynefin-client";

export const metadata: Metadata = toolMetadata("cynefin");

export default function Page() {
  return <CynefinClient />;
}
