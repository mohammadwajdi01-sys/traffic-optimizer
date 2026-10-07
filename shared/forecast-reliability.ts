import type { Plan } from "./types";

// A reported discrepancy remains unresolved. Provider coverage is not validation.
export function recommendationAllowed(plan: Plan) {
  return ![plan.origin.countryCode, plan.destination.countryCode].some(code => code?.toUpperCase() === "LY")
    && ![plan.timezone, plan.origin.timezone, plan.destination.timezone].includes("Africa/Tripoli");
}
