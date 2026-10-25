"use client";

import { Button, ComboBox, IconButton, InlineNotification, Modal, Select, SelectItem, TextArea, TextInput } from "@carbon/react";
import { Add, Close, Edit, Email, TrashCan, UserFollow } from "@carbon/icons-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { OFFICER_TITLES } from "@/lib/labels.ts";
import {
  addMemberAction,
  assignAdvisorAction,
  assignOfficerAction,
  closeClubAction,
  endAdvisorAction,
  endOfficerAction,
  reapplyClubSettingsAction,
  removeMemberAction,
  searchStudentsAction,
  suggestAliasAction,
  updateClubAction,
} from "../actions.ts";

type Option = { id: number; label: string };

/** Ad, okul no ya da e-posta ile öğrenci arayan kutu */
function StudentPicker({ id, value, onChange }: { id: string; value: Option | null; onChange: (o: Option | null) => void }) {
  const [items, setItems] = useState<Option[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ComboBox<Option>
      id={id}
      titleText="Öğrenci"
      placeholder="Ad, okul no veya e-posta yazın"
      items={value && !items.some((i) => i.id === value.id) ? [value, ...items] : items}
      itemToString={(o) => o?.label ?? ""}
      selectedItem={value}
      onChange={({ selectedItem }) => onChange(selectedItem ?? null)}
      onInputChange={(text) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(async () => setItems(text.trim().length >= 2 ? await searchStudentsAction(text) : []), 250);
      }}
      shouldFilterItem={() => true}
    />
  );
}

export function AddMember({ clubId }: { clubId: number }) {
  const [student, setStudent] = useState<Option | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
      <div className="min-w-72 flex-1">
        <StudentPicker id="member-picker" value={student} onChange={setStudent} />
      </div>
      <Button
        size="md"
        renderIcon={Add}
        disabled={!student || pending}
        onClick={() =>
          start(async () => {
            const res = await addMemberAction(clubId, student!.id);
            setError(res.error);
            if (!res.error) setStudent(null);
          })
        }
      >
        Üye ekle
      </Button>
      {error && <p className="w-full text-sm text-support-error">{error}</p>}
    </div>
  );
}

export function AssignOfficer({ clubId, domain }: { clubId: number; domain: string }) {
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<Option | null>(null);
  const [title, setTitle] = useState("BOARD_MEMBER");
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [suggesting, startSuggest] = useTransition();

  const close = () => {
    setOpen(false);
    setStudent(null);
    setAlias("");
    setTitle("BOARD_MEMBER");
    setError(undefined);
  };

  return (
    <>
      <Button kind="tertiary" size="sm" renderIcon={UserFollow} onClick={() => setOpen(true)}>
        Görevli ata
      </Button>
      <Modal
        open={open}
        modalHeading="Yönetim kadrosuna görevli ata"
        primaryButtonText={pending ? "Atanıyor…" : "Ata"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || suggesting || !student || !alias.trim()}
        onRequestClose={close}
        onRequestSubmit={() =>
          start(async () => {
            const res = await assignOfficerAction({ clubId, studentId: student!.id, title: title as never, aliasLocal: alias });
            if (res.error) return setError(res.error);
            close();
          })
        }
        size="sm"
      >
        <div className="space-y-6">
          <StudentPicker
            id="officer-picker"
            value={student}
            onChange={(o) => {
              setStudent(o);
              setError(undefined);
              if (o)
                startSuggest(async () => {
                  const res = await suggestAliasAction(o.id);
                  setAlias(res.local ?? "");
                  setError(res.error);
                });
            }}
          />
          <Select id="officer-title" labelText="Görev" value={title} onChange={(e) => setTitle(e.target.value)}>
            {Object.entries(OFFICER_TITLES).map(([k, v]) => (
              <SelectItem key={k} value={k} text={v} />
            ))}
          </Select>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextInput
                id="officer-alias"
                labelText="Takma ad"
                helperText={suggesting ? "Öneri hazırlanıyor…" : "Önce ad, çakışırsa ikinci isim ya da soyad önerilir."}
                value={alias}
                onChange={(e) => setAlias(e.target.value.toLowerCase().trim())}
              />
            </div>
            <span className="pb-8 font-mono text-sm text-secondary">@{domain}</span>
          </div>
          <p className="text-xs text-helper">
            Takma ad öğrencinin kendi hesabına eklenir ve hesap /Kulupler OU&apos;suna taşınır. Görev bitince takma ad
            kaldırılır, hesap şubesine döner.
          </p>
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Atanamadı" subtitle={error} />}
        </div>
      </Modal>
    </>
  );
}

/** Danışman öğretmen ekleme: okuldaki öğretmenlerden seçilir */
export function AssignAdvisor({ clubId, teachers }: { clubId: number; teachers: Option[] }) {
  const [teacher, setTeacher] = useState<Option | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
      <div className="min-w-72 flex-1">
        <ComboBox<Option>
          id="advisor-picker"
          titleText="Öğretmen"
          placeholder={teachers.length ? "Ad veya branş yazın" : "Eklenebilecek öğretmen yok"}
          disabled={teachers.length === 0}
          items={teachers}
          itemToString={(o) => o?.label ?? ""}
          selectedItem={teacher}
          onChange={({ selectedItem }) => {
            setTeacher(selectedItem ?? null);
            setError(undefined);
          }}
          shouldFilterItem={({ item, inputValue }) =>
            !inputValue || item.label.toLocaleLowerCase("tr").includes(inputValue.toLocaleLowerCase("tr"))
          }
        />
      </div>
      <Button
        size="md"
        renderIcon={Add}
        disabled={!teacher || pending}
        onClick={() =>
          start(async () => {
            const res = await assignAdvisorAction(clubId, teacher!.id);
            setError(res.error);
            if (!res.error) setTeacher(null);
          })
        }
      >
        Danışman ekle
      </Button>
      {error && <p className="w-full text-sm text-support-error">{error}</p>}
    </div>
  );
}

export function EndAdvisor({ clubId, advisorId, name }: { clubId: number; advisorId: number; name: string }) {
  return (
    <RowAction
      label="Danışmanlığı bitir"
      heading="Danışmanlık bitirilsin mi?"
      body={`${name} kulübün danışmanlığından çıkarılacak ve kulüp grubundaki yöneticiliği kaldırılacak.`}
      confirmText="Bitir"
      onConfirm={() => endAdvisorAction(clubId, advisorId)}
    />
  );
}

/** Satır sonundaki onaylı işlem düğmesi (üyelikten çıkar, görevi bitir) */
export function RowAction({
  label,
  heading,
  body,
  confirmText,
  onConfirm,
}: {
  label: string;
  heading: string;
  body: string;
  confirmText: string;
  onConfirm: () => Promise<{ error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <IconButton kind="ghost" size="sm" label={label} align="left" onClick={() => setOpen(true)}>
        <Close />
      </IconButton>
      <Modal
        open={open}
        danger
        modalHeading={heading}
        primaryButtonText={pending ? "İşleniyor…" : confirmText}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => {
          setOpen(false);
          setError(undefined);
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await onConfirm();
            if (res.error) return setError(res.error);
            setOpen(false);
          })
        }
        size="xs"
      >
        <p className="text-sm">{body}</p>
        {error && <p className="mt-4 text-sm text-support-error">{error}</p>}
      </Modal>
    </>
  );
}

export function RemoveMember({ clubId, studentId, name }: { clubId: number; studentId: number; name: string }) {
  return (
    <RowAction
      label="Üyelikten çıkar"
      heading="Üyelikten çıkarılsın mı?"
      body={`${name} kulüpten ve kulüp grubundan çıkarılacak.`}
      confirmText="Çıkar"
      onConfirm={() => removeMemberAction(clubId, studentId)}
    />
  );
}

export function EndOfficer({ clubId, officerId, name, alias }: { clubId: number; officerId: number; name: string; alias: string }) {
  return (
    <RowAction
      label="Görevi sonlandır"
      heading="Görev sonlandırılsın mı?"
      body={`${name} hesabından ${alias} takma adı kaldırılacak ve başka görevi yoksa hesap şube OU'suna dönecek. Kulüp üyeliği devam eder.`}
      confirmText="Sonlandır"
      onConfirm={() => endOfficerAction(clubId, officerId)}
    />
  );
}

/** Kulübün adını/açıklamasını değiştirme ve kulübü kapatma */
export function ClubSettings({
  clubId,
  name,
  description,
  email,
  officers,
  members,
}: {
  clubId: number;
  name: string;
  description: string | null;
  email: string;
  officers: number;
  members: number;
}) {
  const [mode, setMode] = useState<"edit" | "close" | null>(null);
  const [queued, setQueued] = useState<string>();
  const [draft, setDraft] = useState({ name, description: description ?? "" });
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const close = () => {
    setMode(null);
    setError(undefined);
  };
  return (
    <div className="flex gap-2">
      <Button
        kind="tertiary"
        renderIcon={Edit}
        onClick={() => {
          setDraft({ name, description: description ?? "" });
          setMode("edit");
        }}
      >
        Düzenle
      </Button>
      <Button
        kind="ghost"
        renderIcon={Email}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await reapplyClubSettingsAction(clubId);
            setQueued(res.error ?? "Dış e-posta ayarları kuyruğa alındı");
          })
        }
      >
        Dış e-posta ayarlarını uygula
      </Button>
      <Button kind="danger--tertiary" renderIcon={TrashCan} onClick={() => setMode("close")}>
        Kulübü kapat
      </Button>
      {queued && <p className="self-center text-sm text-secondary">{queued}</p>}

      <Modal
        open={mode === "edit"}
        modalHeading="Kulübü düzenle"
        modalLabel={email}
        primaryButtonText={pending ? "Kaydediliyor…" : "Kaydet"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || draft.name.trim().length < 2}
        onRequestClose={close}
        onRequestSubmit={() =>
          start(async () => {
            const res = await updateClubAction(clubId, draft);
            if (res.error) return setError(res.error);
            close();
          })
        }
        size="sm"
      >
        <div className="space-y-4">
          <TextInput
            id="club-edit-name"
            labelText="Kulüp adı"
            value={draft.name}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, name: e.target.value }))}
            data-modal-primary-focus
          />
          <TextArea
            id="club-edit-desc"
            labelText="Açıklama"
            rows={2}
            value={draft.description}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
          <p className="text-xs text-helper">Grup adresi ({email}) değişmez. Google&apos;daki grup adı kuyruktan güncellenir.</p>
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Kaydedilemedi" subtitle={error} />}
        </div>
      </Modal>

      <Modal
        open={mode === "close"}
        danger
        modalHeading={`${name} kapatılsın mı?`}
        primaryButtonText={pending ? "Kapatılıyor…" : "Kapat ve grubu sil"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={close}
        onRequestSubmit={() =>
          start(async () => {
            const res = await closeClubAction(clubId);
            if (res.error) return setError(res.error);
            close();
          })
        }
        size="sm"
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {officers > 0 && <li>{officers} görev sonlanır: takma adlar kaldırılır, hesaplar şube OU&apos;suna döner.</li>}
          {members > 0 && <li>{members} üyelik silinir.</li>}
          <li>
            <span className="font-mono">{email}</span> grubu Google&apos;dan silinir. Gruba gelen e-postalar ve grup
            ayarları geri gelmez.
          </li>
          <li>Kulüp kaydı geçmiş için kalır; aynı kod yeniden kullanılamaz.</li>
        </ul>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="Kapatılamadı" subtitle={error} />}
      </Modal>
    </div>
  );
}
