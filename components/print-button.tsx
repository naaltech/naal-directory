"use client";

import { Button } from "@carbon/react";
import { Printer } from "@carbon/icons-react";

export function PrintButton() {
  return (
    <Button renderIcon={Printer} onClick={() => window.print()}>
      Yazdır
    </Button>
  );
}
