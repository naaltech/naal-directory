"use client";

import {
  Button,
  CodeSnippet,
  InlineNotification,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  PasswordInput,
  Select,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
} from "@carbon/react";
import { Add } from "@carbon/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AdminUser, Role } from "@/lib/auth/admins.ts";
import { formatDateTime } from "@/lib/format.ts";
import {
  createAdminAction,
  removeAdminAction,
  resetAdminPasswordAction,
  setAdminActiveAction,
  setAdminRoleAction,
  transferSuperAdminAction,
  type AdminActionResult,
} from "./actions.ts";

const ROLE_LABELS: Record<Role, string> = { SUPER_ADMIN: "Süper yönetici", ADMIN: "Yönetici", VIEWER: "Görüntüleyici" };
const ROLE_TAG: Record<Role, "purple" | "blue" | "gray"> = { SUPER_ADMIN: "purple", ADMIN: "blue", VIEWER: "gray" };

type Dialog =
  | { kind: "create" }
  | { kind: "password"; email: string; password: string; created: boolean }
  | { kind: "reset" | "remove" | "transfer"; admin: AdminUser };

export function AdminsTable({
  admins,
  meId,
  isSuper,
  now,
}: {
  admins: AdminUser[];
  meId: number;
  isSuper: boolean;
  /** Sunucu saati (kilit karşılaştırması için, 'YYYY-MM-DD HH:MM:SS') */
  now: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const act =(fn: () => Promise<AdminActionResult>, onOk?: (r: { password?: string }) => void) =>
    start(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) return setError(res.error);
      // Şifre gösterilecekse sayfa pencere kapanınca yenilenir (yenileme tabloyu baştan kurar, şifre kaybolur)
      if (onOk) return onOk(res);
      setDialog(null);
      router.refresh();
    });

  const close = () => {
    if (dialog?.kind === "password") router.refresh();
    setDialog(null);
    setError(undefined);
  };

  return (
    <>
      {error && !dialog && (
        <div className="mb-4">
          <InlineNotification kind="error" lowContrast title="İşlem yapılamadı" subtitle={error} onClose={() => setError(undefined)} />
        </div>
      )}
      <TableContainer title={`${admins.length} yönetici`}>
        {isSuper && (
          <div className="flex justify-end px-4 pb-4">
            <Button renderIcon={Add} onClick={() => setDialog({ kind: "create" })}>
              Yönetici ekle
            </Button>
          </div>
        )}
        <Table aria-label="Yöneticiler">
          <TableHead>
            <TableRow>
              <TableHeader>Ad</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Rol</TableHeader>
              <TableHeader>Durum</TableHeader>
              <TableHeader>Son giriş</TableHeader>
              {isSuper && <TableHeader aria-label="İşlemler" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {admins.map((a) => {
              const locked = Boolean(a.locked_until && a.locked_until > now);
              const self = a.id === meId;
              const editable = isSuper && !self && a.role !== "SUPER_ADMIN";
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.name}
                    {self && <span className="ml-2 text-xs text-helper">(siz)</span>}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{a.email}</TableCell>
                  <TableCell>
                    <Tag type={ROLE_TAG[a.role]} size="sm">
                      {ROLE_LABELS[a.role]}
                    </Tag>
                  </TableCell>
                  <TableCell>
                    <Tag type={!a.is_active ? "gray" : locked ? "red" : "green"} size="sm">
                      {!a.is_active ? "Pasif" : locked ? "Kilitli" : "Aktif"}
                    </Tag>
                  </TableCell>
                  <TableCell>{formatDateTime(a.last_login_at)}</TableCell>
                  {isSuper && (
                    <TableCell className="text-right">
                      {editable && (
                        <OverflowMenu aria-label={`${a.email} işlemleri`} iconDescription={`${a.email} işlemleri`} flipped size="sm">
                          <OverflowMenuItem
                            itemText={a.role === "ADMIN" ? "Görüntüleyici yap" : "Yönetici yap"}
                            onClick={() => act(() => setAdminRoleAction(a.id, a.role === "ADMIN" ? "VIEWER" : "ADMIN"))}
                          />
                          <OverflowMenuItem
                            itemText={a.is_active ? "Pasifleştir" : "Etkinleştir"}
                            onClick={() => act(() => setAdminActiveAction(a.id, !a.is_active))}
                          />
                          <OverflowMenuItem itemText="Şifreyi sıfırla" onClick={() => setDialog({ kind: "reset", admin: a })} />
                          <OverflowMenuItem
                            itemText="Süper yöneticiliği devret"
                            disabled={!a.is_active || locked}
                            onClick={() => setDialog({ kind: "transfer", admin: a })}
                          />
                          <OverflowMenuItem itemText="Sil" isDelete hasDivider onClick={() => setDialog({ kind: "remove", admin: a })} />
                        </OverflowMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {dialog?.kind === "create" && (
        <CreateDialog
          pending={pending}
          error={error}
          onClose={close}
          onSubmit={(input) =>
            act(
              () => createAdminAction(input),
              (r) => setDialog({ kind: "password", email: input.email.trim().toLowerCase(), password: r.password!, created: true }),
            )
          }
        />
      )}

      {dialog?.kind === "password" && (
        <Modal
          closeButtonLabel="Kapat"
          open
          passiveModal
          modalHeading={dialog.created ? "Yönetici eklendi" : "Şifre sıfırlandı"}
          onRequestClose={close}
        >
          <Stack gap={5}>
            <p>
              <span className="font-mono">{dialog.email}</span> için {dialog.created ? "ilk" : "yeni"} şifre aşağıda. Bu şifre bir daha gösterilmez;
              kişiye güvenli bir yoldan (yüz yüze, telefonla) iletin.
            </p>
            <CodeSnippet type="single" feedback="Kopyalandı">
              {dialog.password}
            </CodeSnippet>
          </Stack>
        </Modal>
      )}

      {dialog?.kind === "reset" && (
        <Modal
          closeButtonLabel="Kapat"
          open
          modalHeading={`${dialog.admin.name} için yeni şifre`}
          primaryButtonText={pending ? "Sıfırlanıyor…" : "Şifreyi sıfırla"}
          secondaryButtonText="Vazgeç"
          primaryButtonDisabled={pending}
          onRequestClose={close}
          onRequestSubmit={() =>
            act(
              () => resetAdminPasswordAction(dialog.admin.id),
              (r) => setDialog({ kind: "password", email: dialog.admin.email, password: r.password!, created: false }),
            )
          }
        >
          <p>Yeni bir şifre üretilir ve bir kez gösterilir. Eski şifre çalışmaz, açık oturumları kapanır.</p>
          {error && <ModalError error={error} />}
        </Modal>
      )}

      {dialog?.kind === "remove" && (
        <Modal
          closeButtonLabel="Kapat"
          open
          danger
          modalHeading={`${dialog.admin.name} silinsin mi?`}
          primaryButtonText={pending ? "Siliniyor…" : "Sil"}
          secondaryButtonText="Vazgeç"
          primaryButtonDisabled={pending}
          onRequestClose={close}
          onRequestSubmit={() => act(() => removeAdminAction(dialog.admin.id))}
        >
          <p>
            <span className="font-mono">{dialog.admin.email}</span> panele bir daha giriş yapamaz. Yaptığı işlemlerin
            kayıtları kalır. Geçici olarak engellemek için silmek yerine pasifleştirin.
          </p>
          {error && <ModalError error={error} />}
        </Modal>
      )}

      {dialog?.kind === "transfer" && (
        <TransferDialog
          admin={dialog.admin}
          pending={pending}
          error={error}
          onClose={close}
          onSubmit={(pw) => act(() => transferSuperAdminAction(dialog.admin.id, pw))}
        />
      )}
    </>
  );
}

function ModalError({ error }: { error: string }) {
  return (
    <div className="mt-4">
      <InlineNotification kind="error" lowContrast hideCloseButton title="İşlem yapılamadı" subtitle={error} />
    </div>
  );
}

function CreateDialog({
  pending,
  error,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: { email: string; name: string; role: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("ADMIN");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim().length > 0;

  return (
    <Modal
      closeButtonLabel="Kapat"
      open
      modalHeading="Yönetici ekle"
      primaryButtonText={pending ? "Ekleniyor…" : "Ekle"}
      secondaryButtonText="Vazgeç"
      primaryButtonDisabled={pending || !valid}
      onRequestClose={onClose}
      onRequestSubmit={() => valid && onSubmit({ email, name, role })}
    >
      <Stack gap={6}>
        <TextInput
          id="admin-email"
          labelText="E-posta"
          placeholder="ad.soyad@nevzatayazal.k12.tr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-modal-primary-focus
        />
        <TextInput id="admin-name" labelText="Ad Soyad" value={name} onChange={(e) => setName(e.target.value)} />
        <Select id="admin-role" labelText="Rol" value={role} onChange={(e) => setRole(e.target.value)}>
          <SelectItem value="ADMIN" text="Yönetici: öğrenci, öğretmen, kulüp ve senkronizasyon işlemleri" />
          <SelectItem value="VIEWER" text="Görüntüleyici: sadece okur" />
        </Select>
        <p className="text-sm text-secondary">
          Şifre otomatik üretilir ve ekleme sonrasında bir kez gösterilir. Süper yönetici eklenemez; süper yöneticilik
          devredilir.
        </p>
        {error && <ModalError error={error} />}
      </Stack>
    </Modal>
  );
}

function TransferDialog({
  admin,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  admin: AdminUser;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  return (
    <Modal
      closeButtonLabel="Kapat"
      open
      danger
      modalHeading="Süper yöneticiliği devret"
      primaryButtonText={pending ? "Devrediliyor…" : "Devret"}
      secondaryButtonText="Vazgeç"
      primaryButtonDisabled={pending || !pw}
      onRequestClose={onClose}
      onRequestSubmit={() => pw && onSubmit(pw)}
    >
      <Stack gap={5}>
        <p>
          <strong>{admin.name}</strong> (<span className="font-mono">{admin.email}</span>) süper yönetici olur, siz
          Yönetici olursunuz. Yönetici eklemek, silmek ve devretmek artık onun yetkisinde olur; geri almak için onun
          size tekrar devretmesi gerekir.
        </p>
        <PasswordInput
          id="transfer-password"
          labelText="Onaylamak için kendi şifreniz"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          showPasswordLabel="Şifreyi göster"
          hidePasswordLabel="Şifreyi gizle"
          data-modal-primary-focus
        />
        {error && <ModalError error={error} />}
      </Stack>
    </Modal>
  );
}
