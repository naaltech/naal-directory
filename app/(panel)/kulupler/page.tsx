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
import { requireUser } from "@/lib/auth/server.ts";
import { clubDomain, listClubs } from "@/lib/clubs.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS } from "@/lib/labels.ts";
import { NewClub } from "./new-club.tsx";

export const metadata: Metadata = { title: "Kulüpler" };

export default async function ClubsPage() {
  const user = await requireUser();
  const db = getDb();
  const clubs = listClubs(db);
  const domain = clubDomain(db).name;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Kulüpler"
        description={`Her kulübün bir grubu (kulupkodu@${domain}) vardır. Yönetim kadrosuna ayrı hesap açılmaz; öğrencinin hesabına isim@${domain} takma adı eklenir.`}
        actions={user.role !== "VIEWER" && <NewClub domain={domain} />}
      />
      <TableContainer title={`${clubs.length} kulüp`}>
        <Table size="md" aria-label="Kulüpler">
          <TableHead>
            <TableRow>
              <TableHeader>Kulüp</TableHeader>
              <TableHeader>Grup adresi</TableHeader>
              <TableHeader>Danışman</TableHeader>
              <TableHeader>Üye</TableHeader>
              <TableHeader>Görevli</TableHeader>
              <TableHeader>Durum</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {clubs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-secondary">
                  Henüz kulüp yok.
                </TableCell>
              </TableRow>
            )}
            {clubs.map((k) => {
              const gs = !k.is_active
                ? { label: "Kapatıldı", type: "gray" as const }
                : (ENTITY_STATUS[k.group_status ?? ""] ?? { label: "—", type: "gray" as const });
              return (
                <TableRow key={k.id}>
                  <TableCell>
                    <Link href={`/kulupler/${k.id}`} className="text-interactive hover:underline">
                      {k.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{k.email}</TableCell>
                  <TableCell>{k.advisors ?? (k.is_active ? <span className="text-support-warning">Atanmamış</span> : "—")}</TableCell>
                  <TableCell className="tabular-nums">{k.members}</TableCell>
                  <TableCell className="tabular-nums">{k.officers}</TableCell>
                  <TableCell>
                    <Tag type={gs.type} size="sm">
                      {gs.label}
                    </Tag>
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
