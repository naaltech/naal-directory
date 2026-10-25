"use client";

import { Button, InlineNotification, Modal, TextArea, TextInput } from "@carbon/react";
import { Add } from "@carbon/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClubAction } from "./actions.ts";

/** "Robotik Kulübü" → "robotik" (kulüp kodu önerisi) */
function suggestCode(name: string) {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/kulübü|kulubu|topluluğu/g, "")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
}

export function NewClub({ domain }: { domain: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const reset = () => {
    setName("");
    setCode("");
    setCodeTouched(false);
    setDescription("");
    setError(undefined);
  };

  return (
    <>
      <Button renderIcon={Add} onClick={() => setOpen(true)}>
        Kulüp ekle
      </Button>
      <Modal
        open={open}
        modalHeading="Yeni kulüp"
        primaryButtonText={pending ? "Ekleniyor…" : "Ekle"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || !name.trim() || !code}
        onRequestClose={() => {
          setOpen(false);
          reset();
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await createClubAction({ code, name, description });
            if (res.error) return setError(res.error);
            setOpen(false);
            reset();
            router.push(`/kulupler/${res.id}`);
          })
        }
        size="sm"
      >
        <div className="space-y-6">
          <TextInput
            id="club-name"
            labelText="Kulüp adı"
            placeholder="Robotik Kulübü"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!codeTouched) setCode(suggestCode(e.target.value));
            }}
            data-modal-primary-focus
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                id="club-code"
                labelText="Kulüp kodu (grup adresi)"
                helperText="Sonradan değiştirilemez."
                value={code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value.toLowerCase().trim());
                }}
              />
            </div>
            <span className="pb-8 font-mono text-sm text-secondary">@{domain}</span>
          </div>
          <TextArea
            id="club-desc"
            labelText="Açıklama (isteğe bağlı)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Eklenemedi" subtitle={error} />}
        </div>
      </Modal>
    </>
  );
}
