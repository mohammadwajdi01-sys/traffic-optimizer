import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { en, ar } from "./i18n";
import { useStore } from "./store";
export default function GuestAccess({
  siteKey,
  onReady,
  onError,
}: {
  siteKey: string;
  onReady: () => void;
  onError: (e: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState("");
  const { locale } = useStore();
  const t = locale === "ar" ? ar : en;
  const callbacks = useRef({ onReady, onError, message: t.verificationFailed });
  callbacks.current = { onReady, onError, message: t.verificationFailed };
  useEffect(() => {
    let stopped = false,
      id: string | undefined;
    const w = window as any;
    const fail = (message = callbacks.current.message) => {
      if (stopped) return;
      setFailure(message);
      callbacks.current.onError(message);
    };
    const render = () => {
      if (stopped || !root.current || !w.turnstile) return;
      setFailure("");
      id = w.turnstile.render(root.current, {
        sitekey: siteKey,
        retry: "never",
        "refresh-expired": "manual",
        "refresh-timeout": "manual",
        "error-callback": () => {
          fail();
          return true;
        },
        "expired-callback": () => fail(),
        "timeout-callback": () => fail(),
        callback: (token: string) =>
          api("/api/guest-session", { token })
            .then(() => {
              if (!stopped) callbacks.current.onReady();
            })
            .catch((e) => fail(e.message)),
      });
    };
    let script = document.getElementById(
      "turnstile-script",
    ) as HTMLScriptElement | null;
    if (script?.dataset.loadState === "failed" && !w.turnstile) {
      script.remove();
      script = null;
    }
    const scriptError = () => {
      if (script) script.dataset.loadState = "failed";
      fail();
    };
    if (w.turnstile) render();
    else if (!script) {
      script = document.createElement("script");
      script.id = "turnstile-script";
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", scriptError, { once: true });
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", scriptError, { once: true });
    }
    return () => {
      stopped = true;
      if (id && w.turnstile) w.turnstile.remove(id);
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", scriptError);
    };
  }, [siteKey, attempt]);
  return (
    <>
      <div className="turnstile-box" ref={root} />
      {failure && (
        <p role="status" className="micro-copy">
          {failure}
        </p>
      )}
      <button
        type="button"
        className="button small"
        onClick={() => setAttempt((n) => n + 1)}
      >
        {t.refreshVerification}
      </button>
    </>
  );
}
