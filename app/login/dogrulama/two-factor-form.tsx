"use client";

import { Button, Form, InlineNotification, Stack, TextInput } from "@carbon/react";
import { ArrowRight } from "@carbon/icons-react";
import { useActionState } from "react";
import { twoFactorAction, type LoginState } from "../actions.ts";

export function TwoFactorForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(twoFactorAction, {});

  return (
    <Form action={action} aria-label="Doğrulama kodu">
      <Stack gap={6}>
        {state.error && <InlineNotification kind="error" title="Giriş yapılamadı" subtitle={state.error} hideCloseButton lowContrast />}
        <input type="hidden" name="next" value={next ?? ""} />
        <TextInput id="code" name="code" labelText="Kod" autoComplete="one-time-code" required autoFocus />
        <Button type="submit" renderIcon={ArrowRight} disabled={pending} className="w-full max-w-none">
          {pending ? "Doğrulanıyor…" : "Doğrula"}
        </Button>
      </Stack>
    </Form>
  );
}
