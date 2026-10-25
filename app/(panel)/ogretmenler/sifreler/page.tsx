import type { Metadata } from "next";
import Link from "next/link";
import { InlineNotification } from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import { PrintButton } from "@/components/print-button.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { teacherPasswordSlips } from "@/lib/teachers.ts";

export const metadata: Metadata = { title: "Öğretmen şifreleri", referrer: "no-referrer" };

// Öğretmenlere dağıtılacak kesilebilir giriş kartları. Sayfa her açılışta kayda geçer.
export default async function TeacherPasswordSlipsPage() {
  const user = await requireUser("ADMIN");
  const slips = teacherPasswordSlips(getDb(), user.id);
  const notReady = slips.filter((s) => s.status !== "ACTIVE").length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link href="/ogretmenler" className="inline-flex items-center gap-1 text-sm text-interactive hover:underline">
          <ArrowLeft size={16} /> Öğretmenler
        </Link>
        <PrintButton />
      </div>
      <div className="mb-6 space-y-2 print:hidden">
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Kişisel veri"
          subtitle="Bu sayfayı açmanız kayda geçti. Kartları öğretmenlere dağıttıktan sonra çıktıyı imha edin; ekran görüntüsü paylaşmayın."
        />
        {notReady > 0 && (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title={`${notReady} hesap henüz Google'da açılmadı`}
            subtitle="Bu öğretmenlerin kartları senkronizasyon tamamlanınca çalışır."
          />
        )}
      </div>

      <h1 className="mb-4 text-2xl font-normal">Öğretmenler · giriş bilgileri</h1>
      {slips.length === 0 && <p className="text-sm text-secondary">Kayıtlı ilk şifresi olan öğretmen yok.</p>}
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 print:grid-cols-2">
        {slips.map((s) => (
          <div key={s.id} className="break-inside-avoid border border-dashed border-subtle p-4">
            <p className="text-base font-semibold">
              {s.first_name} {s.last_name}
            </p>
            <p className="mb-3 text-xs text-secondary">{s.branch ?? "Öğretmen"}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-secondary">E-posta</dt>
              <dd className="font-mono break-all">{s.email}</dd>
              <dt className="text-secondary">İlk şifre</dt>
              <dd className="font-mono tracking-wider">{s.password}</dd>
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
