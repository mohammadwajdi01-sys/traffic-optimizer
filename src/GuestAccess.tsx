import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { en, ar } from "./i18n";
import { useStore } from "./store";
export default function GuestAccess({
  siteKey,
  onReady,
  onError,
  onSignIn,
}: {
  siteKey: string;
  onReady: (expiresAt: number) => void;
  onError: (e: string) => void;
  onSignIn?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<
    "checking" | "loading" | "challenge" | "validating" | "failed"
  >("checking");
  const { locale } = useStore();
  const t = locale === "ar" ? ar : en;
  const callbacks = useRef({ onReady, onError, t });
  callbacks.current = { onReady, onError, t };
  useEffect(() => {
    let stopped = false,
      validating = false,
      completed = false,
      rendered = false;
    let id: string | undefined,
      loadTimer: ReturnType<typeof setTimeout> | undefined;
    let script: HTMLScriptElement | null = null;
    const w = window as any;
    const controller = new AbortController();
    const statusController = new AbortController();
    const fail = (
      message = callbacks.current.t.verificationFailed,
      errorCode = "",
    ) => {
      if (stopped || completed) return;
      setCode(errorCode);
      setFailure(message);
      setPhase("failed");
      callbacks.current.onError(message);
    };
    const ready = (expiresAt?: number) => {
      if (stopped) return;
      // The server is the only authority for access and expiry. Never trust a UI flag.
      if (!Number.isFinite(expiresAt) || expiresAt! <= Date.now()) {
        fail();
        return;
      }
      completed = true;
      setFailure("");
      callbacks.current.onReady(expiresAt!);
    };
    const render = () => {
      if (stopped || rendered || !root.current || !w.turnstile) return;
      rendered = true;
      clearTimeout(loadTimer);
      setPhase("challenge");
      setFailure("");
      setCode("");
      callbacks.current.onError("");
      try {
        id = w.turnstile.render(root.current, {
          sitekey: siteKey,
          size: root.current.clientWidth < 300 ? "compact" : "flexible",
          retry: "never",
          "refresh-expired": "manual",
          "refresh-timeout": "manual",
          "error-callback": (value: unknown) => {
            const errorCode =
              typeof value === "string" && /^\d{6}$/.test(value) ? value : "";
            const copy = callbacks.current.t;
            const message = [
              "110100",
              "110110",
              "110200",
              "400020",
              "400021",
              "400070",
            ].includes(errorCode)
              ? copy.verificationConfig
              : errorCode === "200500"
                ? copy.verificationNetwork
                : /^(300|600)/.test(errorCode)
                  ? copy.verificationBrowser
                  : ["110600", "110620"].includes(errorCode)
                    ? copy.verificationExpired
                    : copy.verificationFailed;
            fail(message, errorCode);
            return true;
          },
          "expired-callback": () =>
            fail(callbacks.current.t.verificationExpired),
          "timeout-callback": () =>
            fail(callbacks.current.t.verificationExpired),
          callback: async (token: string) => {
            if (stopped || validating || completed) return;
            validating = true;
            setPhase("validating");
            setFailure("");
            const validationTimer = setTimeout(() => controller.abort(), 15000);
            try {
              const result = await api<{ ok: boolean; expiresAt: number }>(
                "/api/guest-session",
                { token },
                "POST",
                controller.signal,
              );
              if (!result.ok) fail();
              else ready(result.expiresAt);
            } catch (e) {
              fail(
                e instanceof Error
                  ? e.message
                  : callbacks.current.t.verificationFailed,
              );
            } finally {
              clearTimeout(validationTimer);
              validating = false;
            }
          },
        });
      } catch {
        fail();
      }
    };
    const scriptReady = () => {
      if (stopped) return;
      // Explicit rendering starts after script load. ready() rejects async scripts.
      render();
    };
    const scriptError = () => {
      if (script) script.dataset.loadState = "failed";
      clearTimeout(loadTimer);
      fail(callbacks.current.t.verificationNetwork);
    };
    const loadWidget = () => {
      if (stopped) return;
      setPhase("loading");
      loadTimer = setTimeout(
        () => fail(callbacks.current.t.verificationNetwork),
        20000,
      );
      script = document.getElementById(
        "turnstile-script",
      ) as HTMLScriptElement | null;
      if (script?.dataset.loadState === "failed" && !w.turnstile) {
        script.remove();
        script = null;
      }
      if (w.turnstile) scriptReady();
      else if (!script) {
        script = document.createElement("script");
        script.id = "turnstile-script";
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.addEventListener("load", scriptReady, { once: true });
        script.addEventListener("error", scriptError, { once: true });
        document.head.appendChild(script);
      } else {
        script.addEventListener("load", scriptReady, { once: true });
        script.addEventListener("error", scriptError, { once: true });
      }
    };
    setFailure("");
    setCode("");
    setPhase("checking");
    const statusTimer = setTimeout(() => statusController.abort(), 8000);
    // Restore only an unexpired, IP-bound, HMAC-validated HttpOnly session.
    api<{ verified: boolean; expiresAt?: number }>(
      "/api/guest-session",
      undefined,
      "GET",
      statusController.signal,
    )
      .then((status) => {
        if (!stopped) {
          if (status.verified) ready(status.expiresAt);
          else loadWidget();
        }
      })
      .catch(() => loadWidget())
      .finally(() => clearTimeout(statusTimer));
    return () => {
      stopped = true;
      clearTimeout(statusTimer);
      clearTimeout(loadTimer);
      controller.abort();
      statusController.abort();
      if (id && w.turnstile) w.turnstile.remove(id);
      script?.removeEventListener("load", scriptReady);
      script?.removeEventListener("error", scriptError);
    };
  }, [siteKey, attempt]);
  return (
    <section className="guest-verification" aria-label={t.guestVerification}>
      <div className="turnstile-box" ref={root} />
      <p role="status" className="micro-copy">
        {failure ||
          (phase === "checking"
            ? t.verificationChecking
            : phase === "loading"
              ? t.verificationLoading
              : phase === "validating"
                ? t.verificationValidating
                : "")}
      </p>
      {code && (
        <p className="micro-copy">
          {t.verificationCode}: <bdi>{code}</bdi>
        </p>
      )}
      {onSignIn && (
        <div className="verification-account">
          <p className="micro-copy">{t.verificationAccount}</p>
          <button
            type="button"
            className="button primary full"
            onClick={onSignIn}
          >
            {t.signin}
          </button>
        </div>
      )}
      <button
        type="button"
        className="button small"
        disabled={
          phase === "checking" || phase === "loading" || phase === "validating"
        }
        onClick={() => setAttempt((n) => n + 1)}
      >
        {t.refreshVerification}
      </button>
    </section>
  );
}
