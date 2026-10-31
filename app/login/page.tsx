import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Theme } from "@carbon/react";
import { getCurrentUser } from "@/lib/auth/server.ts";
import { turnstileSiteKey } from "@/lib/auth/turnstile.ts";
import { LoginForm } from "./login-form.tsx";

export const metadata: Metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="grid min-h-screen md:grid-cols-[1fr_minmax(0,28rem)]">
      <Theme theme="g100" className="hidden flex-col justify-between p-8 md:flex">
        <p className="text-sm text-secondary">Nevzat Ayaz Anadolu Lisesi</p>
        <div>
          <h1 className="text-5xl font-light leading-tight">
            Google Workspace
            <br />
            hesap yönetimi
          </h1>
          <p className="mt-4 max-w-md text-secondary">
            Öğrenci, öğretmen ve kulüp hesaplarını okul listesinden oluşturun; sınıf ve kulüp gruplarını tek yerden
            yönetin.
          </p>
        </div>
        <p className="font-mono text-xs text-helper">nevzatayazal.k12.tr · ogr.nevzatayazal.k12.tr · naal.org.tr</p>
      </Theme>

      <div className="flex items-center justify-center bg-layer p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <h2 className="mb-2 text-3xl font-normal">Giriş yap</h2>
          <p className="mb-8 text-sm text-secondary">Yönetici hesabınızla devam edin.</p>
          <LoginForm next={next} turnstileSiteKey={turnstileSiteKey()} />
          <p className="mt-4 text-sm">
            <Link href="/login/sifremi-unuttum" className="text-interactive">
              Şifremi unuttum
            </Link>
          </p>
          <p className="mt-8 text-xs text-helper">
            Hesabınız yoksa bir süper yöneticiden oluşturmasını isteyin. Hesaplar sunucuda{" "}
            <code className="font-mono">npm run admin</code> komutuyla açılır.
          </p>
        </div>
      </div>
    </main>
  );
}
