// İşçinin Google'a eriştiği arayüz. Gerçek çalıştırmada Directory API'ye gider;
// deneme (dry-run) çalıştırmasında yazma isteği atılmaz, Google'ın o anki hali bir kez okunur
// ve yazmalar bu kopya üzerinde taklit edilir. İşleyiciler iki durumda da aynı kodla çalışır.

import { directory, GoogleApiError, groupSettings, listAll } from "../google/api.ts";

export interface GoogleRequest {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: object;
}

export interface Google {
  readonly dryRun: boolean;
  get<T>(path: string): Promise<T>;
  send<T = unknown>(req: GoogleRequest): Promise<T>;
  /** Groups Settings API: verilen ayarları uygular, grubun güncel ayarlarını döndürür */
  patchGroupSettings(groupEmail: string, settings: Record<string, string>): Promise<Record<string, string>>;
}

export const enc = encodeURIComponent;

/** /Ogrenciler/9/9-A → customer/my_customer/orgunits/Ogrenciler/9/9-A */
export function orgUnitUrl(path: string) {
  return `customer/my_customer/orgunits/${path.replace(/^\//, "").split("/").map(enc).join("/")}`;
}

export const liveGoogle: Google = {
  dryRun: false,
  get: (path) => directory(path),
  send: ({ method, path, body }) =>
    directory(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
  patchGroupSettings: (groupEmail, settings) =>
    groupSettings(groupEmail, { method: "PATCH", body: JSON.stringify(settings) }),
};

// ───── Deneme ─────

interface SimUser {
  id: string;
  primaryEmail: string;
  name: { givenName: string; familyName: string };
  orgUnitPath: string;
  aliases?: string[];
}

/** Şifre gibi alanlar deneme çıktısına yazılmaz */
function redact(body?: object) {
  if (!body) return body;
  const copy: Record<string, unknown> = { ...body };
  if ("password" in copy) copy.password = "***";
  return copy;
}

export class DryRunGoogle implements Google {
  readonly dryRun: boolean = true;
  readonly requests: GoogleRequest[] = [];
  private ous = new Set<string>();
  private users = new Map<string, SimUser>(); // birincil adres ve takma adlar → kullanıcı
  private groups = new Map<string, { id: string; email: string }>();
  private members = new Set<string>(); // "grup|üye"; sadece bu çalıştırmada eklenenler bilinir
  private seq = 0;

  /** Google'ın şu anki halini okur (3 liste isteği, hiçbir şey değiştirmez) */
  static async snapshot(): Promise<DryRunGoogle> {
    const g = new DryRunGoogle();
    const [ous, users, groups] = await Promise.all([
      directory<{ organizationUnits?: { orgUnitPath: string }[] }>("customer/my_customer/orgunits?type=all"),
      listAll<SimUser & { nonEditableAliases?: string[] }>(
        "users?customer=my_customer&fields=nextPageToken,users(id,primaryEmail,name,orgUnitPath,aliases,nonEditableAliases)",
        "users",
      ),
      listAll<{ id: string; email: string; aliases?: string[] }>(
        "groups?customer=my_customer&fields=nextPageToken,groups(id,email,aliases)",
        "groups",
      ),
    ]);
    g.ous.add("/");
    ous.organizationUnits?.forEach((o) => g.ous.add(o.orgUnitPath));
    for (const u of users) {
      for (const e of [u.primaryEmail, ...(u.aliases ?? []), ...(u.nonEditableAliases ?? [])]) g.users.set(e.toLowerCase(), u);
    }
    for (const gr of groups) {
      for (const e of [gr.email, ...(gr.aliases ?? [])]) g.groups.set(e.toLowerCase(), gr);
    }
    return g;
  }

  /** Google'a hiç bağlanmadan: her şey yokmuş gibi */
  static offline(): DryRunGoogle {
    const g = new DryRunGoogle();
    g.ous.add("/");
    return g;
  }

  private notFound(path: string): never {
    throw new GoogleApiError(404, path, "Resource Not Found (deneme)");
  }
  private taken(email: string) {
    const e = email.toLowerCase();
    return this.users.has(e) || this.groups.has(e);
  }

  async get<T>(path: string): Promise<T> {
    const [base, qs] = path.split("?");
    const q = new URLSearchParams(qs ?? "");
    let m: RegExpMatchArray | null;
    if (base === "customer/my_customer/orgunits") {
      // Alt OU'lar (type=children)
      const parent = q.get("orgUnitPath") ?? "/";
      const prefix = parent === "/" ? "/" : `${parent}/`;
      const children = [...this.ous].filter((o) => o.startsWith(prefix) && o !== parent && !o.slice(prefix.length).includes("/"));
      return { organizationUnits: children.map((orgUnitPath) => ({ orgUnitPath })) } as T;
    }
    if (base === "users") {
      // Sadece orgUnitPath='...' sorgusu (alt OU'lar dahil, Google gibi)
      const ou = q.get("query")?.match(/^orgUnitPath='(.+)'$/)?.[1];
      if (!ou) throw new Error(`Deneme modunda desteklenmeyen kullanıcı sorgusu: ${path}`);
      const users = [...new Set(this.users.values())].filter((u) => u.orgUnitPath === ou || u.orgUnitPath.startsWith(`${ou}/`));
      return { users: users.slice(0, Number(q.get("maxResults")) || users.length) } as T;
    }
    if ((m = base.match(/^customer\/my_customer\/orgunits\/(.+)$/))) {
      const p = "/" + m[1].split("/").map(decodeURIComponent).join("/");
      return (this.ous.has(p) ? { orgUnitPath: p } : this.notFound(base)) as T;
    }
    if ((m = base.match(/^users\/([^/]+)$/))) return (this.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(base)) as T;
    if ((m = base.match(/^groups\/([^/]+)$/))) return (this.groups.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(base)) as T;
    throw new Error(`Deneme modunda desteklenmeyen okuma: ${base}`);
  }

  async patchGroupSettings(groupEmail: string, settings: Record<string, string>): Promise<Record<string, string>> {
    if (!this.groups.has(groupEmail.toLowerCase())) this.notFound(`settings/groups/${groupEmail}`);
    this.requests.push({ method: "PUT", path: `settings/groups/${groupEmail}`, body: settings });
    return { ...settings };
  }

  async send<T>(req: GoogleRequest): Promise<T> {
    const { method, path } = req;
    const body = (req.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let m: RegExpMatchArray | null;
    const result = (): T => {
      this.requests.push({ method, path, body: redact(req.body) });
      return {} as T;
    };
    const conflict = (): never => {
      throw new GoogleApiError(409, path, "Entity already exists (deneme)");
    };

    if (method === "POST" && path === "customer/my_customer/orgunits") {
      const p = `${body.parentOrgUnitPath === "/" ? "" : body.parentOrgUnitPath}/${body.name}`;
      if (!this.ous.has(body.parentOrgUnitPath)) this.notFound(`orgunits${body.parentOrgUnitPath}`);
      if (this.ous.has(p)) conflict();
      this.ous.add(p);
      return result();
    }
    if (method === "POST" && path === "groups") {
      if (this.taken(body.email)) conflict();
      this.groups.set(body.email.toLowerCase(), { id: `sim-${++this.seq}`, email: body.email });
      result();
      return { id: `sim-${this.seq}`, email: body.email } as T;
    }
    if (method === "POST" && path === "users") {
      if (this.taken(body.primaryEmail)) conflict();
      if (!this.ous.has(body.orgUnitPath)) throw new GoogleApiError(400, path, `Invalid Input: OrgUnit ${body.orgUnitPath} yok (deneme)`);
      const u: SimUser = { id: `sim-${++this.seq}`, primaryEmail: body.primaryEmail, name: body.name, orgUnitPath: body.orgUnitPath };
      this.users.set(body.primaryEmail.toLowerCase(), u);
      result();
      return u as T;
    }
    if ((m = path.match(/^users\/([^/]+)$/)) && method === "PUT") {
      const u = this.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(path);
      if (body.orgUnitPath && !this.ous.has(body.orgUnitPath)) throw new GoogleApiError(400, path, "Invalid Input: OrgUnit (deneme)");
      if (body.primaryEmail) {
        // Yeniden adlandırma: eski adres takma ad olarak kalır
        const next = String(body.primaryEmail).toLowerCase();
        if (this.taken(next) && this.users.get(next) !== u) conflict();
        this.users.set(next, u);
      }
      Object.assign(u, body);
      return result();
    }
    if ((m = path.match(/^users\/([^/]+)$/)) && method === "DELETE") {
      const u = this.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(path);
      for (const [k, v] of this.users) if (v === u) this.users.delete(k);
      return result();
    }
    if ((m = path.match(/^users\/([^/]+)\/aliases$/)) && method === "POST") {
      const u = this.users.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(path);
      if (this.taken(body.alias)) conflict();
      this.users.set(body.alias.toLowerCase(), u);
      return result();
    }
    if ((m = path.match(/^users\/([^/]+)\/aliases\/([^/]+)$/)) && method === "DELETE") {
      const alias = decodeURIComponent(m[2]).toLowerCase();
      if (!this.users.has(alias)) this.notFound(path);
      this.users.delete(alias);
      return result();
    }
    if ((m = path.match(/^groups\/([^/]+)\/aliases$/)) && method === "POST") {
      const gr = this.groups.get(decodeURIComponent(m[1]).toLowerCase()) ?? this.notFound(path);
      if (this.taken(body.alias)) conflict();
      this.groups.set(body.alias.toLowerCase(), gr);
      return result();
    }
    if ((m = path.match(/^groups\/([^/]+)\/aliases\/([^/]+)$/)) && method === "DELETE") {
      const alias = decodeURIComponent(m[2]).toLowerCase();
      if (!this.groups.has(alias)) this.notFound(path);
      this.groups.delete(alias);
      return result();
    }
    if ((m = path.match(/^groups\/([^/]+)$/)) && (method === "PUT" || method === "DELETE")) {
      const key = decodeURIComponent(m[1]).toLowerCase();
      const gr = this.groups.get(key) ?? this.notFound(path);
      if (method === "DELETE") for (const [k, v] of this.groups) if (v === gr) this.groups.delete(k);
      return result();
    }
    if ((m = path.match(/^customer\/my_customer\/orgunits\/(.+)$/)) && method === "DELETE") {
      const p = "/" + m[1].split("/").map(decodeURIComponent).join("/");
      if (!this.ous.has(p)) this.notFound(path);
      if ([...this.ous].some((o) => o.startsWith(`${p}/`))) throw new GoogleApiError(400, path, "OU has sub-units (deneme)");
      if ([...this.users.values()].some((u) => u.orgUnitPath === p)) throw new GoogleApiError(400, path, "OU has users (deneme)");
      this.ous.delete(p);
      return result();
    }
    if ((m = path.match(/^groups\/([^/]+)\/members$/)) && method === "POST") {
      const group = decodeURIComponent(m[1]).toLowerCase();
      if (!this.groups.has(group)) this.notFound(path);
      if (!this.users.has(body.email.toLowerCase())) this.notFound(`${path} (üye)`);
      const key = `${group}|${body.email.toLowerCase()}`;
      if (this.members.has(key)) conflict();
      this.members.add(key);
      return result();
    }
    if ((m = path.match(/^groups\/([^/]+)\/members\/([^/]+)$/)) && method === "DELETE") {
      if (!this.groups.has(decodeURIComponent(m[1]).toLowerCase())) this.notFound(path);
      this.members.delete(`${decodeURIComponent(m[1])}|${decodeURIComponent(m[2])}`.toLowerCase());
      return result();
    }
    throw new Error(`Deneme modunda desteklenmeyen istek: ${method} ${path}`);
  }
}
