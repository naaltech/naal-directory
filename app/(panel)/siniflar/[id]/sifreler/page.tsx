import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineNotification } from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import { requireUser } from "@/lib/auth/server.ts";
import { getClass } from "@/lib/classes.ts";
import { getDb } from "@/lib/db.ts";
import { classPasswordSlips } from "@/lib/students.ts";
import { PrintButton } from "@/components/print-button.tsx";

export const metadata: Metadata = { title: "Şifre listesi", referrer: "no-referrer" };

// Öğrencilere dağıtılacak kesilebilir giriş kartları. Sayfa her açılışta kayda geçer.
export default async function PasswordSlipsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const c = getClass(db, id);
  if (!c) notFound();
  const slips = classPasswordSlips(db, id, user.id);
  const notReady = slips.filter((s) => s.status !== "ACTIVE").length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link href={`/siniflar/${id}`} className="inline-flex items-center gap-1 text-sm text-interactive hover:underline">
          <ArrowLeft size={16} /> {c.name}
        </Link>
        <PrintButton />
      </div>
      <div className="mb-6 space-y-2 print:hidden">
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Kişisel veri"
          subtitle="Bu sayfayı açmanız kayda geçti. Çıktıyı öğrencilere dağıttıktan sonra imha edin; ekran görüntüsü paylaşmayın."
        />
        {notReady > 0 && (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title={`${notReady} hesap henüz Google'da açılmadı`}
            subtitle="Bu öğrencilerin kartları senkronizasyon tamamlanınca çalışır."
          />
        )}
      </div>

      <h1 className="mb-4 text-2xl font-normal">{c.name} · giriş bilgileri</h1>
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 print:grid-cols-2">
        {slips.map((s) => (
          <div key={s.id} className="break-inside-avoid border border-dashed border-subtle p-4">
            <p className="text-base font-semibold">
              {s.first_name} {s.last_name}
            </p>
            <p className="mb-3 text-xs text-secondary">
              {c.name} · Okul no {s.school_no}
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-secondary">E-posta</dt>
              <dd className="font-mono break-all">{s.email}</dd>
              <dt className="text-secondary">İlk şifre</dt>
              <dd className="font-mono tracking-wider">{s.password ?? "—"}</dd>
            </dl>
            <p className="mt-3 text-xs text-secondary">
              accounts.google.com adresinden giriş yapın. İlk girişte yeni şifre belirlemeniz istenir.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
