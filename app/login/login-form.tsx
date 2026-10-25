"use client";

import { Button, Form, InlineNotification, PasswordInput, Stack, TextInput } from "@carbon/react";
import { ArrowRight } from "@carbon/icons-react";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "./actions.ts";
import { Turnstile } from "./turnstile.tsx";

export function LoginForm({ next, turnstileSiteKey }: { next?: string; turnstileSiteKey?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [token, setToken] = useState<string | null>(null);
  const waiting = Boolean(turnstileSiteKey) && !token;

  return (
    <Form action={action} aria-label="Yönetici girişi">
      <Stack gap={6}>
        {state.error && (
          <InlineNotification kind="error" title="Giriş yapılamadı" subtitle={state.error} hideCloseButton lowContrast />
        )}
        <input type="hidden" name="next" value={next ?? ""} />
        <TextInput
          id="email"
          name="email"
          type="email"
          labelText="E-posta"
          placeholder="ad.soyad@nevzatayazal.k12.tr"
          autoComplete="username"
          defaultValue={state.email}
          required
          autoFocus
        />
        <PasswordInput
          id="password"
          name="password"
          labelText="Şifre"
          autoComplete="current-password"
          showPasswordLabel="Şifreyi göster"
          hidePasswordLabel="Şifreyi gizle"
          required
        />
        {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} resetKey={state} onToken={setToken} />}
        <Button type="submit" renderIcon={ArrowRight} disabled={pending || waiting} className="w-full max-w-none">
          {pending ? "Giriş yapılıyor…" : waiting ? "Doğrulama bekleniyor…" : "Giriş yap"}
        </Button>
      </Stack>
    </Form>
  );
}
