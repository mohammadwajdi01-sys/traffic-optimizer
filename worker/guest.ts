import { ApiError, type Env } from "./env";
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode(s: string) {
  return Uint8Array.from(
    atob(
      s
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(s.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
}
async function key(env: Env) {
  if (!env.GUEST_SESSION_SECRET)
    throw new ApiError(503, "Guest access is not configured.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GUEST_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
function payload(env: Env, ip: string, exp: number) {
  return new TextEncoder().encode(`${ip}:${exp}`);
}
export async function createGuestSession(env: Env, ip: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(env),
    payload(env, ip, exp),
  );
  return `${exp}.${encode(new Uint8Array(signature))}`;
}
export async function verifyGuestSession(request: Request, env: Env) {
  const ip = request.headers.get("CF-Connecting-IP");
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|; )traffic_guest=([^;]+)/)?.[1];
  if (!ip || !token)
    throw new ApiError(
      401,
      "Complete the verification or sign in to continue.",
    );
  const [expires, signature] = token.split("."),
    exp = Number(expires);
  if (
    !Number.isInteger(exp) ||
    exp < Date.now() / 1000 ||
    exp > Date.now() / 1000 + 3600
  )
    throw new ApiError(401, "Verify again to continue.");
  try {
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(env),
        decode(signature),
        payload(env, ip, exp),
      ))
    )
      throw new Error();
  } catch {
    throw new ApiError(401, "Verify again to continue.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${env.GUEST_SESSION_SECRET}:${ip}`),
  );
  return "guest-" + encode(new Uint8Array(digest));
}
