"use client";

import {
  Button,
  Checkbox,
  ComboBox,
  IconButton,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from "@carbon/react";
import { Add, Close, Edit, TrashCan } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import { GROUP_ROLES } from "@/lib/labels.ts";
import {
  addGroupTeacherAction,
  closeGroupAction,
  removeGroupMemberAction,
  setGroupMemberRoleAction,
  updateGroupAction,
} from "../actions.ts";

type Option = { id: number; label: string };
type Role = "MEMBER" | "MANAGER";

/** Öğretmen ekleme: okuldaki, grupta olmayan öğretmenlerden seçilir */
export function AddGroupTeacher({ groupId, teachers }: { groupId: number; teachers: Option[] }) {
  const [teacher, setTeacher] = useState<Option | null>(null);
  const [role, setRole] = useState<Role>("MEMBER");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
      <div className="min-w-72 flex-1">
        <ComboBox<Option>
          id="group-teacher-picker"
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
      <div className="w-40">
        <Select id="group-teacher-role" labelText="Rol" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {Object.entries(GROUP_ROLES).map(([k, v]) => (
            <SelectItem key={k} value={k} text={v} />
          ))}
        </Select>
      </div>
      <Button
        size="md"
        renderIcon={Add}
        disabled={!teacher || pending}
        onClick={() =>
          start(async () => {
            const res = await addGroupTeacherAction(groupId, teacher!.id, role);
            setError(res.error);
            if (!res.error) setTeacher(null);
          })
        }
      >
        Gruba ekle
      </Button>
      {error && <p className="w-full text-sm text-support-error">{error}</p>}
    </div>
  );
}

/** Satırdaki rol seçici: değişince Google'da üyelik yeni rolle yeniden eklenir */
export function MemberRole({ groupId, memberId, role }: { groupId: number; memberId: number; role: Role }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div>
      <Select
        id={`member-role-${memberId}`}
        labelText="Rol"
        hideLabel
        size="sm"
        inline
        disabled={pending}
        value={role}
        onChange={(e) =>
          start(async () => {
            const res = await setGroupMemberRoleAction(groupId, memberId, e.target.value as Role);
            setError(res.error);
          })
        }
      >
        {Object.entries(GROUP_ROLES).map(([k, v]) => (
          <SelectItem key={k} value={k} text={v} />
        ))}
      </Select>
      {error && <p className="text-xs text-support-error">{error}</p>}
    </div>
  );
}

export function RemoveGroupMember({ groupId, memberId, name }: { groupId: number; memberId: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <>
      <IconButton kind="ghost" size="sm" label="Gruptan çıkar" align="left" onClick={() => setOpen(true)}>
        <Close />
      </IconButton>
      <Modal
        open={open}
        danger
        modalHeading="Gruptan çıkarılsın mı?"
        primaryButtonText={pending ? "Çıkarılıyor…" : "Çıkar"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => {
          setOpen(false);
          setError(undefined);
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await removeGroupMemberAction(groupId, memberId);
            if (res.error) return setError(res.error);
            setOpen(false);
          })
        }
        size="xs"
      >
        <p className="text-sm">{name} gruptan çıkarılacak.</p>
        {error && <p className="mt-4 text-sm text-support-error">{error}</p>}
      </Modal>
    </>
  );
}

/** Grubun adını/açıklamasını/dış e-posta iznini değiştirme ve grubu kapatma */
export function GroupSettings({
  groupId,
  name,
  description,
  email,
  allowExternal,
  members,
  aliases,
}: {
  groupId: number;
  name: string;
  description: string | null;
  email: string;
  allowExternal: boolean;
  members: number;
  aliases: number;
}) {
  const [mode, setMode] = useState<"edit" | "close" | null>(null);
  const [draft, setDraft] = useState({ name, description: description ?? "", allowExternal });
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
          setDraft({ name, description: description ?? "", allowExternal });
          setMode("edit");
        }}
      >
        Düzenle
      </Button>
      <Button kind="danger--tertiary" renderIcon={TrashCan} onClick={() => setMode("close")}>
        Grubu kapat
      </Button>

      <Modal
        open={mode === "edit"}
        modalHeading="Grubu düzenle"
        modalLabel={email}
        primaryButtonText={pending ? "Kaydediliyor…" : "Kaydet"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending || draft.name.trim().length < 2}
        onRequestClose={close}
        onRequestSubmit={() =>
          start(async () => {
            const res = await updateGroupAction(groupId, draft);
            if (res.error) return setError(res.error);
            close();
          })
        }
        size="sm"
      >
        <div className="space-y-4">
          <TextInput
            id="group-edit-name"
            labelText="Grup adı"
            value={draft.name}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, name: e.target.value }))}
            data-modal-primary-focus
          />
          <TextArea
            id="group-edit-desc"
            labelText="Açıklama"
            rows={2}
            value={draft.description}
            onChange={(e: { target: { value: string } }) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
          <Checkbox
            id="group-edit-external"
            labelText="Kurum dışından e-posta alabilsin"
            checked={draft.allowExternal}
            onChange={(_, { checked }) => setDraft((d) => ({ ...d, allowExternal: checked }))}
          />
          <p className="text-xs text-helper">Grup adresi ({email}) değişmez. Google&apos;daki ad ve ayarlar kuyruktan güncellenir.</p>
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
            const res = await closeGroupAction(groupId);
            if (res.error) return setError(res.error);
            close();
          })
        }
        size="sm"
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {members > 0 && <li>{members} üyelik silinir.</li>}
          {aliases > 0 && <li>{aliases} alt adres grupla birlikte kalkar.</li>}
          <li>
            <span className="font-mono">{email}</span> grubu Google&apos;dan silinir. Gruba gelen e-postalar ve grup
            ayarları geri gelmez.
          </li>
          <li>Grup kaydı geçmiş için kalır; aynı adres yeniden kullanılamaz.</li>
        </ul>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="Kapatılamadı" subtitle={error} />}
      </Modal>
    </div>
  );
}
