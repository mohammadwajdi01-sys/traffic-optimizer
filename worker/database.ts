import { ApiError, serverKey, type Env } from "./env";
import { verifyGuestSession } from "./guest";
export async function db(
  env: Env,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    service?: boolean;
    ignoreDuplicates?:boolean;
  } = {},
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new ApiError(503, "Accounts are not configured yet.");
  const key = options.service ? serverKey(env) : env.SUPABASE_PUBLISHABLE_KEY;
  if (!key)
    throw new ApiError(503, "Database administration is not configured yet.");
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: path.includes("on_conflict")
      ? `return=representation,resolution=${options.ignoreDuplicates?"ignore-duplicates":"merge-duplicates"}`
      : "return=representation",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  else if (options.service && key.startsWith("eyJ"))
    headers.Authorization = `Bearer ${key}`;
  // Modern sb_secret keys use apikey only; legacy service_role JWTs also need Bearer.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok)
    throw new ApiError(
      res.status === 403 ? 403 : 502,
      "The database could not complete this request.",
    );
  return res.status === 204 ? null : res.json();
}
export type Identity = {
  id: string;
  role: "guest" | "user" | "family" | "admin";
  token?: string;
};
export async function identity(
  request: Request,
  env: Env,
  requireUser = false,
): Promise<Identity> {
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (token) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
      throw new ApiError(503, "Accounts are not configured yet.");
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
      throw new ApiError(401, "Your session expired. Sign in again.");
    const user = (await res.json()) as { id: string };
    const admin = (env.ADMIN_USER_IDS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(user.id);
    const profiles = (await db(
      env,
      `profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
      { token },
    )) as { role: string }[];
    return {
      id: user.id,
      role: admin
        ? "admin"
        : profiles[0]?.role === "family"
          ? "family"
          : "user",
      token,
    };
  }
  if (requireUser || env.PUBLIC_BETA !== "true")
    throw new ApiError(401, "Sign in to plan a journey.");
  if (!env.TURNSTILE_SECRET_KEY || !env.GUEST_SESSION_SECRET)
    throw new ApiError(503, "Public access has not been enabled securely.");
  return { id: await verifyGuestSession(request, env), role: "guest" };
}
