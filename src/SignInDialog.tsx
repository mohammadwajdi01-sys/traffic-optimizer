import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { AppConfig } from "../shared/types";
import { supabase } from "./api";
import { en, ar } from "./i18n";
import { useStore } from "./store";

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
        setError(e instanceof Error ? e.message : t.authFailed);
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-busy={busy}>
          <Dialog.Title>{t.signin}</Dialog.Title>
          <Dialog.Description>
            {config.authConfigured ? t.account : t.authSetup}
          </Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label={t.close}>
            <X size={20} />
          </Dialog.Close>
          {error && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">{t.signingIn}</p>}
          {sent && (
            <p className="banner success" role="status">
              {t.signinLinkRequested}
            </p>
          )}
          {config.authConfigured && config.googleAuthEnabled && (
            <button
              className="button primary full"
              type="button"
              disabled={busy}
              onClick={() => signIn("google")}
            >
              {t.signinGoogle}
            </button>
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
                  value={email}
                  onChange={(e) => onEmail(e.target.value)}
                />
              </label>
              <button
                className="button primary full"
                type="submit"
                disabled={busy}
              >
                {t.sendLink}
              </button>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
