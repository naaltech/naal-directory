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
import { RevealPassword } from "@/components/reveal-password.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import { ACTION_LABELS, ENTITY_STATUS, formatDate, JOB_STATUS } from "@/lib/labels.ts";
import { pendingJobs } from "@/lib/sync/queue.ts";
import { getTeacher, teacherRetentionDays } from "@/lib/teachers.ts";
import { TeacherControls } from "./teacher-controls.tsx";

export const metadata: Metadata = { title: "Öğretmen" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-secondary">{label}</dt>
      <dd className="mt-1 text-sm break-all">{children}</dd>
    </div>
  );
}

export default async function TeacherPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const data = getTeacher(db, id);
  if (!data) notFound();
  const { teacher: t, groups } = data;
  const jobs = pendingJobs(db, "teacher", id);
  const st = ENTITY_STATUS[t.status] ?? { label: t.status, type: "gray" as const };
  const days = teacherRetentionDays(db);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/ogretmenler" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Öğretmenler
      </Link>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-normal">
            {t.first_name} {t.last_name}
          </h1>
          <Tag type={st.type}>{st.label}</Tag>
          {t.left_at && <Tag type="gray">Ayrıldı</Tag>}
        </div>
        {user.role !== "VIEWER" && t.status !== "DELETED" && (
          <TeacherControls
            id={t.id}
            firstName={t.first_name}
            lastName={t.last_name}
            branch={t.branch}
            left={Boolean(t.left_at)}
            canUndo={!t.suspended_at && t.status !== "SUSPENDED"}
            suspendDays={days.suspend}
            deleteDays={days.remove}
          />
        )}
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <Tile className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Field label="E-posta">
              <span className="font-mono">{t.email}</span>
            </Field>
            <Field label="Branş">{t.branch ?? "—"}</Field>
            <Field label="OU">
              <span className="font-mono">{t.org_unit_path}</span>
            </Field>
            <Field label="Google'a son eşitleme">{formatDateTime(t.last_synced_at)}</Field>
            <Field label="Eklenme">{formatDate(t.created_at)}</Field>
            {t.left_at && (
              <>
                <Field label="Ayrılış">{formatDate(t.left_at)}</Field>
                <Field label="Askıya alınma">{t.suspended_at ? formatDate(t.suspended_at) : `${formatDate(t.suspend_at)} (planlı)`}</Field>
                <Field label="Silinme (planlı)">{formatDate(t.delete_at)}</Field>
              </>
            )}
          </dl>
        </Tile>
        <Tile>
          <h2 className="mb-2 text-base">İlk şifre</h2>
          <p className="mb-4 text-xs text-helper">Öğretmen ilk girişte şifresini değiştirir. Görüntüleme kayda geçer.</p>
          {user.role === "VIEWER" ? (
            <p className="text-sm text-secondary">Görüntüleyici rolü şifre göremez.</p>
          ) : t.has_password ? (
            <RevealPassword teacherId={t.id} />
          ) : (
            <p className="text-sm text-secondary">Kayıtlı ilk şifre yok.</p>
          )}
        </Tile>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
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
                    Grup üyeliği yok.
                  </TableCell>
                </TableRow>
              )}
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-mono text-sm">{g.email}</TableCell>
                  <TableCell>{ENTITY_STATUS[g.status]?.label ?? g.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer title="Google işleri">
          <Table size="sm" aria-label="Google işleri">
            <TableHead>
              <TableRow>
                <TableHeader>İşlem</TableHeader>
                <TableHeader>Durum</TableHeader>
                <TableHeader>Tarih</TableHeader>
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
                    <TableCell>
                      {ACTION_LABELS[j.action] ?? j.action}
                      {j.last_error && <p className="mt-1 text-xs text-support-error">{j.last_error}</p>}
                    </TableCell>
                    <TableCell>
                      <Tag type={js.type} size="sm">
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
