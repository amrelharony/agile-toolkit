import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { ValueEffortMatrixClient } from "./value-effort-matrix-client";

export const metadata: Metadata = toolMetadata("value-effort-matrix");

export default function Page() {
  return <ValueEffortMatrixClient />;
}
