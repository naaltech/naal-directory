"use client";

import { Button, CopyButton } from "@carbon/react";
import { View } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import { revealPasswordAction } from "@/app/(panel)/ogrenciler/actions.ts";
import { revealTeacherPasswordAction } from "@/app/(panel)/ogretmenler/actions.ts";

/** İlk şifreyi istek üzerine gösterir; her görüntüleme sunucuda kayda geçer */
export function RevealPassword({ studentId, teacherId }: { studentId?: number; teacherId?: number }) {
  const [password, setPassword] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (password) {
    return (
      <div className="flex items-center gap-2">
        <code className="bg-layer px-3 py-2 font-mono text-lg tracking-wider">{password}</code>
        <CopyButton iconDescription="Kopyala" feedback="Kopyalandı" onClick={() => navigator.clipboard.writeText(password)} />
      </div>
    );
  }
  return (
    <div>
      <Button
        kind="tertiary"
        size="sm"
        renderIcon={View}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = teacherId ? await revealTeacherPasswordAction(teacherId) : await revealPasswordAction(studentId!);
            setPassword(res.password);
            setError(res.error);
          })
        }
      >
        {pending ? "Açılıyor…" : "İlk şifreyi göster"}
      </Button>
      {error && <p className="mt-2 text-sm text-support-error">{error}</p>}
    </div>
  );
}
