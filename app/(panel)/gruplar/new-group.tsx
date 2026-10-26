"use client";

import { Button, Checkbox, InlineNotification, Modal, Select, SelectItem, TextArea, TextInput } from "@carbon/react";
import { Add } from "@carbon/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGroupAction } from "./actions.ts";

/** "İdareciler" → "idareciler" (grup adresi önerisi) */
function suggestLocal(name: string) {
  return name
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" })[c] ?? c)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40);
}

export function NewGroup({ domains }: { domains: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [local, setLocal] = useState("");
  const [localTouched, setLocalTouched] = useState(false);
  const [domain, setDomain] = useState(domains[0] ?? "");
  const [description, setDescription] = useState("");
  const [allowExternal, setAllowExternal] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const reset = () => {
    setName("");
    setLocal("");
    setLocalTouched(false);
    setDomain(domains[0] ?? "");
    setDescription("");
    setAllowExternal(true);
    setError(undefined);
  };

  return (
    <>
      <Button renderIcon={Add} onClick={() => setOpen(true)}>
        Grup ekle
      </Button>
      <Modal
        open={open}
        modalHeading="Yeni öğretmen grubu"
        primaryButtonText={pending ? "Ekleniyor…" : "Ekle"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || name.trim().length < 2 || !local}
        onRequestClose={() => {
          setOpen(false);
          reset();
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await createGroupAction({ name, local, domain, description, allowExternal });
            if (res.error) return setError(res.error);
            setOpen(false);
            reset();
            router.push(`/gruplar/${res.id}`);
          })
        }
        size="sm"
      >
        <div className="space-y-6">
          <TextInput
            id="group-name"
            labelText="Grup adı"
            placeholder="İdareciler"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!localTouched) setLocal(suggestLocal(e.target.value));
            }}
            data-modal-primary-focus
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                id="group-local"
                labelText="Grup adresi"
                helperText="Sonradan değiştirilemez; gerekirse alt adres eklenir."
                value={local}
                onChange={(e) => {
                  setLocalTouched(true);
                  setLocal(e.target.value.toLowerCase().trim().split("@")[0]);
                }}
              />
            </div>
            <div className="w-56 pb-6">
              <Select id="group-domain" labelText="Alan adı" hideLabel value={domain} onChange={(e) => setDomain(e.target.value)}>
                {domains.map((d) => (
                  <SelectItem key={d} value={d} text={`@${d}`} />
                ))}
              </Select>
            </div>
          </div>
          <TextArea
            id="group-desc"
            labelText="Açıklama (isteğe bağlı)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Checkbox
            id="group-external"
            labelText="Kurum dışından e-posta alabilsin"
            helperText="Kapalıysa gruba sadece okul hesapları yazabilir."
            checked={allowExternal}
            onChange={(_, { checked }) => setAllowExternal(checked)}
          />
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Eklenemedi" subtitle={error} />}
        </div>
      </Modal>
    </>
  );
}
