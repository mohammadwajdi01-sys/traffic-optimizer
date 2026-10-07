import { budget, type Env } from "./env";

const COOKIE = "__Host-traffic_private",
  HOURS = 12,
  ITERATIONS = 100000;
const encode = (s: string) => new TextEncoder().encode(s);
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const bytes = (s: string) =>
  Uint8Array.from(s.match(/.{2}/g) ?? [], (n) => parseInt(n, 16));
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const headers = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "geolocation=(self)",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function nextPath(path: string) {
  return path.startsWith("/") &&
    !path.startsWith("//") &&
    !/[\\\r\n]/.test(path) &&
    !path.startsWith("/private/")
    ? path
    : "/";
}
function page(next: string, message = "", status = 401) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Traffic Optimizer — Private access</title><style>body{font:16px system-ui;background:#f4f7fb;color:#17283e;margin:0;display:grid;min-height:100dvh;place-items:center}main{margin:24px;padding:28px;max-width:400px;background:white;border-radius:18px;border:1px solid #dce4ef}h1{font-size:26px}label{display:block;margin:18px 0}input,button{box-sizing:border-box;width:100%;padding:13px;font:inherit;border-radius:8px;border:1px solid #aab8c9}button{color:white;background:#0866ff;border:0;cursor:pointer}input:focus-visible,button:focus-visible{outline:3px solid #679cff;outline-offset:3px}.error{color:#a31836}</style><main><h1>Private website</h1><p>Enter the shared access details to open Traffic Optimizer.</p><p lang="ar" dir="rtl">الموقع خاص. أدخل اسم المستخدم وكلمة المرور لفتح الموقع.</p>${message ? `<p role="alert" class="error">${escape(message)}</p>` : ""}<form action="/private/unlock" method="post"><input type="hidden" name="next" value="${escape(nextPath(next))}"><label>Username / اسم المستخدم<input name="username" autocomplete="username" required maxlength="100"></label><label>Password / كلمة المرور<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button>Unlock website / فتح الموقع</button></form><p>After unlocking, your personal account keeps your saved routes separate.</p></main></html>`,
    {
      status,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    },
  );
}
type Credentials = {
  username: string;
  salt: string;
  hash: string;
  signingKey: string;
};
function credentials(env: Env): Credentials | null {
  try {
    const c = JSON.parse(env.PRIVATE_ACCESS_CREDENTIALS ?? "");
    if (
      typeof c.username === "string" &&
      /^[a-f0-9]{32}$/.test(c.salt) &&
      /^[a-f0-9]{64}$/.test(c.hash) &&
      /^[a-f0-9]{64}$/.test(c.signingKey)
    )
      return c;
  } catch {}
  return null;
}
async function key(c: Credentials) {
  return crypto.subtle.importKey(
    "raw",
    bytes(c.signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
async function validSession(request: Request, c: Credentials) {
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  if (!token || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) return false;
  const [exp, signature] = token.split("."),
    remaining = Number(exp) - Date.now();
  if (remaining <= 0 || remaining > HOURS * 3600000) return false;
  const data = `${exp}:${new URL(request.url).host}:${c.hash}`;
  return crypto.subtle.verify(
    "HMAC",
    await key(c),
    bytes(signature),
    encode(data),
  );
}
async function passwordMatches(
  password: string,
  username: string,
  c: Credentials,
) {
  const material = await crypto.subtle.importKey(
    "raw",
    encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: bytes(c.salt),
        iterations: ITERATIONS,
      },
      material,
      256,
    ),
  );
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  let difference = username === c.username ? 0 : 1;
  for (let i = 0; i < 64; i++)
    difference |= hash.charCodeAt(i) ^ c.hash.charCodeAt(i);
  return difference === 0;
}
/** Runs before every asset and API. A private flag without a valid secret fails closed. */
export async function privateAccess(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (env.PRIVATE_ACCESS_REQUIRED !== "true") return null;
  const url = new URL(request.url);
  // Old installs must be able to remove cached shells before authenticating.
  // This maintenance script contains no application content or credentials.
  if (url.pathname === "/sw.js" && request.method === "GET")
    return privateResponse(await env.ASSETS.fetch(request), env);
  const c = credentials(env);
  if (!c)
    return new Response(
      "Private access is not configured. الموقع الخاص غير مهيأ.",
      { status: 503, headers },
    );
  if (url.pathname === "/private/unlock" || url.pathname === "/private/lock") {
    if (request.method !== "POST") return page("/");
    if (request.headers.get("Origin") !== url.origin)
      return new Response("Invalid request.", { status: 403, headers });
    if (url.pathname === "/private/lock")
      return new Response(null, {
        status: 303,
        headers: {
          ...headers,
          Location: "/",
          "Set-Cookie": `${COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
          "Clear-Site-Data": '"cache"',
        },
      });
    if (
      !request.headers
        .get("Content-Type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      return page("/", "Invalid sign-in request.", 400);
    if (Number(request.headers.get("Content-Length")) > 4096)
      return page("/", "Request too large.", 413);
    const text = await request.text();
    if (text.length > 4096) return page("/", "Request too large.", 413);
    const form = new URLSearchParams(text),
      next = nextPath(form.get("next") ?? "/");
    try {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const id = hex(await crypto.subtle.digest("SHA-256", encode(ip)));
      await budget(env, "/private-rate", { user: id });
    } catch {
      return page(
        next,
        "Too many attempts. Wait ten minutes and try again. انتظر عشر دقائق ثم حاول مجدداً.",
        429,
      );
    }
    const username = (form.get("username") ?? "").trim(),
      password = form.get("password") ?? "";
    if (
      username.length > 100 ||
      password.length > 200 ||
      !(await passwordMatches(password, username, c))
    )
      return page(
        next,
        "Incorrect username or password. اسم المستخدم أو كلمة المرور غير صحيح.",
      );
    const exp = String(Date.now() + HOURS * 3600000);
    const signature = hex(
      await crypto.subtle.sign(
        "HMAC",
        await key(c),
        encode(`${exp}:${url.host}:${c.hash}`),
      ),
    );
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: next,
        "Set-Cookie": `${COOKIE}=${exp}.${signature}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${HOURS * 3600}`,
      },
    });
  }
  if (await validSession(request, c)) return null;
  if (
    url.pathname.startsWith("/api/") ||
    !request.headers.get("Accept")?.includes("text/html")
  )
    return Response.json(
      {
        error: "Unlock the private website before continuing.",
        privateAccess: true,
      },
      { status: 401, headers },
    );
  return page(url.pathname);
}
export function privateResponse(response: Response, env: Env) {
  if (env.PRIVATE_ACCESS_REQUIRED !== "true") return response;
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "no-store, private");
  res.headers.set(
    "Vary",
    [res.headers.get("Vary"), "Cookie"].filter(Boolean).join(", "),
  );
  return res;
}
