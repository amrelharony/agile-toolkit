import { StakeholderMapClient } from "./stakeholder-map-client";

export const metadata = {
  title: "Stakeholder Map",
  description: "Interest × Authority matrix with engagement strategy per quadrant.",
};

export default function Page() {
  return <StakeholderMapClient />;
}
