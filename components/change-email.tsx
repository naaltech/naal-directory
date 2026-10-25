"use client";

import { Button, InlineNotification, Modal, TextInput } from "@carbon/react";
import { Edit } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import { changeStudentEmailAction } from "@/app/(panel)/ogrenciler/actions.ts";
import { changeTeacherEmailAction } from "@/app/(panel)/ogretmenler/actions.ts";

/** E-posta adresinin @ öncesini değiştirir; alan adı aynı kalır */
export function ChangeEmail({ email, studentId, teacherId }: { email: string; studentId?: number; teacherId?: number }) {
  const [local, domain] = email.split("@");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(local);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const next = draft.trim().toLowerCase();

  const close = () => {
    setOpen(false);
    setError(undefined);
  };
  const submit = () =>
    start(async () => {
      const res = studentId ? await changeStudentEmailAction(studentId, next) : await changeTeacherEmailAction(teacherId!, next);
      if (res.error) return setError(res.error);
      close();
    });

  return (
    <>
      <Button
        kind="ghost"
        size="sm"
        renderIcon={Edit}
        iconDescription="E-postayı değiştir"
        hasIconOnly
        tooltipPosition="bottom"
        className="-my-2 align-middle"
        onClick={() => {
          setDraft(local);
          setOpen(true);
        }}
      />
      <Modal
        open={open}
        modalHeading="E-postayı değiştir"
        primaryButtonText={pending ? "Kaydediliyor…" : "Değiştir"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || !next || next === local}
        onRequestClose={close}
        onRequestSubmit={submit}
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                id="email-local"
                labelText="Yeni adres"
                value={draft}
                onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
                data-modal-primary-focus
              />
            </div>
            <span className="pb-3 font-mono text-sm text-secondary">@{domain}</span>
          </div>
          <p className="text-xs text-helper">
            Google hesabı yeniden adlandırılır, gruplar ve şifre aynı kalır. Eski adres takma ad olarak kalır: ona gelen
            e-postalar ulaşır, eski adresle giriş de çalışır. Değişiklik senkronizasyon çalışınca Google&apos;a gider.
          </p>
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Değiştirilemedi" subtitle={error} />}
        </div>
      </Modal>
    </>
  );
}
