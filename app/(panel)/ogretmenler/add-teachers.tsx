"use client";

import {
  Button,
  Checkbox,
  InlineNotification,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextArea,
  TextInput,
} from "@carbon/react";
import { UserFollow } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import type { TeacherDraft } from "@/lib/teachers.ts";
import { createTeachersAction, draftTeachersAction } from "./actions.ts";

type Row = TeacherDraft & { include: boolean; local: string };

/** Yapıştırılan listeden öğretmen ekleme: önce adres önerileri, sonra onay */
export function AddTeachers({ domain }: { domain: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [googleChecked, setGoogleChecked] = useState(true);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const reset = () => {
    setOpen(false);
    setRows(null);
    setText("");
    setError(undefined);
  };
  const chosen = rows?.filter((r) => r.include && !r.error) ?? [];

  function preview() {
    setError(undefined);
    start(async () => {
      const res = await draftTeachersAction(text);
      if (res.error) return setError(res.error);
      setGoogleChecked(Boolean(res.googleChecked));
      setRows(
        res.rows!.map((r) => ({ ...r, include: !r.error && !r.warning, local: r.email?.split("@")[0] ?? "" })),
      );
    });
  }

  function submit() {
    setError(undefined);
    start(async () => {
      const res = await createTeachersAction(
        chosen.map((r) => ({ firstName: r.firstName, lastName: r.lastName, branch: r.branch, email: `${r.local.trim()}@${domain}` })),
      );
      if (res.error) return setError(res.error);
      reset();
    });
  }

  const update = (line: number, patch: Partial<Row>) => setRows((p) => p!.map((r) => (r.line === line ? { ...r, ...patch } : r)));

  return (
    <>
      <Button renderIcon={UserFollow} onClick={() => setOpen(true)}>
        Öğretmen ekle
      </Button>
      <Modal
        open={open}
        modalHeading="Öğretmen ekle"
        primaryButtonText={
          pending ? "İşleniyor…" : rows ? `${chosen.length} öğretmeni ekle` : "Adresleri hazırla"
        }
        secondaryButtonText={rows ? "Geri" : "Vazgeç"}
        primaryButtonDisabled={pending || (rows ? chosen.length === 0 : !text.trim())}
        onRequestClose={reset}
        onSecondarySubmit={() => (rows ? setRows(null) : reset())}
        onRequestSubmit={() => (rows ? submit() : preview())}
        size="lg"
      >
        {!rows ? (
          <>
            <TextArea
              id="teacher-lines"
              labelText="Öğretmen listesi"
              helperText="Her satıra bir öğretmen: Ad Soyad ya da Ad Soyad; Branş. Son kelime soyadı sayılır. Excel'den iki sütun kopyalanabilir."
              rows={10}
              value={text}
              onChange={(e: { target: { value: string } }) => setText(e.target.value)}
              placeholder={"Ayşe YILMAZ; Matematik\nMehmet Ali KAYA; Fizik"}
              data-modal-primary-focus
            />
          </>
        ) : (
          <>
            {!googleChecked && (
              <InlineNotification
                className="mb-4"
                kind="warning"
                lowContrast
                hideCloseButton
                title="Google kontrol edilemedi"
                subtitle="Adresler sadece veritabanına göre önerildi; eklerken tekrar kontrol edilir."
              />
            )}
            <Table size="sm" aria-label="Eklenecek öğretmenler">
              <TableHead>
                <TableRow>
                  <TableHeader aria-label="Ekle" />
                  <TableHeader>Ad Soyad</TableHeader>
                  <TableHeader>Branş</TableHeader>
                  <TableHeader>E-posta</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.line}>
                    <TableCell>
                      <Checkbox
                        id={`t-${r.line}`}
                        labelText={`${r.firstName} ${r.lastName}`}
                        hideLabel
                        checked={r.include && !r.error}
                        disabled={Boolean(r.error)}
                        onChange={(_, { checked }) => update(r.line, { include: checked })}
                      />
                    </TableCell>
                    <TableCell>
                      {r.firstName} {r.lastName}
                      {(r.error || r.warning) && (
                        <p className={`mt-1 text-xs ${r.error ? "text-support-error" : "text-helper"}`}>
                          Satır {r.line}: {r.error ?? r.warning}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{r.branch ?? "—"}</TableCell>
                    <TableCell>
                      {r.email && (
                        <div className="flex items-center gap-1">
                          <TextInput
                            id={`email-${r.line}`}
                            labelText="Kullanıcı adı"
                            hideLabel
                            size="sm"
                            value={r.local}
                            onChange={(e: { target: { value: string } }) => update(r.line, { local: e.target.value.toLowerCase() })}
                          />
                          <span className="font-mono text-xs text-secondary">@{domain}</span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-helper">
              Aynı isimde kayıtlı olanlar işaretsiz gelir. Adres eklerken tekrar kontrol edilir; hesap açıldıktan sonra
              adres değişmez. Her öğretmen ogretmenler@{domain} grubuna eklenir.
            </p>
          </>
        )}
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="Eklenemedi" subtitle={error} />}
      </Modal>
    </>
  );
}
