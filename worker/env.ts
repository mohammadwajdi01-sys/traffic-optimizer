export interface Env {
  ASSETS: Fetcher;
  BUDGET: DurableObjectNamespace;
  APP_MODE?: string;
  PUBLIC_BETA?: string;
  PRIVATE_ACCESS_REQUIRED?: string;
  PRIVATE_ACCESS_CREDENTIALS?: string;
  GOOGLE_ENABLED?: string;
  GOOGLE_AUTH_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAPBOX_PUBLIC_TOKEN?: string;
  MAPBOX_SERVER_TOKEN?: string;
  GEOAPIFY_API_KEY?: string;
  GOOGLE_ROUTES_API_KEY?: string;
  ADMIN_USER_IDS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  GUEST_SESSION_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
export function serverKey(env: Env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ledger(env: Env) {
  return env.BUDGET.get(env.BUDGET.idFromName("global-v1"));
}
export async function budget(env: Env, path: string, data: unknown = {}) {
  const r = await ledger(env).fetch(`https://ledger${path}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  const body = (await r.json()) as Record<string, any>;
  if (!r.ok)
    throw new ApiError(r.status, String(body.error ?? "Usage limit reached."));
  return body;
}
