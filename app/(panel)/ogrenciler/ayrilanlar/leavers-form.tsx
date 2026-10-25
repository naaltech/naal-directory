"use client";

import {
  Button,
  Checkbox,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import { Checkmark } from "@carbon/icons-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ExitReason, LeaverCandidate } from "@/lib/leavers.ts";
import { markLeaversAction } from "../actions.ts";

export function LeaversForm({ rows, canEdit }: { rows: LeaverCandidate[]; canEdit: boolean }) {
  const [selected, setSelected] = useState(() => new Set(rows.map((r) => r.id)));
  const [reasons, setReasons] = useState<Record<number, ExitReason>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.suggested])),
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const chosen = rows.filter((r) => selected.has(r.id));
  const grads = chosen.filter((r) => reasons[r.id] === "GRADUATED").length;
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <TableContainer
        title={`${rows.length} ayrılan adayı`}
        description="Yanlışlıkla listede olmayanların işaretini kaldırın; onlar okulda kalır."
      >
        {canEdit && (
          <div className="flex justify-end px-4 pb-4">
            <Button renderIcon={Checkmark} disabled={chosen.length === 0} onClick={() => setOpen(true)}>
              {chosen.length} öğrenciyi ayrılmış olarak işaretle
            </Button>
          </div>
        )}
        <Table size="md" aria-label="Ayrılan adayları">
          <TableHead>
            <TableRow>
              <TableHeader>
                <Checkbox
                  id="all"
                  labelText="Tümü"
                  hideLabel
                  checked={selected.size === rows.length}
                  indeterminate={selected.size > 0 && selected.size < rows.length}
                  onChange={(_, { checked }) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())}
                  disabled={!canEdit}
                />
              </TableHeader>
              <TableHeader>Son şube</TableHeader>
              <TableHeader>Neden aday</TableHeader>
              <TableHeader>Ad Soyad</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Ayrılış</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Checkbox
                    id={`s-${r.id}`}
                    labelText={`${r.first_name} ${r.last_name}`}
                    hideLabel
                    checked={selected.has(r.id)}
                    onChange={(_, { checked }) => toggle(r.id, checked)}
                    disabled={!canEdit}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {r.last_class} <span className="text-xs text-secondary">({r.last_year})</span>
                </TableCell>
                <TableCell className="text-sm">
                  {r.kind === "dropped"
                    ? "Şubesinin yeni listesinde yok"
                    : r.expected_grade > 12
                      ? "Mezuniyet yılı geçmiş"
                      : `Bu yıl ${r.expected_grade}. sınıfta olmalıydı`}
                </TableCell>
                <TableCell>
                  <Link href={`/ogrenciler/${r.id}`} className="text-interactive hover:underline">
                    {r.first_name} {r.last_name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm">{r.email}</TableCell>
                <TableCell>
                  <Select
                    id={`reason-${r.id}`}
                    labelText="Ayrılış"
                    hideLabel
                    size="sm"
                    inline
                    value={reasons[r.id]}
                    disabled={!canEdit}
                    onChange={(e) => setReasons((p) => ({ ...p, [r.id]: e.target.value as ExitReason }))}
                  >
                    <SelectItem value="GRADUATED" text="Mezun" />
                    <SelectItem value="TRANSFERRED" text="Nakil" />
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Modal
        open={open}
        danger
        modalHeading="Öğrenciler ayrılmış olarak işaretlensin mi?"
        primaryButtonText={pending ? "İşleniyor…" : "İşaretle"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => setOpen(false)}
        onRequestSubmit={() =>
          start(async () => {
            const res = await markLeaversAction(chosen.map((r) => ({ studentId: r.id, reason: reasons[r.id] })));
            if (res.error) return setError(res.error);
            setOpen(false);
          })
        }
        size="sm"
      >
        <ul className="mb-4 space-y-1 text-sm">
          {grads > 0 && <li>{grads} mezun</li>}
          {chosen.length - grads > 0 && <li>{chosen.length - grads} nakil</li>}
        </ul>
        <p className="text-sm">
          Gruplardan çıkarma, kulüp görevlerini bitirme ve OU taşıma işleri kuyruğa alınır. Hesap askıya alınana kadar
          öğrenci sayfasından geri alınabilir.
        </p>
        <p className="mt-2 text-xs text-helper">
          Süreler tahmini ayrılış tarihinden (mezunlarda mezuniyet yılının sonu) başlar. Geç işaretlenenlerde askı en erken
          bugün, silme en erken askı süresi kadar sonradır.
        </p>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="İşaretlenemedi" subtitle={error} />}
      </Modal>
    </>
  );
}
