"use client";

// Carbon düğmesi görünümünde Next.js bağlantısı. Sunucu sayfası <Button as={Link}> ya da ikon
// bileşeni veremez (fonksiyon istemci bileşenine geçirilemez), bu yüzden ikon adla seçilir.

import { Button } from "@carbon/react";
import { Password } from "@carbon/icons-react";
import Link from "next/link";

const ICONS = { password: Password };

export function LinkButton({
  href,
  kind = "tertiary",
  icon,
  children,
}: {
  href: string;
  kind?: "primary" | "secondary" | "tertiary" | "ghost";
  icon?: keyof typeof ICONS;
  children: React.ReactNode;
}) {
  return (
    <Button as={Link} href={href} kind={kind} renderIcon={icon && ICONS[icon]}>
      {children}
    </Button>
  );
}
