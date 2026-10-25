"use client";

import { Button } from "@carbon/react";
import { Renew } from "@carbon/icons-react";
import { useTransition } from "react";
import { retryFailedAction } from "./actions.ts";

export function RetryButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      kind="tertiary"
      size="sm"
      renderIcon={Renew}
      disabled={pending || count === 0}
      onClick={() => start(async () => void (await retryFailedAction()))}
    >
      {pending ? "Kuyruğa alınıyor…" : `${count} başarısız işi yeniden dene`}
    </Button>
  );
}
