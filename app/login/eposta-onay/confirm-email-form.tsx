"use client";

import { Button, Form, InlineNotification, Stack } from "@carbon/react";
import { useActionState } from "react";
import { confirmEmailAction, type AccountLinkState } from "../actions.ts";

export function ConfirmEmailForm({ token, from, to }: { token: string; from: string; to: string }) {
  const [state, action, pending] = useActionState<AccountLinkState, FormData>(confirmEmailAction, {});

  if (state.done) {
    return (
      <InlineNotification
        kind="success"
        title="Adres değişti"
        subtitle={`Artık ${to} ile giriş yapacaksınız. Yönetim paneli yetkiniz birkaç dakika içinde yeni adrese geçer.`}
        hideCloseButton
        lowContrast
      />
    );
  }

  return (
    <Form action={action} aria-label="E-posta onayı">
      <Stack gap={6}>
        {state.error && <InlineNotification kind="error" title="Adres değişmedi" subtitle={state.error} hideCloseButton lowContrast />}
        <input type="hidden" name="token" value={token} />
        <p className="text-sm">
          <span className="font-mono">{from}</span> adresi <span className="font-mono">{to}</span> olacak.
        </p>
        <Button type="submit" disabled={pending} className="w-full max-w-none">
          {pending ? "Onaylanıyor…" : "Onayla"}
        </Button>
      </Stack>
    </Form>
  );
}
