import { PlatformMaturityClient } from "./platform-maturity-client";

export const metadata = {
  title: "Platform Engineering Maturity — Agile Toolkit",
  description:
    "Self-assess platform engineering across golden paths, IDP, runbook hygiene, on-call, and more.",
};

export default function Page() {
  return <PlatformMaturityClient />;
}
