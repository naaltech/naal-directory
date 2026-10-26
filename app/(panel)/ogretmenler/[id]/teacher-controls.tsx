"use client";

import { Button, InlineNotification, Modal, TextInput } from "@carbon/react";
import { Edit, Logout, Undo } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import { markTeacherLeftAction, undoTeacherLeftAction, updateTeacherAction } from "../actions.ts";

export function TeacherControls({
  id,
  firstName,
  lastName,
  branch,
  left,
  canUndo,
  suspendDays,
  deleteDays,
}: {
  id: number;
  firstName: string;
  lastName: string;
  branch: string | null;
  left: boolean;
  canUndo: boolean;
  suspendDays: number;
  deleteDays: number;
}) {
  const [mode, setMode] = useState<"edit" | "leave" | null>(null);
  const [draft, setDraft] = useState({ firstName, lastName, branch: branch ?? "" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const close = () => {
    setMode(null);
    setError(undefined);
  };
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      close();
    });

  if (left) {
    if (!canUndo) return null;
    return (
      <div>
        <Button kind="ghost" size="sm" renderIcon={Undo} disabled={pending} onClick={() => run(() => undoTeacherLeftAction(id))}>
          Ayrılışı geri al
        </Button>
        {error && <p className="mt-2 text-sm text-support-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        kind="tertiary"
        renderIcon={Edit}
        onClick={() => {
          setDraft({ firstName, lastName, branch: branch ?? "" });
          setMode("edit");
        }}
      >
        Düzenle
      </Button>
      <Button kind="danger--tertiary" renderIcon={Logout} onClick={() => setMode("leave")}>
        Okuldan ayrıldı
      </Button>

      <Modal
        open={mode === "edit"}
        modalHeading="Öğretmeni düzenle"
        primaryButtonText={pending ? "Kaydediliyor…" : "Kaydet"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || !draft.firstName.trim() || !draft.lastName.trim()}
        onRequestClose={close}
        onRequestSubmit={() => run(() => updateTeacherAction(id, draft))}
        size="sm"
      >
        <div className="space-y-4">
          <TextInput
            id="t-first"
            labelText="Ad"
            value={draft.firstName}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
            data-modal-primary-focus
          />
          <TextInput
            id="t-last"
            labelText="Soyad"
            value={draft.lastName}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, lastName: e.target.value }))}
          />
          <TextInput
            id="t-branch"
            labelText="Branş"
            value={draft.branch}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, branch: e.target.value }))}
          />
          <p className="text-xs text-helper">Google&apos;daki görünen ad güncellenir. Adres, e-postanın yanındaki kalemle değiştirilir.</p>
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Kaydedilemedi" subtitle={error} />}
        </div>
      </Modal>

      <Modal
        open={mode === "leave"}
        danger
        modalHeading={`${firstName} ${lastName} okuldan ayrıldı mı?`}
        primaryButtonText={pending ? "İşleniyor…" : "Ayrıldı olarak işaretle"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={close}
        onRequestSubmit={() => run(() => markTeacherLeftAction(id))}
        size="sm"
      >
        <p className="text-sm">
          Hesap gruplardan çıkarılır ve /Ogretmenler/Ayrilanlar OU&apos;suna taşınır; {suspendDays} gün sonra askıya alınır,{" "}
          {deleteDays} gün sonra silinir. Askıya alınana kadar geri alınabilir.
        </p>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="İşaretlenemedi" subtitle={error} />}
      </Modal>
    </div>
  );
}
