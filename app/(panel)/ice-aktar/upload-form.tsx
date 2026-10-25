"use client";

import {
  Button,
  FileUploaderDropContainer,
  FileUploaderItem,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
} from "@carbon/react";
import { DocumentImport } from "@carbon/icons-react";
import { useActionState, useState, startTransition } from "react";
import { uploadRosterAction, type UploadState } from "./actions.ts";

export function UploadForm({ formats, years, latest }: { formats: string[]; years: number[]; latest?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState("");
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadRosterAction, {});

  function submit() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    if (year) fd.set("year", year);
    startTransition(() => action(fd));
  }

  return (
    <div className="space-y-4">
      {state.error && (
        <InlineNotification kind="error" title="Dosya okunamadı" subtitle={state.error} lowContrast hideCloseButton />
      )}

      <div>
        <p className="mb-1 text-sm font-semibold">Okul listesi</p>
        <p className="mb-4 text-sm text-secondary">Desteklenen biçimler: {formats.join(", ")}. En fazla 20 MB.</p>
        <FileUploaderDropContainer
          accept={[".pdf", "application/pdf"]}
          labelText="Dosyayı buraya sürükleyin ya da seçmek için tıklayın"
          disabled={pending}
          onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => {
            if (addedFiles[0]) setFile(addedFiles[0]);
          }}
        />
        {file && (
          <div className="mt-2 max-w-md">
            <FileUploaderItem
              name={file.name}
              status={pending ? "uploading" : "edit"}
              iconDescription="Dosyayı kaldır"
              onDelete={() => setFile(null)}
              size="md"
            />
          </div>
        )}
      </div>

      <div className="max-w-sm">
        <Select
          id="year"
          labelText="Listenin eğitim yılı"
          helperText={`Otomatikte rapor tarihine bakılır (Eylül ve sonrası o yılın eğitim yılı).${
            latest ? ` Sistemdeki son liste: ${latest}; daha eski yıl yüklenemez.` : ""
          }`}
          value={year}
          disabled={pending}
          onChange={(e: { target: { value: string } }) => setYear(e.target.value)}
        >
          <SelectItem value="" text="Otomatik (rapor tarihinden)" />
          {years.map((y) => (
            <SelectItem key={y} value={String(y)} text={`${y}-${y + 1}`} />
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <Button renderIcon={DocumentImport} disabled={!file || pending} onClick={submit}>
          Listeyi oku ve önizle
        </Button>
        {pending && <InlineLoading description="Liste okunuyor, e-postalar hazırlanıyor…" />}
      </div>
      <p className="text-xs text-helper">
        Bu adım sadece önizleme oluşturur. Google&apos;da ve öğrenci kayıtlarında hiçbir şey değişmez; PDF dosyası
        saklanmaz.
      </p>
    </div>
  );
}
