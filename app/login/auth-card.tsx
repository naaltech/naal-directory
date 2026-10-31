// Giriş sayfasının yanındaki kısa adımların ortak görünümü (kod, şifre sıfırlama, e-posta onayı).
import Link from "next/link";

export function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-layer p-6 sm:p-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-3xl font-normal">{title}</h1>
        <p className="mb-8 text-sm text-secondary">{description}</p>
        {children}
        <p className="mt-8 text-sm">
          <Link href="/login" className="text-interactive">
            Giriş sayfasına dön
          </Link>
        </p>
      </div>
    </main>
  );
}
