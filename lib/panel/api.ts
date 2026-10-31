// Supabase REST istemcisi. Yalnızca köprünün kullandığı tablolara dokunur.

import type { PanelRole } from "./roles.ts";

export type CommandKind = "grant_editor" | "revoke_editor" | "add_member";

export interface PanelCommand {
  id: number;
  kind: CommandKind;
  club_code: string;
  email: string;
  requested_by: string;
}

export interface PanelClub {
  code: string;
  is_active: boolean;
}

export interface PanelRecipient {
  id: number;
  email: string | null;
  file_id: string;
  attempts: number;
  club_code: string;
  title: string;
  event_date: string;
  issuer: string;
  requested_by: string;
}

export interface PanelCertificate {
  creator: string;
  head: string;
  given: string;
  date: string;
  file_id: string;
  uploader_mail: string;
}

export interface RecipientResult {
  status?: "sent" | "failed";
  name?: string;
  email?: null;
  error?: string | null;
  attempts?: number;
  sent_at?: string;
}

export interface PanelApi {
  listRoles(): Promise<PanelRole[]>;
  saveRoles(rows: PanelRole[]): Promise<void>;
  removeRole(row: PanelRole): Promise<void>;
  listClubs(): Promise<PanelClub[]>;
  addClubs(rows: { code: string; title: string }[]): Promise<void>;
  setClubActive(code: string, active: boolean): Promise<void>;
  pendingCommands(): Promise<PanelCommand[]>;
  finishCommand(id: number, error: string | null): Promise<void>;
  pendingRecipients(): Promise<PanelRecipient[]>;
  certificateExists(fileId: string): Promise<boolean>;
  addCertificate(row: PanelCertificate): Promise<void>;
  finishRecipient(id: number, result: RecipientResult): Promise<void>;
}

export function panelApiFromEnv(): PanelApi | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createPanelApi(url, key) : null;
}

export function createPanelApi(url: string, key: string, fetcher: typeof fetch = fetch): PanelApi {
  async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
    const { prefer, ...rest } = init;
    const res = await fetcher(`${url}/rest/v1/${path}`, {
      ...rest,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

  return {
    async listRoles() {
      return (await rest("panel_roles?select=email,club_code,role,name")).json();
    },
    async saveRoles(rows) {
      await rest("panel_roles", { method: "POST", body: JSON.stringify(rows), prefer: "resolution=merge-duplicates" });
    },
    async removeRole(r) {
      await rest(`panel_roles?email=${eq(r.email)}&club_code=${eq(r.club_code)}&role=${eq(r.role)}`, { method: "DELETE" });
    },
    async listClubs() {
      const rows = (await (await rest("clubs?select=code,is_active")).json()) as { code: string | null; is_active: boolean }[];
      return rows.flatMap((r) => (r.code ? [{ code: r.code, is_active: r.is_active }] : []));
    },
    async addClubs(rows) {
      await rest("clubs", { method: "POST", body: JSON.stringify(rows) });
    },
    async setClubActive(code, active) {
      await rest(`clubs?code=${eq(code)}`, { method: "PATCH", body: JSON.stringify({ is_active: active }) });
    },
    async pendingCommands() {
      return (await rest("directory_commands?select=id,kind,club_code,email,requested_by&status=eq.pending&order=id&limit=50")).json();
    },
    async finishCommand(id, error) {
      await rest(`directory_commands?id=eq.${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: error ? "failed" : "done", error, finished_at: new Date().toISOString() }),
      });
    },
    async pendingRecipients() {
      const rows = (await (
        await rest(
          "certificate_recipients?select=id,email,file_id,attempts,certificate_batches(club_code,title,event_date,issuer,requested_by)&status=eq.pending&order=id&limit=30",
        )
      ).json()) as (Omit<PanelRecipient, "club_code" | "title" | "event_date" | "issuer" | "requested_by"> & {
        certificate_batches: Pick<PanelRecipient, "club_code" | "title" | "event_date" | "issuer" | "requested_by">;
      })[];
      return rows.map(({ certificate_batches: batch, ...r }) => ({ ...r, ...batch }));
    },
    async certificateExists(fileId) {
      return ((await (await rest(`cert?select=id&file_id=${eq(fileId)}&limit=1`)).json()) as unknown[]).length > 0;
    },
    async addCertificate(row) {
      await rest("cert", { method: "POST", body: JSON.stringify(row) });
    },
    async finishRecipient(id, result) {
      await rest(`certificate_recipients?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(result) });
    },
  };
}
