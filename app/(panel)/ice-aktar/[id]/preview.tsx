"use client";

import {
  Accordion,
  AccordionItem,
  Button,
  Dropdown,
  IconButton,
  InlineNotification,
  Modal,
  Pagination,
  Search,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  Tag,
  TextInput,
  Tile,
  Toggle,
} from "@carbon/react";
import { ArrowLeft, Checkmark, Edit, TrashCan } from "@carbon/icons-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { ImportSummary, PreviewRow, SectionSummary } from "@/lib/import/students.ts";
import { BATCH_STATUS } from "@/lib/import/labels.ts";
import { confirmBatchAction, deleteBatchAction, resolveConflictAction, updateEmailAction } from "../actions.ts";

interface BatchInfo {
  id: number;
  fileName: string;
  status: string;
  createdAt: string;
  createdBy: string | null;
  academicYear: string | null;
  summary: ImportSummary;
}

/** Listenin yılının sistemdeki son listeye göre durumu (sunucuda hesaplanır) */
export interface YearInfo {
  latest?: string; // sistemdeki son listenin yılı
  gap?: number; // bu liste ile son liste arasındaki yıl farkı
  problem?: string; // bu yıl artık yüklenemez
}

type TagType = "green" | "blue" | "red" | "magenta" | "gray" | "teal" | "warm-gray" | "purple" | "cyan";

const EMAIL_NOTES: Record<string, { label: string; type: TagType }> = {
  "second-name": { label: "ikinci isimle", type: "teal" },
  numbered: { label: "sayı eki", type: "magenta" },
  manual: { label: "elle", type: "purple" },
  existing: { label: "mevcut", type: "gray" },
};

function needsAttention(r: PreviewRow) {
  if (r.match.kind === "conflict") return true;
  return (
    r.errors.length > 0 ||
    r.match.warnings.length > 0 ||
    r.emailNote === "numbered" ||
    r.emailNote === "second-name"
  );
}

function StatusTags({ r }: { r: PreviewRow }) {
  if (r.errors.length) return <Tag type="red" size="sm" title={r.errors.join("\n")}>Hata</Tag>;
  if (r.match.kind === "conflict") return <Tag type="red" size="sm" title={r.match.reason}>Çakışma</Tag>;
  return (
    <>
      {r.match.kind === "new" ? <Tag type="green" size="sm">Yeni hesap</Tag> : <Tag type="blue" size="sm">Mevcut öğrenci</Tag>}
      {r.match.kind === "matched" && r.match.returning && <Tag type="purple" size="sm">Geri dönüş</Tag>}
      {r.match.warnings.length > 0 && (
        <Tag type="warm-gray" size="sm" title={r.match.warnings.join("\n")}>Uyarı</Tag>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "error" | "warning" }) {
  return (
    <Tile className="!min-h-0">
      <p className="text-sm text-secondary">{label}</p>
      <p
        className={`mt-4 text-3xl font-light tabular-nums ${
          tone === "error" && value ? "text-support-error" : tone === "warning" && value ? "text-support-warning" : ""
        }`}
      >
        {value.toLocaleString("tr-TR")}
      </p>
    </Tile>
  );
}

const ALL = { key: "", label: "Tüm şubeler" };

export function Preview({
  batch,
  rows: initialRows,
  canEdit,
  stale,
  yearInfo,
}: {
  batch: BatchInfo;
  rows: PreviewRow[];
  canEdit: boolean;
  stale: boolean;
  yearInfo: YearInfo;
}) {
  const { summary } = batch;
  const [rows, setRows] = useState(initialRows);
  const [section, setSection] = useState(ALL);
  const [query, setQuery] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [editing, setEditing] = useState<PreviewRow | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState<string>();
  const [saving, startSaving] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDeleting] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();
  const [confirming, startConfirming] = useTransition();
  const [resolving, startResolving] = useTransition();
  const [resolveError, setResolveError] = useState<{ rowId: number; message: string }>();

  function resolve(r: PreviewRow, choice: "same" | "new") {
    setResolveError(undefined);
    startResolving(async () => {
      const res = await resolveConflictAction(batch.id, r.id, choice);
      if (res.error) return setResolveError({ rowId: r.id, message: res.error });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...res.row!, id: r.id } : x)));
    });
  }

  const counts = useMemo(
    () => ({
      total: rows.length,
      fresh: rows.filter((r) => r.match.kind === "new" && !r.errors.length).length,
      matched: rows.filter((r) => r.match.kind === "matched").length,
      returning: rows.filter((r) => r.match.kind === "matched" && r.match.returning).length,
      conflicts: rows.filter((r) => r.match.kind === "conflict" && !r.errors.length).length,
      attention: rows.filter(needsAttention).length,
      errors: rows.filter((r) => r.errors.length || r.match.kind === "conflict").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR");
    return rows.filter(
      (r) =>
        (!section.key || r.sectionKey === section.key) &&
        (!onlyAttention || needsAttention(r)) &&
        (!q ||
          `${r.firstName} ${r.lastName}`.toLocaleLowerCase("tr-TR").includes(q) ||
          r.schoolNo.includes(q) ||
          r.email?.includes(q)),
    );
  }, [rows, section, query, onlyAttention]);

  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sectionInfo: SectionSummary | undefined = summary.sections.find((s) => s.key === section.key);
  const domain = rows.find((r) => r.email)?.email?.split("@")[1] ?? "";

  const reportDate = summary.reportDate ? new Date(summary.reportDate) : null;
  const reportOld = reportDate && Date.now() - reportDate.getTime() > 180 * 864e5;
  const status = BATCH_STATUS[batch.status] ?? { label: batch.status, type: "gray" as const };
  const sectionItems = [ALL, ...summary.sections.map((s) => ({ key: s.key, label: `${s.key} (${s.count})` }))];

  function openEdit(r: PreviewRow) {
    setEditing(r);
    setDraft(r.email?.split("@")[0] ?? "");
    setEditError(undefined);
  }

  function saveEdit() {
    if (!editing) return;
    startSaving(async () => {
      const res = await updateEmailAction(batch.id, editing.id, draft);
      if (!res.ok) {
        setEditError(res.error);
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === editing.id ? { ...r, email: res.email!, emailNote: "manual" } : r)));
      setEditing(null);
    });
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/ice-aktar" className="mb-4 inline-flex items-center gap-1 text-sm text-interactive hover:underline">
        <ArrowLeft size={16} /> Liste içe aktar
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-normal">{batch.fileName}</h1>
            <Tag type={status.type}>{status.label}</Tag>
          </div>
          <p className="mt-2 text-sm text-secondary">
            {[
              summary.schoolName,
              reportDate && `Rapor tarihi ${reportDate.toLocaleDateString("tr-TR")}`,
              batch.academicYear &&
                `${batch.academicYear} eğitim yılı${summary.year ? (summary.year.source === "manual" ? " (elle seçildi)" : " (rapor tarihinden)") : ""}`,
              `${batch.createdBy ?? "?"} · ${batch.createdAt}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {canEdit && (
          <Button kind="danger--ghost" renderIcon={TrashCan} onClick={() => setConfirmDelete(true)}>
            Önizlemeyi sil
          </Button>
        )}
      </div>

      <div className="mb-6 space-y-2">
        {batch.status === "PARSED" && yearInfo.problem && (
          <InlineNotification kind="error" lowContrast hideCloseButton title="Bu liste onaylanamaz" subtitle={yearInfo.problem} />
        )}
        {summary.year?.source === "manual" && summary.year.detected != null && summary.year.detected !== summary.year.start && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Seçilen yıl rapor tarihiyle uyuşmuyor"
            subtitle={`Rapor tarihine göre liste ${summary.year.detected}-${summary.year.detected + 1} yılına ait, ama ${summary.year.name} seçildi.`}
          />
        )}
        {batch.status === "PARSED" && !yearInfo.problem && summary.year && (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title={
              yearInfo.gap === 0
                ? `${summary.year.name} listesi tekrar yükleniyor`
                : `Onaylanınca güncel eğitim yılı ${summary.year.name} olur`
            }
            subtitle={
              !yearInfo.latest
                ? "Sistemde henüz onaylanmış liste yok."
                : yearInfo.gap === 0
                  ? "Öğrencilerin şubeleri bu listeye göre düzeltilir. Bu listedeki şubelerde önceden kayıtlı olup bu listede olmayanlar Ayrılanlar ekranına düşer."
                  : `Sistemdeki son liste ${yearInfo.latest}.${
                      (yearInfo.gap ?? 1) > 1
                        ? ` Aradaki ${(yearInfo.gap ?? 1) - 1} yılın listesi yüklenmedi; öğrenciler bu sürede her yıl en fazla bir sınıf atlamış sayılır.`
                        : ""
                    } Bu listede olmayan öğrenciler onaydan sonra Ayrılanlar ekranında mezun / nakil olarak onaylanır.`
            }
          />
        )}
        {reportOld && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Eski liste"
            subtitle={`Rapor ${reportDate!.toLocaleDateString("tr-TR")} tarihli. Güncel e-Okul listesi olduğundan emin olun.`}
          />
        )}
        {!summary.google.checked && (
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="Google kontrol edilemedi"
            subtitle={`E-postalar sadece veritabanına göre önerildi; Google'daki mevcut adreslerle çakışabilir. ${summary.google.error ?? ""}`}
          />
        )}
        {summary.google.checked && (
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="Google'da kullanılan adresler hesaba katıldı"
            subtitle={`${summary.google.takenCount?.toLocaleString("tr-TR")} adres (kullanıcı, grup ve takma adlar) önerilerde atlandı.`}
          />
        )}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-px bg-subtle sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Şube" value={summary.sections.length} />
        <Stat label="Öğrenci" value={counts.total} />
        <Stat label="Yeni hesap" value={counts.fresh} />
        <Stat label="Mevcut öğrenci" value={counts.matched} />
        <Stat label="Dikkat gereken" value={counts.attention} tone="warning" />
        <Stat label="Hata / çakışma" value={counts.errors} tone="error" />
      </div>

      {summary.issues.length > 0 && (
        <Accordion className="mb-8">
          <AccordionItem title={`Liste okunurken ${summary.issues.length} sorun bulundu`} open>
            <ul className="space-y-1 text-sm">
              {summary.issues.map((i, n) => (
                <li key={n} className={i.level === "error" ? "text-support-error" : ""}>
                  {i.source ? `[${i.source}] ` : ""}
                  {i.message}
                </li>
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      )}

      <TableContainer
        title="Öğrenciler"
        description={
          sectionInfo
            ? `${sectionInfo.key}${sectionInfo.field && sectionInfo.field !== "ALANI YOK" ? ` · ${sectionInfo.field}` : ""} · Sınıf öğretmeni: ${sectionInfo.advisorName ?? "—"} · OU: ${sectionInfo.orgUnitPath} · Grup: ${sectionInfo.groupEmail}${
                sectionInfo.expectedTotal != null && sectionInfo.expectedTotal !== sectionInfo.count
                  ? ` · ⚠ raporda ${sectionInfo.expectedTotal}, okunan ${sectionInfo.count}`
                  : ""
              }`
            : "Bir şube seçerek OU, sınıf grubu ve sınıf öğretmeni bilgisini görün."
        }
      >
        <TableToolbar aria-label="Filtreler">
          <TableToolbarContent className="!justify-start">
            <Search
              size="lg"
              labelText="Ara"
              placeholder="Ad, okul no veya e-posta"
              value={query}
              onChange={(e: { target: { value: string } }) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              closeButtonLabelText="Aramayı temizle"
            />
            <div className="w-56 shrink-0">
              <Dropdown
                id="section"
                titleText=""
                hideLabel
                label="Şube"
                items={sectionItems}
                itemToString={(i: typeof ALL | null) => i?.label ?? ""}
                selectedItem={sectionItems.find((i) => i.key === section.key) ?? ALL}
                onChange={({ selectedItem }: { selectedItem: typeof ALL | null }) => {
                  setSection(selectedItem ?? ALL);
                  setPage(1);
                }}
                size="lg"
              />
            </div>
            <div className="flex shrink-0 items-center px-4">
              <Toggle
                id="attention"
                size="sm"
                labelText="Sadece dikkat gerekenler"
                hideLabel
                labelA="Sadece dikkat gerekenler"
                labelB="Sadece dikkat gerekenler"
                toggled={onlyAttention}
                onToggle={(v: boolean) => {
                  setOnlyAttention(v);
                  setPage(1);
                }}
              />
            </div>
          </TableToolbarContent>
        </TableToolbar>

        <Table aria-label="Öğrenciler" size="md">
          <TableHead>
            <TableRow>
              <TableHeader>Şube</TableHeader>
              <TableHeader>S.No</TableHeader>
              <TableHeader>Okul no</TableHeader>
              <TableHeader>Ad Soyad</TableHeader>
              <TableHeader>Cinsiyet</TableHeader>
              <TableHeader>E-posta</TableHeader>
              <TableHeader>Durum</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((r) => {
              const note = r.emailNote ? EMAIL_NOTES[r.emailNote] : undefined;
              const detail = [
                ...r.errors,
                ...(r.match.kind === "conflict" ? [r.match.reason] : r.match.warnings),
              ];
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">{r.sectionKey}</TableCell>
                  <TableCell className="tabular-nums">{r.rowNo}</TableCell>
                  <TableCell className="tabular-nums">{r.schoolNo}</TableCell>
                  <TableCell>
                    {r.firstName} {r.lastName}
                    {detail.length > 0 && <p className="mt-1 text-xs text-helper">{detail.join(" · ")}</p>}
                  </TableCell>
                  <TableCell>{r.gender === "F" ? "Kız" : r.gender === "M" ? "Erkek" : "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{r.email ?? "—"}</span>
                      {note && (
                        <Tag type={note.type} size="sm">
                          {note.label}
                        </Tag>
                      )}
                      {canEdit && r.match.kind === "new" && r.email && (
                        <IconButton kind="ghost" size="sm" label="E-postayı değiştir" align="left" onClick={() => openEdit(r)}>
                          <Edit />
                        </IconButton>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <StatusTags r={r} />
                    {canEdit && r.match.kind === "conflict" && !r.errors.length && (
                      <div className="mt-1 flex gap-1">
                        <Button kind="ghost" size="sm" disabled={resolving} onClick={() => resolve(r, "same")}>
                          Aynı öğrenci
                        </Button>
                        <Button kind="ghost" size="sm" disabled={resolving} onClick={() => resolve(r, "new")}>
                          Yeni öğrenci
                        </Button>
                      </div>
                    )}
                    {resolveError?.rowId === r.id && <p className="mt-1 text-xs text-support-error">{resolveError.message}</p>}
                  </TableCell>
                </TableRow>
              );
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-secondary">
                  Filtreye uyan öğrenci yok.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Pagination
          page={page}
          pageSize={pageSize}
          pageSizes={[25, 50, 100, 250]}
          totalItems={filtered.length}
          itemsPerPageText="Sayfa başına"
          pageRangeText={(_c: number, total: number) => `/ ${total} sayfa`}
          itemRangeText={(min: number, max: number, total: number) => `${min}–${max} / ${total} öğrenci`}
          backwardText="Önceki sayfa"
          forwardText="Sonraki sayfa"
          onChange={({ page, pageSize }: { page: number; pageSize: number }) => {
            setPage(page);
            setPageSize(pageSize);
          }}
        />
      </TableContainer>

      {summary.result ? (
        <InlineNotification
          className="mt-8 max-w-none!"
          kind="success"
          lowContrast
          hideCloseButton
          title="Liste onaylandı"
          subtitle={`${summary.result.year ? `${summary.result.year}: ` : ""}${summary.result.created.toLocaleString("tr-TR")} yeni öğrenci, ${summary.result.updated.toLocaleString("tr-TR")} güncelleme${summary.result.returned ? ` (${summary.result.returned} geri dönüş)` : ""}, ${summary.result.sections} şube kaydedildi; ${summary.result.jobs.toLocaleString("tr-TR")} Google işi kuyruğa alındı.${
            summary.result.skipped + summary.result.failed
              ? ` ${(summary.result.skipped + summary.result.failed).toLocaleString("tr-TR")} satır alınmadı.`
              : ""
          }`}
        />
      ) : yearInfo.problem ? null : stale ? (
        <InlineNotification
          className="mt-8 max-w-none!"
          kind="warning"
          lowContrast
          hideCloseButton
          title="Önizleme eskidi"
          subtitle="Bu önizlemeden sonra başka bir liste onaylandı; eşleşmeler değişmiş olabilir. Listeyi tekrar yükleyin."
        />
      ) : (
        canEdit && (
          <Tile className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="mb-2 text-lg">Listeyi onayla</h2>
              <p className="max-w-3xl text-sm text-secondary">
                Öğrenciler, şubeler ve sınıf grupları veritabanına yazılır; hesap, OU ve grup işlemleri Google
                senkronizasyon kuyruğuna alınır. Hata ve çakışması olan satırlar alınmaz; çakışmaları tablodan
                &quot;Aynı öğrenci&quot; ya da &quot;Yeni öğrenci&quot; seçerek çözebilirsiniz.
              </p>
            </div>
            <Button renderIcon={Checkmark} onClick={() => { setConfirmError(undefined); setConfirmOpen(true); }}>
              Onayla
            </Button>
          </Tile>
        )
      )}

      <Modal
        open={Boolean(editing)}
        modalHeading="E-postayı değiştir"
        modalLabel={editing ? `${editing.firstName} ${editing.lastName} · ${editing.sectionKey}` : ""}
        primaryButtonText={saving ? "Kaydediliyor…" : "Kaydet"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={saving || !draft.trim()}
        onRequestClose={() => setEditing(null)}
        onRequestSubmit={saveEdit}
        size="sm"
      >
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextInput
              id="email-local"
              labelText="Kullanıcı adı"
              value={draft}
              onChange={(e: { target: { value: string } }) => setDraft(e.target.value)}
              invalid={Boolean(editError)}
              invalidText={editError}
              data-modal-primary-focus
            />
          </div>
          <span className="pb-3 font-mono text-sm text-secondary">@{domain}</span>
        </div>
        <p className="mt-4 text-xs text-helper">
          Veritabanında, Google&apos;da ve bu listede kullanılmayan bir adres olmalı. Hesap açıldıktan sonra adres
          değişmez.
        </p>
      </Modal>

      <Modal
        open={confirmDelete}
        danger
        modalHeading="Önizleme silinsin mi?"
        primaryButtonText={deleting ? "Siliniyor…" : "Sil"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={deleting}
        onRequestClose={() => setConfirmDelete(false)}
        onRequestSubmit={() => startDeleting(() => deleteBatchAction(batch.id))}
        size="xs"
      >
        <p className="text-sm">
          Sadece bu önizleme ve e-posta düzenlemeleri silinir. Google&apos;da ve öğrenci kayıtlarında değişiklik olmaz.
        </p>
      </Modal>

      <Modal
        open={confirmOpen}
        modalHeading="Liste onaylansın mı?"
        primaryButtonText={confirming ? "Onaylanıyor…" : "Onayla"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={confirming}
        onRequestClose={() => setConfirmOpen(false)}
        onRequestSubmit={() =>
          startConfirming(async () => {
            const res = await confirmBatchAction(batch.id);
            if (res.error) setConfirmError(res.error);
            else setConfirmOpen(false);
          })
        }
        size="sm"
      >
        <ul className="mb-4 space-y-1 text-sm">
          {summary.year && yearInfo.gap !== 0 && <li>Güncel eğitim yılı {summary.year.name} olacak</li>}
          {counts.returning > 0 && <li>{counts.returning} öğrenci okula geri dönüş olarak alınacak (ayrılış kaydı silinir)</li>}
          {counts.fresh > 0 && <li>{counts.fresh.toLocaleString("tr-TR")} yeni öğrenci hesabı açılacak</li>}
          {counts.matched > 0 && <li>{counts.matched.toLocaleString("tr-TR")} mevcut öğrencinin şubesi güncellenecek</li>}
          <li>{summary.sections.length} şube, OU ve sınıf grubu hazırlanacak</li>
          {counts.errors > 0 && (
            <li className="text-support-error">
              {counts.errors.toLocaleString("tr-TR")} hatalı / çakışmalı satır alınmayacak
              {counts.conflicts > 0 && ` (${counts.conflicts} çakışma hâlâ çözülebilir)`}
            </li>
          )}
        </ul>
        <p className="text-xs text-helper">
          Onaydan sonra önizleme değiştirilemez. Google&apos;daki işlemler kuyruktan sırayla yapılır.
        </p>
        {confirmError && (
          <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="Onaylanamadı" subtitle={confirmError} />
        )}
      </Modal>
    </div>
  );
}
