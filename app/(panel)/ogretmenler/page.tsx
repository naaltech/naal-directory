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
import { PageHeader } from "@/components/page-header.tsx";
import { UrlDropdown, UrlSearch } from "@/components/url-controls.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS, formatDate } from "@/lib/labels.ts";
import { listTeachers, teacherDomain } from "@/lib/teachers.ts";
import { AddTeachers } from "./add-teachers.tsx";

export const metadata: Metadata = { title: "Öğretmenler" };

export default async function TeachersPage({ searchParams }: { searchParams: Promise<{ q?: string; durum?: string }> }) {
  const user = await requireUser();
  const { q, durum } = await searchParams;
  const db = getDb();
  const left = durum === "LEFT";
  const rows = listTeachers(db, { q, left });
  const domain = teacherDomain(db).name;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Öğretmenler"
        description={`Öğretmen hesapları ad.soyad@${domain} biçiminde açılır ve /Ogretmenler OU'suna yerleşir.`}
        actions={user.role !== "VIEWER" && <AddTeachers domain={domain} />}
      />
      <TableContainer title={`${rows.length} öğretmen`}>
        <TableToolbar aria-label="Filtreler">
          <TableToolbarContent className="!justify-start">
            <UrlSearch placeholder="Ad, branş veya e-posta" />
            <UrlDropdown name="durum" label="Durum" allLabel="Okuldaki öğretmenler" options={[{ value: "LEFT", label: "Ayrılanlar" }]} />
          </TableToolbarContent>
        </TableToolbar>
        <Table size="md" aria-label="Öğretmenler">
          <TableHead>
            <TableRow>
              <TableHeader>Ad Soyad</TableHeader>
              <TableHeader>Branş</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Durum</TableHeader>
              {left && <TableHeader>Ayrılış</TableHeader>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-secondary">
                  {q ? "Aramaya uyan öğretmen yok." : left ? "Ayrılan öğretmen yok." : "Henüz öğretmen eklenmedi."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((t) => {
              const st = ENTITY_STATUS[t.status] ?? { label: t.status, type: "gray" as const };
              return (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link href={`/ogretmenler/${t.id}`} className="text-interactive hover:underline">
                      {t.first_name} {t.last_name}
                    </Link>
                  </TableCell>
                  <TableCell>{t.branch ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{t.email}</TableCell>
                  <TableCell>
                    <Tag type={st.type} size="sm">
                      {st.label}
                    </Tag>
                  </TableCell>
                  {left && <TableCell>{formatDate(t.left_at)}</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
