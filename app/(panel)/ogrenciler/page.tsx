import type { Metadata } from "next";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
} from "@carbon/react";
import { LinkButton } from "@/components/link-button.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { UrlDropdown, UrlPagination, UrlSearch } from "@/components/url-controls.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { listClasses } from "@/lib/classes.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS, EXIT_REASON } from "@/lib/labels.ts";
import { listStudents } from "@/lib/students.ts";

export const metadata: Metadata = { title: "Öğrenciler" };

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Aktif" },
  { value: "PENDING", label: "Google'a gönderilecek" },
  { value: "ERROR", label: "Hatalı" },
  { value: "SUSPENDED", label: "Askıda" },
  { value: "LEFT", label: "Mezun / nakil" },
];

type Search = { q?: string; sinif?: string; durum?: string; sayfa?: string; boyut?: string };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const page = Number(sp.sayfa) || 1;
  const pageSize = [25, 50, 100, 250].includes(Number(sp.boyut)) ? Number(sp.boyut) : 50;
  const { rows, total } = listStudents(db, {
    q: sp.q,
    classId: Number(sp.sinif) || undefined,
    status: sp.durum,
    page,
    pageSize,
  });
  const classes = listClasses(db);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Öğrenciler"
        description="Öğrenci hesapları, şubeleri ve Google durumları. Yeni öğrenciler Liste içe aktar ekranından eklenir."
        actions={
          <LinkButton href="/ogrenciler/ayrilanlar">Ayrılanlar</LinkButton>
        }
      />

      <TableContainer>
        <TableToolbar>
          <TableToolbarContent className="justify-start!">
            <UrlSearch placeholder="Ad, okul no veya e-posta" />
            <UrlDropdown
              name="sinif"
              label="Şube"
              allLabel="Tüm şubeler"
              options={classes.map((c) => ({ value: String(c.id), label: c.name }))}
            />
            <UrlDropdown name="durum" label="Durum" allLabel="Okuldaki öğrenciler" options={STATUS_OPTIONS} />
          </TableToolbarContent>
        </TableToolbar>
        <Table aria-label="Öğrenciler" size="md">
          <TableHead>
            <TableRow>
              <TableHeader>Şube</TableHeader>
              <TableHeader>Okul no</TableHeader>
              <TableHeader>Ad Soyad</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Durum</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-secondary">
                  {total === 0 && !sp.q && !sp.sinif && !sp.durum
                    ? "Henüz öğrenci yok. Liste içe aktarıp onaylayınca burada görünür."
                    : "Aramaya uyan öğrenci yok."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => {
              const st = ENTITY_STATUS[s.status] ?? { label: s.status, type: "gray" as const };
              return (
                <TableRow key={s.id}>
                  <TableCell>{s.class_name ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{s.school_no}</TableCell>
                  <TableCell>
                    <Link href={`/ogrenciler/${s.id}`} className="text-interactive hover:underline">
                      {s.first_name} {s.last_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{s.email}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Tag type={st.type} size="sm">
                      {st.label}
                    </Tag>
                    {s.exit_reason && (
                      <Tag type="gray" size="sm">
                        {EXIT_REASON[s.exit_reason]}
                      </Tag>
                    )}
                    {s.is_officer ? (
                      <Tag type="purple" size="sm">
                        Kulüp görevlisi
                      </Tag>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <UrlPagination total={total} page={page} pageSize={pageSize} unit="öğrenci" />
      </TableContainer>
    </div>
  );
}
