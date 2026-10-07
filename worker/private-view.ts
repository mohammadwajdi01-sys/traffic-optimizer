export type GateLanguage = "en" | "ar";
const copy = {
  en: {
    title: "Traffic Optimizer", heading: "Welcome back", intro: "Enter your website access details to continue.",
    username: "Username", password: "Password", show: "Show password", hide: "Hide password", remember: "Remember me",
    help: "Keep website access for seven days on this device.", unlock: "Unlock website", pending: "Unlocking…",
    account: "Website access is separate from your personal account and saved routes.",
    incorrect: "Incorrect username or password.", rate: "Too many attempts. Wait ten minutes and try again.",
    invalid: "This request could not be completed. Try again.", unavailable: "Website access is temporarily unavailable. Try again shortly.",
    setup: "Private access is not configured yet.", large: "This request is too large. Open the website again.",
  },
  ar: {
    title: "منظّم الرحلات", heading: "أهلاً بعودتك", intro: "أدخل بيانات دخول الموقع للمتابعة.",
    username: "اسم المستخدم", password: "كلمة المرور", show: "إظهار كلمة المرور", hide: "إخفاء كلمة المرور", remember: "تذكّرني",
    help: "احتفظ بإمكانية دخول الموقع لمدة سبعة أيام على هذا الجهاز.", unlock: "فتح الموقع", pending: "جارٍ فتح الموقع…",
    account: "دخول الموقع منفصل عن حسابك الشخصي ومساراتك المحفوظة.",
    incorrect: "اسم المستخدم أو كلمة المرور غير صحيح.", rate: "محاولات كثيرة. انتظر عشر دقائق ثم حاول مجدداً.",
    invalid: "تعذّر إكمال الطلب. حاول مجدداً.", unavailable: "دخول الموقع غير متاح مؤقتاً. حاول بعد قليل.",
    setup: "دخول الموقع الخاص غير مهيأ بعد.", large: "الطلب أكبر من المسموح. افتح الموقع مجدداً.",
  },
};
export type GateMessage = Exclude<keyof typeof copy.en, "title" | "heading" | "intro" | "username" | "password" | "show" | "hide" | "remember" | "help" | "unlock" | "pending" | "account">;
export const gateHeaders = {
  "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer", "Permissions-Policy": "geolocation=(self)",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};
export function safeGatePath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path) || path.length > 6000) return "/";
  try {
    const parsed = new URL(path, "https://gate.invalid");
    if (parsed.origin !== "https://gate.invalid" || parsed.pathname.startsWith("/private/")) return "/";
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return "/"; }
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]!);
export function gateLanguage(request: Request): GateLanguage {
  const match = request.headers.get("Cookie")?.match(/(?:^|;\s*)__Host-traffic_language=(en|ar)(?:;|$)/);
  return match?.[1] === "ar" || (!match && request.headers.get("Accept-Language")?.startsWith("ar")) ? "ar" : "en";
}
export function gatePage(next: string, lang: GateLanguage, message?: GateMessage, status = 401) {
  const t = copy[lang], nonce = crypto.randomUUID().replaceAll("-", "");
  const html = `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${t.title}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;background:#eef3fa;color:#162840;font:16px/1.55 system-ui,sans-serif}main{width:100%;max-width:420px;background:#fff;border:1px solid #d9e2ef;border-radius:24px;padding:28px;box-shadow:0 18px 60px #17365b12}header{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{display:flex;align-items:center;gap:10px;font-weight:750}.mark{background:#1261e8;color:#fff;width:40px;height:40px;border-radius:12px;display:grid;place-items:center}.mark svg{width:24px;height:24px}h1{font-size:28px;line-height:1.25;letter-spacing:-.4px;margin:28px 0 8px}p{margin:0 0 20px;color:#52647b}label{display:block;font-weight:600;margin:20px 0 6px}input:not([type=checkbox]){width:100%;min-height:48px;padding:12px;border:1px solid #a7b7cb;border-radius:12px;background:#fff;color:#162840;font:inherit}.password{position:relative}.password input{padding-inline-end:54px}.eye{position:absolute;inset-inline-end:3px;top:3px;width:44px;height:44px;display:grid;place-items:center}.eye svg{width:22px;height:22px}.language,.eye{background:transparent;border:0;border-radius:10px;color:#2459a9;cursor:pointer;font:inherit;min-height:44px;min-width:44px}.remember{display:flex;align-items:center;gap:10px;min-height:44px;font-size:15px;margin:14px 0 0}.remember input{width:20px;height:20px;accent-color:#1261e8}.help{font-size:14px;margin:0 0 20px}.primary{width:100%;border:0;border-radius:12px;min-height:48px;background:#1261e8;color:#fff;font:inherit;font-weight:650;cursor:pointer}.primary:disabled{opacity:.7;cursor:wait}:focus-visible{outline:3px solid #83b6ff;outline-offset:3px}.error{color:#9d2536;background:#fff0f2;border:1px solid #f0c5cc;border-radius:12px;padding:12px;font-size:15px}.account{font-size:14px;border-top:1px solid #e3e9f2;padding-top:18px;margin:22px 0 0}.pending{margin:12px 0 0;font-size:14px}[hidden]{display:none!important}@media(max-width:390px){main{padding:22px}h1{font-size:26px}}@media(prefers-reduced-motion:no-preference){button{transition:background .15s}}
</style></head><body><main><header><div class="brand"><span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><span>${t.title}</span></div><form action="/private/language" method="post"><input type="hidden" name="next" value="${escape(safeGatePath(next))}"><button class="language" type="submit" name="language" value="${lang === "en" ? "ar" : "en"}" lang="${lang === "en" ? "ar" : "en"}">${lang === "en" ? "العربية" : "English"}</button></form></header><h1>${t.heading}</h1><p>${t.intro}</p>${message ? `<p id="gate-error" class="error" role="alert">${t[message]}</p>` : ""}<form id="unlock" action="/private/unlock" method="post"><input type="hidden" name="next" value="${escape(safeGatePath(next))}"><label for="username">${t.username}</label><input ${message === "incorrect" ? 'aria-invalid="true" aria-describedby="gate-error"' : ""} id="username" name="username" autocomplete="username" required maxlength="100" autocapitalize="none" spellcheck="false"><label for="password">${t.password}</label><div class="password"><input ${message === "incorrect" ? 'aria-invalid="true" aria-describedby="gate-error"' : ""} id="password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button id="eye" class="eye" type="button" aria-label="${t.show}" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div><label class="remember"><input type="checkbox" name="remember" value="yes" aria-describedby="remember-help">${t.remember}</label><p id="remember-help" class="help">${t.help}</p><button id="submit" class="primary">${t.unlock}</button><p id="pending" class="pending" role="status" hidden>${t.pending}</p></form><p class="account">${t.account}</p></main><script nonce="${nonce}">
const password=document.getElementById('password'),eye=document.getElementById('eye'),form=document.getElementById('unlock'),submit=document.getElementById('submit'),pending=document.getElementById('pending');
eye.addEventListener('click',()=>{const shown=password.type==='password';password.type=shown?'text':'password';eye.setAttribute('aria-pressed',String(shown));eye.setAttribute('aria-label',shown?${JSON.stringify(t.hide)}:${JSON.stringify(t.show)})});
try{localStorage.setItem('traffic.locale',${JSON.stringify(lang)})}catch{}
if(location.hash){for(const input of document.querySelectorAll('input[name=next]')){if(!input.value.includes('#'))input.value+=location.hash}}
form.addEventListener('submit',()=>{submit.disabled=true;form.setAttribute('aria-busy','true');pending.hidden=false});
addEventListener('pageshow',()=>{submit.disabled=false;pending.hidden=true;form.removeAttribute('aria-busy')});
</script></body></html>`;
  return new Response(html, {status, headers:{...gateHeaders, "Content-Type":"text/html; charset=utf-8", "Content-Security-Policy":gateHeaders["Content-Security-Policy"] + `; script-src 'nonce-${nonce}'`}});
}
