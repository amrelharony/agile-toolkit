import { PiPlanningClient } from "./pi-planning-client";

export const metadata = {
  title: "PI Planning Board — Agile Toolkit",
  description: "SAFe Program Increment board with teams × iterations, dependencies, and capacity forecasting.",
};

export default function Page() {
  return <PiPlanningClient />;
}
