"use client";

import { Button, InlineNotification, Modal, Select, SelectItem } from "@carbon/react";
import { Logout, Undo } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import type { ExitReason } from "@/lib/leavers.ts";
import { markLeaversAction, undoLeaveAction } from "../actions.ts";

/** Yıl içinde nakil giden (ya da tek tek mezun edilen) öğrenci; ve yanlış işaretlemeyi geri alma */
export function LeaveControls({ studentId, name, exited, canUndo }: { studentId: number; name: string; exited: boolean; canUndo: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ExitReason>("TRANSFERRED");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (exited) {
    if (!canUndo) return null;
    return (
      <div>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Undo}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await undoLeaveAction(studentId);
              setError(res.error);
            })
          }
        >
          Ayrılışı geri al
        </Button>
        {error && <p className="mt-2 text-sm text-support-error">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <Button kind="danger--tertiary" size="sm" renderIcon={Logout} onClick={() => setOpen(true)}>
        Okuldan ayrıldı
      </Button>
      <Modal
        open={open}
        danger
        modalHeading={`${name} okuldan ayrıldı mı?`}
        primaryButtonText={pending ? "İşleniyor…" : "İşaretle"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => {
          setOpen(false);
          setError(undefined);
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await markLeaversAction([{ studentId, reason }]);
            if (res.error) return setError(res.error);
            setOpen(false);
          })
        }
        size="sm"
      >
        <Select id="leave-reason" labelText="Neden" value={reason} onChange={(e) => setReason(e.target.value as ExitReason)}>
          <SelectItem value="TRANSFERRED" text="Nakil" />
          <SelectItem value="GRADUATED" text="Mezun" />
        </Select>
        <p className="mt-4 text-sm">
          Öğrenci sınıf ve kulüp gruplarından çıkarılır, kulüp görevleri biter, hesap ayrılanlar OU&apos;suna taşınır ve
          ayardaki sürelerden sonra askıya alınıp silinir.
        </p>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="İşaretlenemedi" subtitle={error} />}
      </Modal>
    </>
  );
}
