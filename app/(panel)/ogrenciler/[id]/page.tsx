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
  Tile,
} from "@carbon/react";
import { ArrowLeft } from "@carbon/icons-react";
import { ChangeEmail } from "@/components/change-email.tsx";
import { ResetPassword } from "@/components/reset-password.tsx";
import { RevealPassword } from "@/components/reveal-password.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import { ACTION_LABELS, ENTITY_STATUS, EXIT_REASON, formatDate, JOB_STATUS, OFFICER_TITLES } from "@/lib/labels.ts";
import { getStudent } from "@/lib/students.ts";
import { pendingJobs } from "@/lib/sync/queue.ts";
import { LeaveControls } from "./leave-controls.tsx";

export const metadata: Metadata = { title: "Öğrenci" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="mt-1 text-sm break-all">{children}</dd>
    </div>
  );
}

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const data = getStudent(db, id);
  if (!data) notFound();
  const { student: s, enrollments, groups, roles } = data;
  const jobs = pendingJobs(db, "student", id);
  const st = ENTITY_STATUS[s.status] ?? { label: s.status, type: "gray" as const };

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/ogrenciler" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Öğrenciler
      </Link>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-normal">
            {s.first_name} {s.last_name}
          </h1>
          <Tag type={st.type}>{st.label}</Tag>
          {s.exit_reason && <Tag type="gray">{EXIT_REASON[s.exit_reason]}</Tag>}
        </div>
        {user.role !== "VIEWER" && s.status !== "DELETED" && (
          <LeaveControls
            studentId={s.id}
            name={`${s.first_name} ${s.last_name}`}
            exited={Boolean(s.exit_reason)}
            canUndo={!s.suspended_at && s.status !== "SUSPENDED"}
          />
        )}
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <Tile className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Field label="E-posta">
              <span className="font-mono">{s.email}</span>
              {user.role !== "VIEWER" && s.status !== "DELETED" && s.status !== "ARCHIVED" && <ChangeEmail email={s.email} studentId={s.id} />}
            </Field>
            <Field label="Okul no">{s.school_no}</Field>
            <Field label="Şube">
              {s.class_id ? (
                <Link href={`/siniflar/${s.class_id}`} className="text-interactive hover:underline">
                  {s.class_name}
                </Link>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Cinsiyet">{s.gender === "F" ? "Kız" : s.gender === "M" ? "Erkek" : "—"}</Field>
            <Field label="OU">
              <span className="font-mono">{s.org_unit_path}</span>
            </Field>
            <Field label="Google'a son eşitleme">{formatDateTime(s.last_synced_at)}</Field>
            {s.exit_reason && (
              <>
                <Field label={s.exit_reason === "GRADUATED" ? "Mezuniyet" : "Ayrılış"}>
                  {formatDate(s.graduated_at ?? s.left_at)}
                </Field>
                <Field label="Askıya alınma">{s.suspended_at ? formatDate(s.suspended_at) : `${formatDate(s.suspend_at)} (planlı)`}</Field>
                <Field label="Silinme (planlı)">{formatDate(s.delete_at)}</Field>
              </>
            )}
          </dl>
        </Tile>
        <Tile>
          <h2 className="mb-2 text-base">İlk şifre</h2>
          <p className="mb-4 text-xs text-helper">
            Öğrenci ilk girişte şifresini değiştirir. Görüntüleme kayda geçer.
          </p>
          {user.role === "VIEWER" ? (
            <p className="text-sm text-secondary">Görüntüleyici rolü şifre göremez.</p>
          ) : (
            <div className="space-y-3">
              {s.has_password ? <RevealPassword studentId={s.id} /> : <p className="text-sm text-secondary">Kayıtlı ilk şifre yok.</p>}
              {!["DELETED", "ARCHIVED", "SUSPENDED"].includes(s.status) && (
                <ResetPassword studentId={s.id} live={Boolean(s.google_user_id)} />
              )}
            </div>
          )}
        </Tile>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <TableContainer title="Şube geçmişi">
          <Table size="sm" aria-label="Şube geçmişi">
            <TableHead>
              <TableRow>
                <TableHeader>Eğitim yılı</TableHeader>
                <TableHeader>Şube</TableHeader>
                <TableHeader>Okul no</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {enrollments.map((e) => (
                <TableRow key={e.year}>
                  <TableCell>{e.year}</TableCell>
                  <TableCell>
                    <Link href={`/siniflar/${e.class_id}`} className="text-interactive hover:underline">
                      {e.class_name}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{e.school_no}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer title="Gruplar">
          <Table size="sm" aria-label="Gruplar">
            <TableHead>
              <TableRow>
                <TableHeader>Grup</TableHeader>
                <TableHeader>Durum</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-secondary">
                    Grup yok.
                  </TableCell>
                </TableRow>
              )}
              {groups.map((g) => {
                const gs = ENTITY_STATUS[g.status] ?? { label: g.status, type: "gray" as const };
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-sm">{g.email}</TableCell>
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

        {roles.length > 0 && (
          <TableContainer title="Kulüp görevleri">
            <Table size="sm" aria-label="Kulüp görevleri">
              <TableHead>
                <TableRow>
                  <TableHeader>Kulüp</TableHeader>
                  <TableHeader>Görev</TableHeader>
                  <TableHeader>Takma ad</TableHeader>
                  <TableHeader>Dönem</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/kulupler/${r.club_id}`} className="text-interactive hover:underline">
                        {r.club_name}
                      </Link>
                    </TableCell>
                    <TableCell>{OFFICER_TITLES[r.title]}</TableCell>
                    <TableCell className="font-mono text-sm">{r.alias_email}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(r.started_at)} – {r.ended_at ? formatDate(r.ended_at) : "devam ediyor"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <TableContainer title="Google işleri" description="Bu öğrenci için kuyruğa alınan son işler">
          <Table size="sm" aria-label="Google işleri">
            <TableHead>
              <TableRow>
                <TableHeader>İşlem</TableHeader>
                <TableHeader>Durum</TableHeader>
                <TableHeader>Zaman</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-secondary">
                    İş yok.
                  </TableCell>
                </TableRow>
              )}
              {jobs.map((j) => {
                const js = JOB_STATUS[j.status] ?? { label: j.status, type: "gray" as const };
                return (
                  <TableRow key={j.id}>
                    <TableCell>{ACTION_LABELS[j.action] ?? j.action}</TableCell>
                    <TableCell>
                      <Tag type={js.type} size="sm" title={j.last_error ?? undefined}>
                        {js.label}
                      </Tag>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(j.created_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}
