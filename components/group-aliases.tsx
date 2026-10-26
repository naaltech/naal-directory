"use client";

// Grubun alt adresleri (Google grup takma adları): kulüp, öğretmenler ve öğretmen grubu sayfalarında.

import {
  Button,
  IconButton,
  Modal,
  Select,
  SelectItem,
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
import { Add, Close } from "@carbon/icons-react";
import { useState, useTransition } from "react";
import { addGroupAliasAction, removeGroupAliasAction } from "@/app/(panel)/gruplar/actions.ts";
import { ENTITY_STATUS, formatDate } from "@/lib/labels.ts";

interface Alias {
  id: number;
  alias_email: string;
  status: string;
  created_at: string;
}

export function GroupAliases({
  groupId,
  groupEmail,
  aliases,
  domains,
  canEdit,
}: {
  groupId: number;
  groupEmail: string;
  aliases: Alias[];
  domains: string[];
  canEdit: boolean;
}) {
  const [local, setLocal] = useState("");
  const [domain, setDomain] = useState(domains[0] ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [removing, setRemoving] = useState<Alias | null>(null);
  const [removeError, setRemoveError] = useState<string>();

  return (
    <TableContainer
      title="Alt adresler"
      description={`Alt adrese gelen e-posta ${groupEmail} grubuna düşer. Adres ${domains.join(" ya da ")} alan adında olabilir.`}
    >
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 px-4 pb-4">
          <div className="w-full sm:w-auto sm:min-w-48 sm:flex-1">
            <TextInput
              id={`alias-local-${groupId}`}
              labelText="Alt adres"
              placeholder="ör. iletisim"
              value={local}
              onChange={(e) => {
                // "ad@alanadi" yapıştırılırsa alan adı seçiciye geçer
                const [l, d] = e.target.value.toLowerCase().trim().split("@");
                setLocal(l);
                if (d && domains.includes(d)) setDomain(d);
                setError(undefined);
              }}
            />
          </div>
          <div className="w-full sm:w-64">
            <Select id={`alias-domain-${groupId}`} labelText="Alan adı" value={domain} onChange={(e) => setDomain(e.target.value)}>
              {domains.map((d) => (
                <SelectItem key={d} value={d} text={`@${d}`} />
              ))}
            </Select>
          </div>
          <Button
            size="md"
            renderIcon={Add}
            disabled={!local || pending}
            onClick={() =>
              start(async () => {
                const res = await addGroupAliasAction(groupId, local, domain);
                setError(res.error);
                if (!res.error) setLocal("");
              })
            }
          >
            Alt adres ekle
          </Button>
          {error && <p className="w-full text-sm text-support-error">{error}</p>}
        </div>
      )}
      <Table size="md" aria-label="Alt adresler">
        <TableHead>
          <TableRow>
            <TableHeader>Adres</TableHeader>
            <TableHeader>Durum</TableHeader>
            <TableHeader>Eklenme</TableHeader>
            {canEdit && <TableHeader aria-label="İşlem" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {aliases.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 4 : 3} className="text-secondary">
                Alt adres yok.
              </TableCell>
            </TableRow>
          )}
          {aliases.map((a) => {
            const st = ENTITY_STATUS[a.status] ?? { label: a.status, type: "gray" as const };
            return (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-sm">{a.alias_email}</TableCell>
                <TableCell>
                  <Tag type={st.type} size="sm">
                    {st.label}
                  </Tag>
                </TableCell>
                <TableCell>{formatDate(a.created_at)}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <IconButton kind="ghost" size="sm" label="Alt adresi kaldır" align="left" onClick={() => setRemoving(a)}>
                      <Close />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Modal
        open={removing !== null}
        danger
        modalHeading="Alt adres kaldırılsın mı?"
        primaryButtonText={pending ? "Kaldırılıyor…" : "Kaldır"}
        secondaryButtonText="Vazgeç"
        primaryButtonDisabled={pending}
        onRequestClose={() => {
          setRemoving(null);
          setRemoveError(undefined);
        }}
        onRequestSubmit={() =>
          start(async () => {
            const res = await removeGroupAliasAction(groupId, removing!.id);
            if (res.error) return setRemoveError(res.error);
            setRemoving(null);
          })
        }
        size="xs"
      >
        <p className="text-sm">
          <span className="font-mono">{removing?.alias_email}</span> adresine gelen e-postalar artık gruba ulaşmaz. Adres
          sonra başka bir gruba ya da kişiye verilebilir.
        </p>
        {removeError && <p className="mt-4 text-sm text-support-error">{removeError}</p>}
      </Modal>
    </TableContainer>
  );
}
