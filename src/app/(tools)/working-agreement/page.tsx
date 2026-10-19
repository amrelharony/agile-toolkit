import { WorkingAgreementClient } from "./working-agreement-client";

export const metadata = {
  title: "Working Agreement Builder",
  description:
    "Team charter wizard for norms, communication, and decision rules with adoption check-ins.",
};

export default function Page() {
  return <WorkingAgreementClient />;
}
