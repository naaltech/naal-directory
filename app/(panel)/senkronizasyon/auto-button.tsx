"use client";

import { Button } from "@carbon/react";
import { Pause, Play } from "@carbon/icons-react";
import { useTransition } from "react";
import { setAutoAction } from "./actions.ts";

export function AutoButton({ paused }: { paused: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button
      kind="tertiary"
      size="sm"
      renderIcon={paused ? Play : Pause}
      disabled={pending}
      onClick={() => start(() => setAutoAction(paused))}
    >
      {paused ? "Otomatik çalıştırmayı aç" : "Otomatik çalıştırmayı durdur"}
    </Button>
  );
}
