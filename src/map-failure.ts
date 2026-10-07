import { ApiFailure } from "./api";

export type MapFailure = "session" | "access" | "allowance" | "setup" | "browser" | "network";

// Never display a provider error verbatim: it can contain a token or request URL.
export function mapFailure(error: unknown): MapFailure {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  if (status === 401) return error instanceof ApiFailure ? "session" : "access";
  if (status === 403) return "access";
  if (status === 429) return "allowance";
  if (error instanceof ApiFailure && status === 503 && /map is not configured/i.test(error.message)) return "setup";
  if (error instanceof Error && /webgl|graphics context|context lost/i.test(error.message)) return "browser";
  return "network";
}
