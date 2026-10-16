import { RiskRegisterClient } from "./risk-register-client";

export const metadata = {
  title: "Risk Register",
  description: "Probability × Impact risk register with mitigation tracking and risk burn-down.",
};

export default function Page() {
  return <RiskRegisterClient />;
}
