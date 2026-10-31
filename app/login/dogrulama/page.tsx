import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TWO_FACTOR_COOKIE } from "@/lib/auth/cookie.ts";
import { AuthCard } from "../auth-card.tsx";
import { TwoFactorForm } from "./two-factor-form.tsx";

export const metadata: Metadata = { title: "Doğrulama kodu" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await cookies()).has(TWO_FACTOR_COOKIE)) redirect("/login");
  const { next } = await searchParams;

  return (
    <AuthCard title="Doğrulama kodu" description="Doğrulama uygulamanızdaki 6 haneli kodu girin. Telefonunuz yanınızda değilse kurtarma kodlarınızdan birini kullanın.">
      <TwoFactorForm next={next} />
    </AuthCard>
  );
}
