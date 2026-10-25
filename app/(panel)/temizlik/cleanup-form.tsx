"use client";

import {
  Button,
  Checkbox,
  InlineNotification,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import { TrashCan } from "@carbon/icons-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { CleanupScan } from "@/lib/cleanup.ts";
import { enqueueCleanupAction } from "./actions.ts";

export function CleanupForm({ scan, canEdit }: { scan: CleanupScan; canEdit: boolean }) {
  const freeOus = scan.ous.filter((o) => !o.blocked).map((o) => o.path);
  const freeGroups = scan.groups.filter((g) => !g.blocked).map((g) => g.id);
  const [ous, setOus] = useState(() => new Set(freeOus));
  const [groups, setGroups] = useState(() => new Set(freeGroups));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<number>();
  const [pending, start] = useTransition();
  const total = ous.size + groups.size;

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  const toggleOu = (path: string, on: boolean) => setOus((prev) => toggle(prev, path, on));

  if (done != null) {
    return (
      <InlineNotification
        kind="success"
        lowContrast
        hideCloseButton
        title={`${done} silme işi kuyruğa alındı`}
        subtitle="Senkronizasyon çalışınca silinir; işçi silmeden önce her birinin hâlâ boş olduğunu tekrar kontrol eder."
      />
    );
  }

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button kind="danger" renderIcon={TrashCan} disabled={total === 0} onClick={() => setOpen(true)}>
            {total} öğeyi silmek üzere kuyruğa al
          </Button>
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-2">
        <TableContainer title="Şube OU'ları" description="/Ogrenciler/{sınıf}/{şube} OU'ları; sınıf seviyesi OU'ları silinmez">
          <Table size="sm" aria-label="OU'lar">
            <TableHead>
              <TableRow>
                <TableHeader aria-label="Seç" />
                <TableHeader>OU</TableHeader>
                <TableHeader>Durum</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {scan.ous.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-secondary">
                    /Ogrenciler altında şube OU&apos;su yok.
                  </TableCell>
                </TableRow>
              )}
              {scan.ous.map((o) => (
                <TableRow key={o.path}>
                  <TableCell>
                    <Checkbox
                      id={`ou-${o.path}`}
                      labelText={o.path}
                      hideLabel
                      disabled={!canEdit || Boolean(o.blocked)}
                      checked={ous.has(o.path)}
                      onChange={(_, { checked }) => toggleOu(o.path, checked)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{o.path}</TableCell>
                  <TableCell className="text-sm">{o.blocked ?? <span className="text-support-success">Boş, silinebilir</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer title="Sınıf grupları" description="Bu yılın hiçbir şubesine bağlı olmayan gruplar">
          <Table size="sm" aria-label="Gruplar">
            <TableHead>
              <TableRow>
                <TableHeader aria-label="Seç" />
                <TableHeader>Grup</TableHeader>
                <TableHeader>Durum</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {scan.groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-secondary">
                    Kullanılmayan sınıf grubu yok.
                  </TableCell>
                </TableRow>
              )}
              {scan.groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Checkbox
                      id={`g-${g.id}`}
                      labelText={g.email}
                      hideLabel
                      disabled={!canEdit || Boolean(g.blocked)}
                      checked={groups.has(g.id)}
                      onChange={(_, { checked }) => setGroups((p) => toggle(p, g.id, checked))}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{g.email}</TableCell>
                  <TableCell className="text-sm">{g.blocked ?? <span className="text-support-success">Boş, silinebilir</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>

      <Modal
        open={open}
        danger
        modalHeading="Seçilenler silinsin mi?"
        primaryButtonText={pending ? "Kuyruğa alınıyor…" : "Kuyruğa al"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => setOpen(false)}
        onRequestSubmit={() =>
          start(async () => {
            const res = await enqueueCleanupAction({ ous: [...ous], groupIds: [...groups] });
            if (res.error) return setError(res.error);
            setOpen(false);
            setDone(res.count ?? 0);
          })
        }
        size="sm"
      >
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
          {ous.size > 0 && <li>{ous.size} OU</li>}
          {groups.size > 0 && <li>{groups.size} sınıf grubu (gruba gelmiş e-postalar da silinir)</li>}
        </ul>
        <p className="text-sm">
          Silme işleri kuyruğun en sonunda çalışır. İşçi her OU&apos;nun ve grubun hâlâ boş olduğunu Google&apos;da tekrar
          kontrol eder; dolu çıkanı silmez. Bir sınıf ileride yeniden açılırsa OU ve grup otomatik yeniden oluşturulur.{" "}
          <Link href="/senkronizasyon" className="text-interactive underline">
            Kuyruk
          </Link>
        </p>
        {error && <InlineNotification className="mt-4" kind="error" lowContrast hideCloseButton title="Kuyruğa alınamadı" subtitle={error} />}
      </Modal>
    </>
  );
}
