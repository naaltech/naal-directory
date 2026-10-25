import type { Metadata } from "next";
import Link from "next/link";
import { ClickableTile, InlineNotification, Tag, Tile } from "@carbon/react";
import { PageHeader } from "@/components/page-header.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { leaverCandidates } from "@/lib/leavers.ts";
import { upcomingRetention } from "@/lib/retention.ts";

export const metadata: Metadata = { title: "Genel bakış" };

function stats() {
  const db = getDb();
  const one = (sql: string) => db.prepare(sql).pluck().get() as number;
  return {
    students: one("SELECT count(*) FROM students WHERE status NOT IN ('DELETED') AND exit_reason IS NULL"),
    teachers: one("SELECT count(*) FROM teachers WHERE status NOT IN ('DELETED') AND left_at IS NULL"),
    classes: one(
      "SELECT count(*) FROM class_sections c JOIN academic_years y ON y.id = c.academic_year_id WHERE y.is_current = 1",
    ),
    clubs: one("SELECT count(*) FROM clubs WHERE is_active = 1"),
    queued: one("SELECT count(*) FROM sync_jobs WHERE status IN ('QUEUED', 'RUNNING')"),
    failed: one("SELECT count(*) FROM sync_jobs WHERE status = 'FAILED'"),
    year: db.prepare("SELECT name FROM academic_years WHERE is_current = 1").pluck().get() as string | undefined,
  };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ yetki?: string }> }) {
  const user = await requireUser();
  const { yetki } = await searchParams;
  const s = stats();
  const db = getDb();
  const leavers = leaverCandidates(db).rows.length;
  const upcoming = upcomingRetention(db);
  const googleReady = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE && process.env.GOOGLE_ADMIN_IMPERSONATE);

  const cards = [
    { label: "Öğrenci", value: s.students, href: "/ogrenciler" },
    { label: "Öğretmen", value: s.teachers, href: "/ogretmenler" },
    { label: "Şube", value: s.classes, href: "/siniflar" },
    { label: "Kulüp", value: s.clubs, href: "/kulupler" },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Hoş geldiniz, ${user.name.split(" ")[0]}`}
        description={`${s.year ?? "Eğitim yılı tanımlı değil"} eğitim yılı`}
      />

      {(leavers > 0 || upcoming.suspend + upcoming.remove > 0) && (
        <div className="mb-6 space-y-2">
          {leavers > 0 && (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title={`${leavers} öğrenci bu yılın listesinde yok`}
              subtitle="Mezun ya da nakil olarak onaylamak için Öğrenciler › Ayrılanlar ekranını açın."
            />
          )}
          {upcoming.suspend + upcoming.remove > 0 && (
            <InlineNotification
              kind="info"
              lowContrast
              hideCloseButton
              title={`Önümüzdeki ${upcoming.windowDays} gün`}
              subtitle={`${upcoming.suspend} ayrılan hesabın askıya alınma, ${upcoming.remove} hesabın silinme tarihi geliyor.`}
            />
          )}
        </div>
      )}

      {yetki === "yok" && (
        <div className="mb-6">
          <InlineNotification kind="warning" title="Yetkiniz yok" subtitle="Bu sayfa için rolünüz yeterli değil." lowContrast />
        </div>
      )}

      <div className="grid grid-cols-2 gap-px bg-subtle lg:grid-cols-4">
        {cards.map((c) => (
          <ClickableTile key={c.label} href={c.href} className="!min-h-0">
            <p className="text-sm text-secondary">{c.label}</p>
            <p className="mt-6 text-4xl font-light tabular-nums">{c.value.toLocaleString("tr-TR")}</p>
          </ClickableTile>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Tile>
          <h2 className="mb-4 text-lg">Senkronizasyon kuyruğu</h2>
          <div className="flex flex-wrap gap-2">
            <Tag type={s.queued ? "blue" : "gray"}>{s.queued} bekleyen</Tag>
            <Tag type={s.failed ? "red" : "gray"}>{s.failed} hatalı</Tag>
            <Tag type={googleReady ? "green" : "red"}>{googleReady ? "Google bağlantısı ayarlı" : "Google ayarı eksik"}</Tag>
          </div>
          <p className="mt-4 text-sm text-secondary">
            Google&apos;a giden tüm işlemler (hesap açma, grup üyeliği, takma ad) bu kuyruktan sırayla gönderilir.{" "}
            <Link href="/senkronizasyon" className="text-interactive underline">
              Kuyruğu görüntüle
            </Link>
          </p>
        </Tile>

        <Tile>
          <h2 className="mb-4 text-lg">Başlarken</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              <Link href="/ice-aktar" className="text-interactive underline">
                e-Okul sınıf listesini yükleyin
              </Link>{" "}
              ve önizlemeyi kontrol edin.
            </li>
            <li>Onaylayınca öğrenci hesapları, şube OU&apos;ları ve sınıf grupları kuyruğa alınır.</li>
            <li>Kulüplerde görevli öğrencilere isim@naal.org.tr takma adı verin.</li>
          </ol>
        </Tile>
      </div>
    </div>
  );
}
