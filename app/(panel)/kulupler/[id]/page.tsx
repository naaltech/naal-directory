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
import { requireUser } from "@/lib/auth/server.ts";
import { advisorCandidates, clubDomain, getClub } from "@/lib/clubs.ts";
import { getDb } from "@/lib/db.ts";
import { ENTITY_STATUS, formatDate, OFFICER_TITLES } from "@/lib/labels.ts";
import { AddMember, AssignAdvisor, AssignOfficer, ClubSettings, EndAdvisor, EndOfficer, RemoveMember } from "./club-controls.tsx";

export const metadata: Metadata = { title: "Kulüp" };

function StatusTag({ status }: { status: string | null }) {
  const s = ENTITY_STATUS[status ?? ""];
  return s ? (
    <Tag type={s.type} size="sm">
      {s.label}
    </Tag>
  ) : null;
}

export default async function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const data = getClub(db, id);
  if (!data) notFound();
  const { club, officers, pastOfficers, members, advisors } = data;
  const canEdit = user.role !== "VIEWER" && club.is_active === 1;
  const domain = clubDomain(db).name;
  const activeAdvisors = advisors.filter((a) => !a.ended_at);
  const teacherOptions = canEdit
    ? advisorCandidates(db, club.id).map((t) => ({
        id: t.id,
        label: `${t.first_name} ${t.last_name}${t.branch ? ` · ${t.branch}` : ""}`,
      }))
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/kulupler" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Kulüpler
      </Link>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-normal">{club.name}</h1>
            {club.is_active ? <StatusTag status={club.group_status} /> : <Tag type="gray">Kapatıldı</Tag>}
          </div>
          <p className="mt-2 text-sm text-secondary">
            <span className="font-mono">{club.email}</span>
            {club.description ? ` · ${club.description}` : ""}
          </p>
        </div>
        {canEdit && club.email && (
          <ClubSettings
            clubId={club.id}
            name={club.name}
            description={club.description}
            email={club.email}
            officers={officers.length}
            members={members.length}
          />
        )}
      </div>

      <div className="space-y-8">
        <TableContainer
          title="Danışman öğretmenler"
          description={`Danışman, ${club.email ?? "kulüp grubu"} grubuna yönetici olarak eklenir: üyeleri yönetebilir, mesajları denetleyebilir.`}
        >
          {canEdit && <AssignAdvisor clubId={club.id} teachers={teacherOptions} />}
          <Table size="md" aria-label="Danışman öğretmenler">
            <TableHead>
              <TableRow>
                <TableHeader>Öğretmen</TableHeader>
                <TableHeader>Branş</TableHeader>
                <TableHeader>E-posta</TableHeader>
                <TableHeader>Grup yöneticiliği</TableHeader>
                <TableHeader>Başlangıç</TableHeader>
                {canEdit && <TableHeader aria-label="İşlem" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {activeAdvisors.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 6 : 5} className="text-secondary">
                    Danışman atanmamış.
                  </TableCell>
                </TableRow>
              )}
              {activeAdvisors.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/ogretmenler/${a.teacher_id}`} className="text-interactive hover:underline">
                      {a.first_name} {a.last_name}
                    </Link>
                  </TableCell>
                  <TableCell>{a.branch ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{a.email}</TableCell>
                  <TableCell>
                    <StatusTag status={a.member_status} />
                  </TableCell>
                  <TableCell>{formatDate(a.started_at)}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <EndAdvisor clubId={club.id} advisorId={a.id} name={`${a.first_name} ${a.last_name}`} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer
          title="Yönetim kadrosu"
          description={`Takma adlar (isim@${domain}) öğrencinin kendi hesabına eklenir.`}
        >
          {canEdit && (
            <div className="flex justify-end px-4 pb-4">
              <AssignOfficer clubId={club.id} domain={domain} />
            </div>
          )}
          <Table size="md" aria-label="Yönetim kadrosu">
            <TableHead>
              <TableRow>
                <TableHeader>Görev</TableHeader>
                <TableHeader>Öğrenci</TableHeader>
                <TableHeader>Takma ad</TableHeader>
                <TableHeader>Durum</TableHeader>
                <TableHeader>Başlangıç</TableHeader>
                {canEdit && <TableHeader aria-label="İşlem" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {officers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 6 : 5} className="text-secondary">
                    Görevli yok.
                  </TableCell>
                </TableRow>
              )}
              {officers.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>{OFFICER_TITLES[o.title]}</TableCell>
                  <TableCell>
                    <Link href={`/ogrenciler/${o.student_id}`} className="text-interactive hover:underline">
                      {o.first_name} {o.last_name}
                    </Link>
                    {o.class_name && <span className="text-xs text-secondary"> · {o.class_name}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{o.alias_email}</TableCell>
                  <TableCell>
                    <StatusTag status={o.status} />
                  </TableCell>
                  <TableCell>{formatDate(o.started_at)}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <EndOfficer
                        clubId={club.id}
                        officerId={o.id}
                        name={`${o.first_name} ${o.last_name}`}
                        alias={o.alias_email}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer title={`${members.length} üye`} description={`Üyeler ${club.email} grubuna eklenir.`}>
          {canEdit && <AddMember clubId={club.id} />}
          <Table size="md" aria-label="Üyeler">
            <TableHead>
              <TableRow>
                <TableHeader>Şube</TableHeader>
                <TableHeader>Ad Soyad</TableHeader>
                <TableHeader>E-posta</TableHeader>
                <TableHeader>Grup üyeliği</TableHeader>
                {canEdit && <TableHeader aria-label="İşlem" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 5 : 4} className="text-secondary">
                    Üye yok.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.class_name ?? "—"}</TableCell>
                  <TableCell>
                    <Link href={`/ogrenciler/${m.id}`} className="text-interactive hover:underline">
                      {m.first_name} {m.last_name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{m.email}</TableCell>
                  <TableCell>
                    <StatusTag status={m.member_status} />
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <RemoveMember clubId={club.id} studentId={m.id} name={`${m.first_name} ${m.last_name}`} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {advisors.some((a) => a.ended_at) && (
          <TableContainer title="Önceki danışmanlar">
            <Table size="sm" aria-label="Önceki danışmanlar">
              <TableHead>
                <TableRow>
                  <TableHeader>Öğretmen</TableHeader>
                  <TableHeader>Dönem</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {advisors
                  .filter((a) => a.ended_at)
                  .map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link href={`/ogretmenler/${a.teacher_id}`} className="text-interactive hover:underline">
                          {a.first_name} {a.last_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {formatDate(a.started_at)} – {formatDate(a.ended_at)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {pastOfficers.length > 0 && (
          <TableContainer title="Önceki görevliler">
            <Table size="sm" aria-label="Önceki görevliler">
              <TableHead>
                <TableRow>
                  <TableHeader>Görev</TableHeader>
                  <TableHeader>Öğrenci</TableHeader>
                  <TableHeader>Takma ad</TableHeader>
                  <TableHeader>Dönem</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {pastOfficers.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{OFFICER_TITLES[o.title]}</TableCell>
                    <TableCell>
                      <Link href={`/ogrenciler/${o.student_id}`} className="text-interactive hover:underline">
                        {o.first_name} {o.last_name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{o.alias_email}</TableCell>
                    <TableCell>
                      {formatDate(o.started_at)} – {formatDate(o.ended_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>
    </div>
  );
}
