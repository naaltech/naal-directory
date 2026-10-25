"use client";

// Cloudflare Turnstile widget'ı. Formun içine "cf-turnstile-response" gizli alanını kendisi ekler.
// Token tek kullanımlık: her gönderimden sonra (resetKey değişince) yenilenir.
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function Turnstile({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: unknown;
  onToken: (token: string | null) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const [ready, setReady] = useState(() => typeof window !== "undefined" && Boolean(window.turnstile));
  const [failed, setFailed] = useState(false);
  const tokenCb = useRef(onToken);
  useEffect(() => {
    tokenCb.current = onToken;
  });

  useEffect(() => {
    if (!ready || !el.current || !window.turnstile) return;
    const widget = window.turnstile.render(el.current, {
      sitekey: siteKey,
      action: "login",
      language: "tr",
      theme: "light",
      size: "flexible",
      callback: (t: string) => (setFailed(false), tokenCb.current(t)),
      "expired-callback": () => tokenCb.current(null),
      "error-callback": () => (setFailed(true), tokenCb.current(null)),
    });
    id.current = widget;
    return () => {
      window.turnstile?.remove(widget);
      id.current = null;
    };
  }, [ready, siteKey]);

  // Gönderimden sonra yeni token al
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (id.current && window.turnstile) {
      tokenCb.current(null);
      window.turnstile.reset(id.current);
    }
  }, [resetKey]);

  return (
    <div>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => setFailed(true)}
      />
      <div ref={el} className="min-h-[65px]" />
      {failed && (
        <p className="mt-2 text-xs text-support-error">
          Bot doğrulaması yüklenemedi. Sayfayı yenileyin; reklam engelleyici varsa bu site için kapatın.
        </p>
      )}
    </div>
  );
}
