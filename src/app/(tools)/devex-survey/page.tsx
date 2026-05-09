import { DevexSurveyClient } from "./devex-survey-client";

export const metadata = {
  title: "DevEx Survey — Agile Toolkit",
  description:
    "Lightweight developer-experience survey covering flow state, feedback loops, and cognitive load.",
};

export default function Page() {
  return <DevexSurveyClient />;
}
