import type { AppConfig } from "../shared/types";

/** Clear a previous unlock's account before the SDK can recover/render it.
 * The PKCE verifier is deliberately retained so an in-progress OAuth callback can finish. */
export function preparePrivateAccount(config: AppConfig, storage: Storage = localStorage) {
  if (!config.privateAccess) return;
  if (!config.privateSessionId || !config.supabaseUrl) throw new Error("Private session unavailable.");
  if (storage.getItem("traffic.authGateSession") === config.privateSessionId) return;
  const tokenKey = `sb-${new URL(config.supabaseUrl).hostname.split(".")[0]}-auth-token`;
  storage.removeItem(tokenKey);
  storage.removeItem(tokenKey + "-user");
  storage.setItem("traffic.authGateSession", config.privateSessionId);
}
export function broadcastWebsiteLock() {
  localStorage.setItem("traffic.websiteLocked", crypto.randomUUID());
}
