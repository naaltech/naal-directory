"use client";

import { Button, CopyButton, InlineNotification, Modal } from "@carbon/react";
import { Reset } from "@carbon/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetStudentPasswordAction } from "@/app/(panel)/ogrenciler/actions.ts";
import { resetTeacherPasswordAction } from "@/app/(panel)/ogretmenler/actions.ts";

/** Yeni şifre üretir ve bir kez gösterir; Google'a senkronizasyonla gider */
export function ResetPassword({ studentId, teacherId, live }: { studentId?: number; teacherId?: number; live: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setError(undefined);
    if (password) {
      setPassword(undefined);
      router.refresh();
    }
  };
  const submit = () =>
    start(async () => {
      const res = teacherId ? await resetTeacherPasswordAction(teacherId) : await resetStudentPasswordAction(studentId!);
      if (res.error) return setError(res.error);
      setPassword(res.password);
    });

  return (
    <>
      <Button kind="ghost" size="sm" renderIcon={Reset} onClick={() => setOpen(true)}>
        Şifreyi sıfırla
      </Button>
      <Modal
        open={open}
        danger={!password}
        passiveModal={Boolean(password)}
        modalHeading={password ? "Yeni şifre" : "Şifre sıfırlansın mı?"}
        primaryButtonText={pending ? "Sıfırlanıyor…" : "Sıfırla"}
        secondaryButtonText="Vazgeç"
        closeButtonLabel="Kapat"
        primaryButtonDisabled={pending}
        onRequestClose={close}
        onRequestSubmit={submit}
        size="sm"
      >
        {password ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="bg-layer px-3 py-2 font-mono text-lg tracking-wider">{password}</code>
              <CopyButton iconDescription="Kopyala" feedback="Kopyalandı" onClick={() => navigator.clipboard.writeText(password)} />
            </div>
            <p className="text-sm">
              {live
                ? "Şifre senkronizasyon çalışınca Google'da değişir; o zamana kadar eski şifre geçerlidir."
                : "Hesap Google'da henüz açılmadı; bu şifreyle açılacak."}{" "}
              İlk girişte yeni şifre belirlemesi istenir. Şifre &quot;İlk şifre&quot; olarak ve şifre listesinde görünmeye devam eder.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Yeni bir şifre üretilir ve kişinin şu anki şifresi geçersiz olur. Kişi bu şifreyle girdikten sonra kendi şifresini
              belirler. İşlem kayda geçer.
            </p>
            {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Sıfırlanamadı" subtitle={error} />}
          </div>
        )}
      </Modal>
    </>
  );
}
