import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import { LinkButton } from "@/components/link-button.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getClass } from "@/lib/classes.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS } from "@/lib/labels.ts";
import { listStudents } from "@/lib/students.ts";

export const metadata: Metadata = { title: "Şube" };

export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const c = getClass(db, id);
  if (!c) notFound();
  // Güncel yılda şubedeki öğrenciler, geçmiş yılda o yıl kayıtlı olan herkes
  const { rows } = listStudents(db, c.is_current ? { classId: id, pageSize: 1000 } : { enrolledIn: id, pageSize: 1000 });

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/siniflar" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Sınıflar
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal">{c.name}</h1>
          <p className="mt-2 text-sm text-secondary">
            {[c.year, c.field, `OU ${c.org_unit_path}`, c.group_email && `Grup ${c.group_email}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {user.role !== "VIEWER" && c.is_current === 1 && rows.length > 0 && (
          <LinkButton href={`/siniflar/${id}/sifreler`} icon="password">
            Şifre listesi
          </LinkButton>
        )}
      </div>

      <TableContainer title={`${rows.length} öğrenci`}>
        <Table size="md" aria-label="Öğrenciler">
          <TableHead>
            <TableRow>
              <TableHeader>Okul no</TableHeader>
              <TableHeader>Ad Soyad</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Durum</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => {
              const st = ENTITY_STATUS[s.status] ?? { label: s.status, type: "gray" as const };
              return (
                <TableRow key={s.id}>
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
      </TableContainer>
    </div>
  );
}
