import type { Metadata } from "next";
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
import { PageHeader } from "@/components/page-header.tsx";
import { requireUser } from "@/lib/auth/server.ts";
import { getDb } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import { ACTION_LABELS } from "@/lib/labels.ts";
import { cliLockHeld, latestRun } from "@/lib/sync/runner.ts";
import { queueCounts } from "@/lib/sync/worker.ts";
import { RetryButton } from "./retry-button.tsx";
import { SyncRunner } from "./sync-runner.tsx";

export const metadata: Metadata = { title: "Senkronizasyon" };

const STATUSES = [
  { key: "QUEUED", label: "Bekleyen", type: "blue" },
  { key: "RUNNING", label: "Çalışan", type: "purple" },
  { key: "DONE", label: "Tamam", type: "green" },
  { key: "FAILED", label: "Başarısız", type: "red" },
] as const;

interface FailedJob {
  id: number;
  action: string;
  target: string | null;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

export default async function SyncPage() {
  const user = await requireUser();
  const db = getDb();
  const counts = queueCounts(db);
  const byAction = new Map<string, Record<string, number>>();
  for (const c of counts) byAction.set(c.action, { ...byAction.get(c.action), [c.status]: c.n });
  const total = (status: string) => counts.filter((c) => c.status === status).reduce((a, c) => a + c.n, 0);

  const failed = db
    .prepare(
      `SELECT id, action, attempts, last_error, updated_at,
              COALESCE(json_extract(payload, '$.memberEmail'), json_extract(payload, '$.email'), entity_id) AS target
       FROM sync_jobs WHERE status = 'FAILED' ORDER BY id LIMIT 100`,
    )
    .all() as FailedJob[];
  const lastDone = db.prepare("SELECT max(updated_at) FROM sync_jobs WHERE status = 'DONE'").pluck().get() as string | null;
  const run = latestRun(db);
  // Panelden başlatılan gerçek çalıştırma da aynı kilidi tutar; o zaman "komut satırı" sayılmaz
  const cliRunning = cliLockHeld(db) && !(run?.status === "RUNNING" && run.mode === "LIVE");
  const ready = db
    .prepare("SELECT count(*) FROM sync_jobs WHERE status = 'QUEUED' AND run_after <= datetime('now')")
    .pluck()
    .get() as number;
  const destructive = Object.fromEntries(
    (
      db
        .prepare(
          `SELECT action, count(*) AS n FROM sync_jobs WHERE status = 'QUEUED'
             AND action IN ('DELETE_USER', 'SUSPEND_USER', 'DELETE_GROUP', 'DELETE_ORG_UNIT') GROUP BY action`,
        )
        .all() as { action: string; n: number }[]
    ).map((r) => [ACTION_LABELS[r.action] ?? r.action, r.n]),
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Senkronizasyon"
        description="Google'a giden işlemler bu kuyruktan sırayla gönderilir: önce OU'lar, sonra gruplar, hesaplar ve grup üyelikleri."
      />

      <div className="mb-8 grid grid-cols-2 gap-px bg-subtle lg:grid-cols-4">
        {STATUSES.map((s) => (
          <Tile key={s.key} className="!min-h-0">
            <p className="text-sm text-secondary">{s.label}</p>
            <p
              className={`mt-4 text-3xl font-light tabular-nums ${s.key === "FAILED" && total(s.key) ? "text-support-error" : ""}`}
            >
              {total(s.key).toLocaleString("tr-TR")}
            </p>
          </Tile>
        ))}
      </div>

      <SyncRunner
        key={run?.id ?? 0}
        initialRun={run ?? null}
        ready={ready}
        destructive={destructive}
        canRun={user.role !== "VIEWER"}
        cliRunning={cliRunning}
      />
      <p className="-mt-6 mb-8 text-xs text-helper">
        Son tamamlanan iş: {formatDateTime(lastDone)}. Sunucuda komut satırından da çalıştırılabilir:{" "}
        <code className="font-mono">npm run sync</code> (deneme), <code className="font-mono">npm run sync -- --yes</code>.
      </p>

      <TableContainer title="İşler" description={counts.length ? undefined : "Kuyruk boş."}>
        {counts.length > 0 && (
          <Table aria-label="İşler" size="md">
            <TableHead>
              <TableRow>
                <TableHeader>İşlem</TableHeader>
                {STATUSES.map((s) => (
                  <TableHeader key={s.key}>{s.label}</TableHeader>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {[...byAction].map(([action, n]) => (
                <TableRow key={action}>
                  <TableCell>{ACTION_LABELS[action] ?? action}</TableCell>
                  {STATUSES.map((s) => (
                    <TableCell key={s.key} className="tabular-nums">
                      {n[s.key] ? (
                        <Tag type={s.type} size="sm">
                          {n[s.key].toLocaleString("tr-TR")}
                        </Tag>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableContainer>

      {failed.length > 0 && (
        <div className="mt-8">
          <TableContainer
            title="Başarısız işler"
            description="Çakışma gibi kalıcı hatalar düzeltilmeden yeniden denemek aynı sonucu verir."
          >
            {user.role !== "VIEWER" && (
              <div className="flex justify-end px-4 pb-4">
                <RetryButton count={total("FAILED")} />
              </div>
            )}
            <Table aria-label="Başarısız işler" size="md">
              <TableHead>
                <TableRow>
                  <TableHeader>#</TableHeader>
                  <TableHeader>İşlem</TableHeader>
                  <TableHeader>Hedef</TableHeader>
                  <TableHeader>Deneme</TableHeader>
                  <TableHeader>Hata</TableHeader>
                  <TableHeader>Zaman</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {failed.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="tabular-nums">{j.id}</TableCell>
                    <TableCell>{ACTION_LABELS[j.action] ?? j.action}</TableCell>
                    <TableCell className="font-mono text-sm">{j.target}</TableCell>
                    <TableCell className="tabular-nums">{j.attempts}</TableCell>
                    <TableCell className="text-sm">{j.last_error}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(j.updated_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </div>
  );
}
