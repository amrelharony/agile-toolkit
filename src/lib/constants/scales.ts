export interface EstimationScale {
  name: string;
  values: (string | number)[];
}

export const scales: EstimationScale[] = [
  { name: "Fibonacci", values: [1, 2, 3, 5, 8, 13, 21] },
  { name: "T-Shirt", values: ["XS", "S", "M", "L", "XL", "XXL"] },
  { name: "Powers of 2", values: [1, 2, 4, 8, 16, 32] },
  { name: "Linear", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
];

export const defaultDescriptions: Record<string, string> = {
  "1": "Trivial change. Well-understood, minimal risk. A few lines of code.",
  "2": "Simple task. Clear approach, low risk. A few hours of work.",
  "3": "Moderate task. Some complexity, well-understood domain.",
  "5": "Complex task. Multiple components, some unknowns.",
  "8": "Very complex. Significant unknowns, cross-cutting concerns.",
  "13": "Highly complex. Major unknowns, needs spike or breakdown.",
  "21": "Epic-level. Too large for a single sprint. Must be split.",
  "XS": "Trivial. Minutes to complete.",
  "S": "Small. A few hours.",
  "M": "Medium. About a day.",
  "L": "Large. Multiple days.",
  "XL": "Very large. Most of a sprint.",
  "XXL": "Too large. Needs decomposition.",
};
