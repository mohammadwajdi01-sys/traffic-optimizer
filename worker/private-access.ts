import { ApiError, budget, type Env } from "./env";
import { gateHeaders, gateLanguage, gatePage, safeGatePath } from "./private-view";

const COOKIE = "__Host-traffic_private", HOURS = 12, REMEMBER_HOURS = 168, ITERATIONS = 100000;
const encode = (s: string) => new TextEncoder().encode(s);
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
const bytes = (s: string) => Uint8Array.from(s.match(/.{2}/g) ?? [], n => parseInt(n, 16));
type Verifier = { username: string; salt: string; hash: string };
type Credentials = Verifier & { signingKey: string };
type GateSession = { id: string; expires: number; kind: "owner" | "guest"; epoch: string };
const sessions = new WeakMap<Request, GateSession>();
function verifier(raw?: string): Verifier | null {
  try {
    const c = JSON.parse(raw ?? "");
    if (typeof c.username === "string" && c.username.length > 0 && c.username.length <= 100 && /^[a-f0-9]{32}$/.test(c.salt) && /^[a-f0-9]{64}$/.test(c.hash)) return c;
  } catch {}
  return null;
}
function credentials(env: Env): Credentials | null {
  const c = verifier(env.PRIVATE_ACCESS_CREDENTIALS) as Credentials | null;
  return c && /^[a-f0-9]{64}$/.test(c.signingKey) ? c : null;
}
async function key(c: Credentials) {
  return crypto.subtle.importKey("raw", bytes(c.signingKey), {name:"HMAC", hash:"SHA-256"}, false, ["sign", "verify"]);
}
function cookieToken(request: Request) {
  return request.headers.get("Cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
}
function payload(s: GateSession, host: string) { return `v2:${s.id}:${s.expires}:${s.kind}:${host}:${s.epoch}`; }
async function validSession(request: Request, env: Env, c: Credentials): Promise<GateSession | null> {
  const token = cookieToken(request);
  if (!token || !/^v2\.[a-f0-9]{32}\.\d{13}\.(owner|guest)\.[a-f0-9]{64}$/.test(token)) return null;
  const [, id, exp, kind, signature] = token.split(".");
  const remaining = Number(exp) - Date.now();
  if (remaining <= 0 || remaining > REMEMBER_HOURS * 3600000) return null;
  const v = kind === "owner" ? c : verifier(env.PRIVATE_GUEST_ACCESS_CREDENTIALS);
  if (!v) return null;
  const s: GateSession = {id, expires:Number(exp), kind:kind as GateSession["kind"], epoch:v.hash};
  if (!(await crypto.subtle.verify("HMAC", await key(c), bytes(signature), encode(payload(s, new URL(request.url).host))))) return null;
  const found = await budget(env, "/private-session/read", {id});
  if (!found.session || found.session.expires !== s.expires || found.session.kind !== s.kind || found.session.epoch !== s.epoch) return null;
  sessions.set(request, s);
  return s;
}
export function privateSessionId(request: Request): string | undefined { return sessions.get(request)?.id; }
async function passwordMatches(password: string, username: string, c: Verifier) {
  const material = await crypto.subtle.importKey("raw", encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = hex(await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:bytes(c.salt), iterations:ITERATIONS}, material, 256));
  let difference = username === c.username ? 0 : 1;
  for (let i = 0; i < 64; i++) difference |= hash.charCodeAt(i) ^ c.hash.charCodeAt(i);
  return difference === 0;
}
function clearCookies(h: Headers) {
  h.append("Set-Cookie", `${COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  h.append("Set-Cookie", "traffic_guest=; Secure; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0");
}
/** Runs before every application asset and API. Gate identities never authorize personal APIs. */
export async function privateAccess(request: Request, env: Env): Promise<Response | null> {
  if (env.PRIVATE_ACCESS_REQUIRED !== "true") return null;
  const url = new URL(request.url), lang = gateLanguage(request), nextUrl = url.pathname + url.search;
  if (url.pathname === "/sw.js" && request.method === "GET") return privateResponse(await env.ASSETS.fetch(request), env);
  const c = credentials(env);
  if (!c) return gatePage(nextUrl, lang, "setup", 503);
  if (["/private/unlock", "/private/lock", "/private/language"].includes(url.pathname)) {
    if (request.method !== "POST") return gatePage("/", lang);
    if (request.headers.get("Origin") !== url.origin) return gatePage("/", lang, "invalid", 403);
    try {
      if (url.pathname === "/private/lock") {
        const current = await validSession(request, env, c);
        if (current) await budget(env, "/private-session/delete", {id:current.id});
        const h = new Headers({...gateHeaders, Location:"/", "Clear-Site-Data":'"cache"'});
        clearCookies(h);
        if (request.headers.get("Accept") === "application/json") return Response.json({locked:true}, {headers:h});
        return new Response(null, {status:303, headers:h});
      }
      if (!request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) return gatePage("/", lang, "invalid", 400);
      if (Number(request.headers.get("Content-Length")) > 16384) return gatePage("/", lang, "large", 413);
      const text = await request.text();
      if (text.length > 16384) return gatePage("/", lang, "large", 413);
      const form = new URLSearchParams(text), next = safeGatePath(form.get("next") ?? "/");
      if (url.pathname === "/private/language") {
        const language = form.get("language") === "ar" ? "ar" : "en";
        return new Response(null, {status:303, headers:{...gateHeaders, Location:next, "Set-Cookie":`__Host-traffic_language=${language}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`}});
      }
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const rateId = hex(await crypto.subtle.digest("SHA-256", encode(ip)));
      try { await budget(env, "/private-rate", {user:rateId}); }
      catch (error) { return gatePage(next, lang, error instanceof ApiError && error.status === 429 ? "rate" : "unavailable", error instanceof ApiError && error.status === 429 ? 429 : 503); }
      const username = (form.get("username") ?? "").trim(), password = form.get("password") ?? "";
      const guest = verifier(env.PRIVATE_GUEST_ACCESS_CREDENTIALS);
      // Derive both configured verifiers regardless of username to avoid a username timing oracle.
      const ownerMatch = await passwordMatches(password.slice(0, 201), username, c);
      const guestMatch = guest ? await passwordMatches(password.slice(0, 201), username, guest) : false;
      if (username.length > 100 || password.length > 200 || (!ownerMatch && !guestMatch)) return gatePage(next, lang, "incorrect");
      const remembered = form.get("remember") === "yes", hours = remembered ? REMEMBER_HOURS : HOURS;
      const current = await validSession(request, env, c);
      if (current) await budget(env, "/private-session/delete", {id:current.id});
      const s: GateSession = {id:crypto.randomUUID().replaceAll("-", ""), expires:Date.now() + hours * 3600000, kind:ownerMatch ? "owner" : "guest", epoch:ownerMatch ? c.hash : guest!.hash};
      await budget(env, "/private-session/create", s);
      const signature = hex(await crypto.subtle.sign("HMAC", await key(c), encode(payload(s, url.host))));
      const h = new Headers({...gateHeaders, Location:next});
      h.append("Set-Cookie", `${COOKIE}=v2.${s.id}.${s.expires}.${s.kind}.${signature}; Secure; HttpOnly; SameSite=Lax; Path=/${remembered ? "; Max-Age=" + hours * 3600 : ""}`);
      h.append("Set-Cookie", "traffic_guest=; Secure; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0");
      return new Response(null, {status:303, headers:h});
    } catch { return gatePage("/", lang, "unavailable", 503); }
  }
  try { if (await validSession(request, env, c)) return null; }
  catch {
    if (url.pathname.startsWith("/api/")) return Response.json({error:"Website access is temporarily unavailable.", code:"PRIVATE_UNAVAILABLE"}, {status:503, headers:gateHeaders});
    return gatePage(nextUrl, lang, "unavailable", 503);
  }
  if (url.pathname.startsWith("/api/") || !request.headers.get("Accept")?.includes("text/html")) return Response.json({error:"Unlock the private website before continuing.", privateAccess:true, code:"PRIVATE_ACCESS_REQUIRED"}, {status:401, headers:gateHeaders});
  return gatePage(nextUrl, lang);
}
export function privateResponse(response: Response, env: Env) {
  if (env.PRIVATE_ACCESS_REQUIRED !== "true") return response;
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set("Vary", [res.headers.get("Vary"), "Cookie"].filter(Boolean).join(", "));
  return res;
}
