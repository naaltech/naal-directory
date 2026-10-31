"use client";

import { Button, Form, InlineNotification, Stack, TextInput } from "@carbon/react";
import { useActionState, useState } from "react";
import { forgotPasswordAction, type AccountLinkState } from "../actions.ts";
import { Turnstile } from "../turnstile.tsx";

export function ForgotForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, action, pending] = useActionState<AccountLinkState, FormData>(forgotPasswordAction, {});
  const [token, setToken] = useState<string | null>(null);
  const waiting = Boolean(turnstileSiteKey) && !token;

  if (state.done) {
    return (
      <InlineNotification
        kind="success"
        title="İstek alındı"
        subtitle="Bu adres bir yönetici hesabına aitse sıfırlama bağlantısı birkaç dakika içinde gelir. Bağlantı 1 saat geçerlidir."
        hideCloseButton
        lowContrast
      />
    );
  }

  return (
    <Form action={action} aria-label="Şifre sıfırlama isteği">
      <Stack gap={6}>
        {state.error && <InlineNotification kind="error" title="Gönderilemedi" subtitle={state.error} hideCloseButton lowContrast />}
        <TextInput id="email" name="email" type="email" labelText="E-posta" autoComplete="username" required autoFocus />
        {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} resetKey={state} onToken={setToken} />}
        <Button type="submit" disabled={pending || waiting} className="w-full max-w-none">
          {pending ? "Gönderiliyor…" : waiting ? "Doğrulama bekleniyor…" : "Bağlantı gönder"}
        </Button>
      </Stack>
    </Form>
  );
}
