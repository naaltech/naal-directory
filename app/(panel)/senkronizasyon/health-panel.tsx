import { Tag, Tile } from "@carbon/react";
import type { Check } from "@/lib/alerts.ts";
import { sqlDate } from "@/lib/db.ts";
import { formatDateTime } from "@/lib/format.ts";
import type { FindingKind, ReconcileReport } from "@/lib/reconcile.ts";
import { AutoButton } from "./auto-button.tsx";

const LEVELS = {
  ok: { label: "İyi", type: "green" },
  warn: { label: "Uyarı", type: "warm-gray" },
  fail: { label: "Sorun", type: "red" },
} as const;

const FINDINGS: Record<FindingKind, string> = {
  missing: "Google'da yok",
  ouMismatch: "OU farklı",
  suspendMismatch: "Askı durumu farklı",
  unmanaged: "Veritabanında yok",
  groupMissing: "Grup Google'da yok",
};

export function HealthPanel({ checks, paused, canControl, reconcile }: { checks: Check[]; paused: boolean; canControl: boolean; reconcile?: ReconcileReport }) {
  return (
    <div className="mb-8">
      <Tile className="!min-h-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-base font-semibold">Sistem durumu</h2>
          {canControl && <AutoButton paused={paused} />}
        </div>
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-sm">
              <Tag type={LEVELS[c.level].type} size="sm">
                {LEVELS[c.level].label}
              </Tag>
              {c.message}
            </li>
          ))}
        </ul>
        {reconcile && reconcile.items.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer">
              Google ile farklar ({reconcile.total}, {formatDateTime(sqlDate(new Date(reconcile.at)))})
            </summary>
            <ul className="mt-2 space-y-1">
              {reconcile.items.map((item) => (
                <li key={`${item.kind}:${item.target}`}>
                  {FINDINGS[item.kind]}: <span className="font-mono">{item.target}</span>. {item.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Tile>
    </div>
  );
}
