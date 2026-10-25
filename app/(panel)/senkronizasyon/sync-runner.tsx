"use client";

import {
  Button,
  InlineNotification,
  Modal,
  NumberInput,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile,
} from "@carbon/react";
import { Play, Search, StopFilled } from "@carbon/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format.ts";
import { ACTION_LABELS, outcomeLabel } from "@/lib/labels.ts";
import type { SyncRun } from "@/lib/sync/runner.ts";
import { runStatusAction, startRunAction, stopRunAction } from "./actions.ts";

const RUN_STATUS: Record<SyncRun["status"], { label: string; type: "blue" | "green" | "red" | "gray" }> = {
  RUNNING: { label: "Çalışıyor", type: "blue" },
  DONE: { label: "Bitti", type: "green" },
  FAILED: { label: "Hata", type: "red" },
  STOPPED: { label: "Durduruldu", type: "gray" },
};

export function SyncRunner({
  initialRun,
  ready,
  destructive,
  canRun,
  cliRunning,
}: {
  initialRun: SyncRun | null;
  /** Şimdi çalıştırılabilecek (bekleme süresi dolmuş) iş sayısı */
  ready: number;
  /** Bekleyen geri alınamaz işler: "Hesap silme" → 3 */
  destructive: Record<string, number>;
  canRun: boolean;
  cliRunning: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [limit, setLimit] = useState(20);
  const [confirm, setConfirm] = useState<"limit" | "all" | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const running = run?.status === "RUNNING";

  // Çalışırken ilerlemeyi takip et; bitince sayfadaki sayıları yenile
  useEffect(() => {
    if (!running || !run) return;
    const t = setInterval(async () => {
      const next = await runStatusAction(run.id);
      if (!next) return;
      setRun(next);
      if (next.status !== "RUNNING") router.refresh();
    }, 1000);
    return () => clearInterval(t);
  }, [running, run?.id, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (mode: "DRY" | "LIVE", n?: number) =>
    start(async () => {
      setError(undefined);
      const res = await startRunAction(mode, n);
      setConfirm(null);
      if (res.error) setError(res.error);
      else if (res.run) setRun(res.run);
    });

  const liveCount = confirm === "limit" ? Math.min(limit, ready) : ready;
  const busy = pending || running || cliRunning;

  return (
    <Tile className="mb-8">
      <h2 className="mb-2 text-lg">Kuyruğu çalıştırma</h2>
      <p className="mb-4 text-sm text-secondary">
        Önce deneme yapın: Google&apos;ın şu anki hali okunur ve hangi işin ne yapacağı listelenir, hiçbir şey değişmez.
        Sonra küçük bir partiyle başlayıp sonucu kontrol edin, ardından tümünü gönderin.
      </p>

      {cliRunning && !running && (
        <div className="mb-4">
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="Komut satırından bir senkronizasyon çalışıyor"
            subtitle="Bitince buradan çalıştırabilirsiniz."
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <InlineNotification kind="error" lowContrast title="Başlatılamadı" subtitle={error} onClose={() => setError(undefined)} />
        </div>
      )}

      {canRun && (
        <div className="flex flex-wrap items-end gap-4">
          <Button kind="secondary" renderIcon={Search} disabled={busy} onClick={() => begin("DRY")}>
            Deneme yap
          </Button>
          <div className="flex items-end">
            <NumberInput
              id="sync-limit"
              label="İş sayısı"
              min={1}
              max={10000}
              value={limit}
              onChange={(_, { value }) => setLimit(Math.max(1, Number(value) || 1))}
              size="lg"
              className="w-36"
            />
            <Button kind="tertiary" renderIcon={Play} disabled={busy || ready === 0} onClick={() => setConfirm("limit")}>
              İlk {Math.min(limit, ready) || limit} işi gönder
            </Button>
          </div>
          <Button renderIcon={Play} disabled={busy || ready === 0} onClick={() => setConfirm("all")}>
            Tümünü gönder ({ready.toLocaleString("tr-TR")})
          </Button>
        </div>
      )}

      {run && <RunView run={run} onStop={() => start(async () => await stopRunAction(run.id))} canRun={canRun} />}

      <Modal
        open={confirm !== null}
        modalHeading={`${liveCount.toLocaleString("tr-TR")} iş Google'a gönderilecek`}
        primaryButtonText={pending ? "Başlatılıyor…" : "Gönder"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => setConfirm(null)}
        onRequestSubmit={() => begin("LIVE", confirm === "limit" ? limit : undefined)}
      >
        <p className="mb-4">
          Hesaplar, gruplar ve OU&apos;lar Google Workspace&apos;te gerçekten oluşturulur, değiştirilir ya da silinir.
          Bu işlem geri alınamaz. Gönderme sırasında sayfadan ayrılabilirsiniz; işlem sunucuda devam eder.
        </p>
        {Object.keys(destructive).length > 0 && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Kuyrukta geri alınamaz işler var"
            subtitle={Object.entries(destructive)
              .map(([k, n]) => `${k}: ${n}`)
              .join(" · ")}
          />
        )}
      </Modal>
    </Tile>
  );
}

function RunView({ run, onStop, canRun }: { run: SyncRun; onStop: () => void; canRun: boolean }) {
  const dry = run.mode === "DRY";
  const status = RUN_STATUS[run.status];
  const r = run.report;

  return (
    <div className="mt-6 border-t border-subtle pt-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">{dry ? "Deneme" : "Gönderme"}</h3>
        <Tag type={status.type} size="sm">
          {status.label}
        </Tag>
        <span className="text-sm text-secondary">
          {formatDateTime(run.started_at)}
          {run.started_by_name ? ` · ${run.started_by_name}` : ""}
          {run.job_limit ? ` · en fazla ${run.job_limit} iş` : ""}
        </span>
      </div>

      {run.status === "RUNNING" && (
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <ProgressBar
              label={run.total == null ? (dry ? "Google okunuyor…" : "Başlıyor…") : `${run.processed} / ${run.total} iş`}
              value={run.total ? run.processed : undefined}
              max={run.total || undefined}
              helperText={run.stop_requested ? "Durduruluyor: çalışan iş bitince duracak" : undefined}
            />
          </div>
          {canRun && (
            <Button kind="danger--tertiary" size="md" renderIcon={StopFilled} disabled={Boolean(run.stop_requested)} onClick={onStop}>
              Durdur
            </Button>
          )}
        </div>
      )}

      {run.status === "FAILED" && (
        <InlineNotification kind="error" lowContrast hideCloseButton title="Çalıştırma tamamlanamadı" subtitle={run.error ?? ""} />
      )}

      {r && (
        <>
          <p className="mb-4 text-sm">
            {r.total.toLocaleString("tr-TR")} iş {dry ? "incelendi; Google'da hiçbir şey değişmedi" : "işlendi"}
            {run.status === "STOPPED" ? " (durduruldu)" : ""}. Başarılı {r.states.done}
            {r.states.failed ? ` · başarısız ${r.states.failed}` : ""}
            {r.states.retry ? ` · tekrar denenecek ${r.states.retry}` : ""}
            {r.states.deferred ? ` · önceki işi bekleyen ${r.states.deferred}` : ""}
          </p>
          {Object.keys(r.outcomes).length > 0 && (
            <Table size="sm" aria-label="Sonuçlar" className="mb-4">
              <TableHead>
                <TableRow>
                  <TableHeader>İşlem</TableHeader>
                  <TableHeader>Sonuç</TableHeader>
                  <TableHeader>Sayı</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(r.outcomes)
                  .sort()
                  .map(([key, n]) => {
                    const [action, outcome] = key.split(":");
                    return (
                      <TableRow key={key}>
                        <TableCell>{ACTION_LABELS[action] ?? action}</TableCell>
                        <TableCell>{outcomeLabel(action, outcome, dry)}</TableCell>
                        <TableCell className="tabular-nums">{n.toLocaleString("tr-TR")}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
          {r.failures.length > 0 && (
            <div className="border-l-4 border-support-error bg-layer-2 p-4 text-sm">
              <p className="mb-2 font-semibold">
                {dry ? `${r.failures.length} iş başarısız olacak` : `${r.failures.length} iş başarısız oldu`}
              </p>
              <ul className="space-y-1">
                {r.failures.slice(0, 20).map((f) => (
                  <li key={f.id}>
                    #{f.id} {ACTION_LABELS[f.action] ?? f.action} <span className="font-mono">{f.entity}</span>: {f.error}
                  </li>
                ))}
                {r.failures.length > 20 && <li>… ve {r.failures.length - 20} iş daha</li>}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
