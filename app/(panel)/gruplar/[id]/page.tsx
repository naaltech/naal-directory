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
import { GroupAliases } from "@/components/group-aliases.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { getTeacherGroup, groupDomains, groupTeacherCandidates, listGroupAliases, teacherLabel } from "@/lib/groups.ts";
import { ENTITY_STATUS, GROUP_ROLES } from "@/lib/labels.ts";
import { AddGroupTeacher, GroupSettings, MemberRole, RemoveGroupMember } from "./group-controls.tsx";

export const metadata: Metadata = { title: "Öğretmen grubu" };

function StatusTag({ status }: { status: string | null }) {
  const s = ENTITY_STATUS[status ?? ""];
  return s ? (
    <Tag type={s.type} size="sm">
      {s.label}
    </Tag>
  ) : null;
}

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const data = getTeacherGroup(db, id);
  if (!data) notFound();
  const { group: g, members } = data;
  const closed = g.status === "ARCHIVED" || g.status === "DELETED";
  const canEdit = user.role !== "VIEWER" && !closed;
  // ogretmenler@ grubunun üyeleri öğretmen eklenip ayrıldıkça kendiliğinden değişir
  const custom = g.kind === "CUSTOM";
  const aliases = listGroupAliases(db, g.id);
  const teacherOptions =
    canEdit && custom ? groupTeacherCandidates(db, g.id).map((t) => ({ id: t.id, label: teacherLabel(t) })) : [];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/gruplar" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Öğretmen grupları
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-normal">{g.name}</h1>
            {closed ? <Tag type="gray">Kapatıldı</Tag> : <StatusTag status={g.status} />}
          </div>
          <p className="mt-2 text-sm text-secondary">
            <span className="font-mono">{g.email}</span>
            {g.description ? ` · ${g.description}` : ""}
            {custom && ` · Dış e-posta ${g.allow_external ? "açık" : "kapalı"}`}
          </p>
        </div>
        {canEdit && custom && (
          <GroupSettings
            groupId={g.id}
            name={g.name}
            description={g.description}
            email={g.email}
            allowExternal={Boolean(g.allow_external)}
            members={members.length}
            aliases={aliases.length}
          />
        )}
      </div>

      <div className="space-y-8">
        <GroupAliases
          groupId={g.id}
          groupEmail={g.email}
          aliases={aliases}
          domains={groupDomains(db).map((d) => d.name)}
          canEdit={canEdit}
        />

        <TableContainer
          title={`${members.length} üye`}
          description={
            custom
              ? "Yönetici, Google'da grubun üyelerini yönetebilir ve mesajları denetleyebilir. Ayrılan öğretmen gruptan kendiliğinden çıkar."
              : "Okuldaki bütün öğretmenler bu gruptadır; öğretmen eklendikçe ve ayrıldıkça güncellenir."
          }
        >
          {canEdit && custom && <AddGroupTeacher groupId={g.id} teachers={teacherOptions} />}
          <Table size="md" aria-label="Üyeler">
            <TableHead>
              <TableRow>
                <TableHeader>Öğretmen</TableHeader>
                <TableHeader>Branş</TableHeader>
                <TableHeader>E-posta</TableHeader>
                <TableHeader>Rol</TableHeader>
                <TableHeader>Grup üyeliği</TableHeader>
                {canEdit && custom && <TableHeader aria-label="İşlem" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-secondary">
                    Üye yok.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/ogretmenler/${m.teacher_id}`} className="text-interactive hover:underline">
                      {m.first_name} {m.last_name}
                    </Link>
                  </TableCell>
                  <TableCell>{m.branch ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{m.email}</TableCell>
                  <TableCell>
                    {canEdit && custom ? (
                      <MemberRole groupId={g.id} memberId={m.id} role={m.role as "MEMBER" | "MANAGER"} />
                    ) : (
                      (GROUP_ROLES[m.role] ?? m.role)
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusTag status={m.status} />
                  </TableCell>
                  {canEdit && custom && (
                    <TableCell className="text-right">
                      <RemoveGroupMember groupId={g.id} memberId={m.id} name={`${m.first_name} ${m.last_name}`} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}
