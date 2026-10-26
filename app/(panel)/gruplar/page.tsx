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
import { getDb } from "@/lib/db.ts";
import { groupDomains, listTeacherGroups } from "@/lib/groups.ts";
import { ENTITY_STATUS } from "@/lib/labels.ts";
import { NewGroup } from "./new-group.tsx";

export const metadata: Metadata = { title: "Öğretmen grupları" };

export default async function GroupsPage() {
  const user = await requireUser();
  const db = getDb();
  const groups = listTeacherGroups(db);
  const domains = groupDomains(db).map((d) => d.name);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Öğretmen grupları"
        description={`İdareciler, rehberlik, zümreler gibi öğretmen grupları. Grup adresi ve alt adresler ${domains.join(" ya da ")} alan adında olabilir.`}
        actions={user.role !== "VIEWER" && <NewGroup domains={domains} />}
      />
      <TableContainer title={`${groups.length} grup`}>
        <Table size="md" aria-label="Öğretmen grupları">
          <TableHead>
            <TableRow>
              <TableHeader>Grup</TableHeader>
              <TableHeader>Adres</TableHeader>
              <TableHeader>Alt adresler</TableHeader>
              <TableHeader>Üye</TableHeader>
              <TableHeader>Dış e-posta</TableHeader>
              <TableHeader>Durum</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-secondary">
                  Henüz grup yok.
                </TableCell>
              </TableRow>
            )}
            {groups.map((g) => {
              const st = ENTITY_STATUS[g.status] ?? { label: g.status, type: "gray" as const };
              return (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link href={`/gruplar/${g.id}`} className="text-interactive hover:underline">
                      {g.name}
                    </Link>
                    {g.kind === "TEACHERS" && <span className="text-xs text-secondary"> · tüm öğretmenler</span>}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{g.email}</TableCell>
                  <TableCell className="font-mono text-sm">{g.aliases ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {g.members}
                    {g.managers > 0 && <span className="text-xs text-secondary"> ({g.managers} yönetici)</span>}
                  </TableCell>
                  <TableCell>{g.kind === "TEACHERS" ? "—" : g.allow_external ? "Açık" : "Kapalı"}</TableCell>
                  <TableCell>
                    <Tag type={st.type} size="sm">
                      {g.status === "ARCHIVED" ? "Kapatıldı" : st.label}
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
