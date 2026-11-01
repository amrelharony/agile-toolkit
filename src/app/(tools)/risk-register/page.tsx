import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { RiskRegisterClient } from "./risk-register-client";

export const metadata: Metadata = toolMetadata("risk-register");

export default function Page() {
  return <RiskRegisterClient />;
}
