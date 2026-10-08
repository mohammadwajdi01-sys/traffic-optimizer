import { accountEn, accountAr } from "./account-copy";

/** Keep only intent; never retain, display or log the token or provider error text. */
export function accountCallback(url: string): "none" | "recovery" | "confirmation" | "invalid" {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  if ([parsed.searchParams, fragment].some(p => p.has("error") || p.has("error_code") || p.has("error_description"))) return "invalid";
  if (fragment.get("type") === "recovery") return fragment.has("access_token") && fragment.has("refresh_token") ? "recovery" : "invalid";
  if (["signup", "magiclink", "email"].includes(fragment.get("type") ?? "")) return "confirmation";
  return "none";
}
export function clearAccountCallback() {
  const url = new URL(location.href);
  for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  url.hash = "";
  history.replaceState(history.state, "", url.pathname + url.search);
}
export const accountRedirect = () => location.origin + "/settings";
export function accountFailure(error: unknown, locale: "en" | "ar", fallback: string) {
  const t = locale === "ar" ? accountAr : accountEn;
  const e = error && typeof error === "object" ? error as {code?:string;status?:number} : {};
  if (e.code === "email_not_confirmed") return t.unconfirmed;
  if (e.code === "invalid_credentials") return t.invalidLogin;
  if (e.code === "weak_password") return t.weak;
  if (e.code === "signup_disabled") return t.signupDisabled;
  if (["reauthentication_needed", "reauthentication_not_valid"].includes(e.code ?? "")) return t.recentLogin;
  return fallback;
}
