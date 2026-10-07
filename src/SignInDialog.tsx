import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../shared/types";
import { supabase } from "./api";
import { en, ar } from "./i18n";
import { useStore } from "./store";
import {Button, FieldError, Modal, Notice, Pending} from "./feedback";

export default function SignInDialog({
  config,
  email,
  onEmail,
  onClose,
}: {
  config: AppConfig;
  email: string;
  onEmail: (email: string) => void;
  onClose: () => void;
}) {
  const locale = useStore((s) => s.locale);
  const t = locale === "ar" ? ar : en;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function signIn(method: "google" | "email") {
    if (pending.current) return;
    if (!supabase) {
      setError(t.authFailed);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setSent(false);
    try {
      const result =
        method === "google"
          ? await supabase.auth.signInWithOAuth({
              provider: "google",
              options: { redirectTo: location.origin + "/settings" },
            })
          : await supabase.auth.signInWithOtp({
              email,
              options: {
                emailRedirectTo: location.origin + "/settings",
                shouldCreateUser: config.publicBeta,
              },
            });
      if (result.error) throw result.error;
      if (active.current && method === "email") setSent(true);
    } catch (e) {
      if (active.current)
        setError(e && typeof e === "object" && "status" in e && e.status === 429 ? t.usageLimit : t.authFailed);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Modal title={t.signin} description={config.authConfigured ? t.account : t.authSetup} closeLabel={t.close} onClose={onClose} busy={busy}>
          <FieldError id="signin-error">{error}</FieldError>
          {busy && <Pending>{t.signingIn}</Pending>}
          {sent && <Notice kind="success">{t.signinLinkRequested}</Notice>}
          {config.authConfigured && config.googleAuthEnabled && (
            <Button
              className="button primary full"
              type="button"
              disabled={busy}
              onClick={() => signIn("google")}
            >
              {t.signinGoogle}
            </Button>
          )}
          {config.authConfigured && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void signIn("email");
              }}
            >
              <label>
                {t.email}
                <input
                  type="email"
                  autoComplete="email"
                  required
                  disabled={busy}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "signin-error" : undefined}
                  value={email}
                  onChange={(e) => onEmail(e.target.value)}
                />
              </label>
              <Button
                className="button primary full"
                type="submit"
                disabled={busy}
              >
                {t.sendLink}
              </Button>
            </form>
          )}
    </Modal>
  );
}
