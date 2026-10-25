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
  Tag,
} from "@carbon/react";
import { PageHeader } from "@/components/page-header.tsx";
import { UrlDropdown } from "@/components/url-controls.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { currentYear, listClasses, listedYears } from "@/lib/classes.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS } from "@/lib/labels.ts";

export const metadata: Metadata = { title: "Sınıflar" };

export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ yil?: string }> }) {
  await requireUser();
  const db = getDb();
  const current = currentYear(db);
  const years = listedYears(db);
  const { yil } = await searchParams;
  const picked = years.find((y) => String(y.id) === yil && !y.is_current);
  const year = picked ?? current;
  const classes = listClasses(db, year?.id);
  const grades = [...new Set(classes.map((c) => c.grade))];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Sınıflar"
        description={`${year?.name ?? "Güncel yıl yok"} şubeleri${picked ? " (geçmiş yıl)" : ""}. Güncel yıl, onaylanan son listenin yılıdır. Sınıf grubu adresi yıllar boyunca aynı kalır, sadece üyeleri değişir.`}
        actions={
          years.filter((y) => !y.is_current).length > 0 && (
            <div className="w-56">
              <UrlDropdown
                name="yil"
                label="Eğitim yılı"
                allLabel={`${current?.name ?? "Güncel yıl"} (güncel)`}
                options={years.filter((y) => !y.is_current).map((y) => ({ value: String(y.id), label: y.name }))}
              />
            </div>
          )
        }
      />
      {classes.length === 0 && (
        <p className="text-sm text-secondary">Henüz şube yok. Liste içe aktarıp onaylayınca şubeler oluşur.</p>
      )}
      <div className="space-y-8">
        {grades.map((grade) => (
          <TableContainer key={grade} title={`${grade}. sınıflar`}>
            <Table size="md" aria-label={`${grade}. sınıflar`}>
              <TableHead>
                <TableRow>
                  <TableHeader>Şube</TableHeader>
                  <TableHeader>Alan</TableHeader>
                  <TableHeader>Öğrenci</TableHeader>
                  <TableHeader>Sınıf grubu</TableHeader>
                  <TableHeader>OU</TableHeader>
                  <TableHeader>Hesaplar</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {classes
                  .filter((c) => c.grade === grade)
                  .map((c) => {
                    const gs = c.group_status ? ENTITY_STATUS[c.group_status] : undefined;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link href={`/siniflar/${c.id}`} className="text-interactive hover:underline">
                            {c.name}
                          </Link>
                        </TableCell>
                        <TableCell>{c.field ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{c.students}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="font-mono text-sm">{c.group_email ?? "—"}</span>{" "}
                          {gs && c.group_status !== "ACTIVE" && (
                            <Tag type={gs.type} size="sm">
                              {gs.label}
                            </Tag>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{c.org_unit_path}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {c.active > 0 && (
                            <Tag type="green" size="sm">
                              {c.active} aktif
                            </Tag>
                          )}
                          {c.pending > 0 && (
                            <Tag type="blue" size="sm">
                              {c.pending} bekliyor
                            </Tag>
                          )}
                          {c.errors > 0 && (
                            <Tag type="red" size="sm">
                              {c.errors} hata
                            </Tag>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </TableContainer>
        ))}
      </div>
    </div>
  );
}
