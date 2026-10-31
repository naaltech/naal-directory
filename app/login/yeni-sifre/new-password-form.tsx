"use client";

import { Button, Form, InlineNotification, PasswordInput, Stack } from "@carbon/react";
import { useActionState } from "react";
import { newPasswordAction, type AccountLinkState } from "../actions.ts";

export function NewPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AccountLinkState, FormData>(newPasswordAction, {});

  if (state.done) {
    return <InlineNotification kind="success" title="Şifre değişti" subtitle="Yeni şifrenizle giriş yapabilirsiniz." hideCloseButton lowContrast />;
  }

  return (
    <Form action={action} aria-label="Yeni şifre">
      <Stack gap={6}>
        {state.error && <InlineNotification kind="error" title="Şifre değişmedi" subtitle={state.error} hideCloseButton lowContrast />}
        <input type="hidden" name="token" value={token} />
        <PasswordInput
          id="password"
          name="password"
          labelText="Yeni şifre"
          helperText="En az 10 karakter, harf ve rakam içermeli"
          autoComplete="new-password"
          showPasswordLabel="Şifreyi göster"
          hidePasswordLabel="Şifreyi gizle"
          required
          autoFocus
        />
        <PasswordInput
          id="repeat"
          name="repeat"
          labelText="Yeni şifre (tekrar)"
          autoComplete="new-password"
          showPasswordLabel="Şifreyi göster"
          hidePasswordLabel="Şifreyi gizle"
          required
        />
        <Button type="submit" disabled={pending} className="w-full max-w-none">
          {pending ? "Kaydediliyor…" : "Şifreyi değiştir"}
        </Button>
      </Stack>
    </Form>
  );
}
