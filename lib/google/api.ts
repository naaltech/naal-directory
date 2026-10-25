// Google Admin SDK istemcisi: servis hesabı + alan genelinde yetki (DWD).
// Ek kütüphane kullanmadan JWT imzalar; erişim anahtarı süresi dolana kadar önbellekte tutulur.
// "server-only" yok: komut satırındaki senkronizasyon işçisi de kullanır. Panel tarafı client.ts'ten alır.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let cached: { token: string; expiresAt: number } | null = null;

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE && process.env.GOOGLE_ADMIN_IMPERSONATE);
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!isGoogleConfigured()) throw new Error("Google ayarları eksik (.env)");

  const key = JSON.parse(
    readFileSync(resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE!), "utf8"),
  ) as ServiceAccountKey;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    sub: process.env.GOOGLE_ADMIN_IMPERSONATE,
    scope: SCOPES.join(" "),
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url")}`;

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!body.access_token) throw new Error(`Google erişim anahtarı alınamadı: ${body.error_description ?? res.status}`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Google'ın hata yanıtı; status ile kalıcı (4xx) ve geçici (429, 5xx) hatalar ayrılır */
export class GoogleApiError extends Error {
  // Parametre özelliği (readonly status) yerine açık alan: Node'un tip silme modu onu desteklemiyor
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, message: string) {
    super(`Google ${path}: ${status} ${message}`);
    this.status = status;
    this.path = path;
  }
  get transient() {
    return this.status === 429 || this.status >= 500;
  }
}

export async function directory<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://admin.googleapis.com/admin/directory/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = res.status === 204 ? "" : await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new GoogleApiError(res.status, path.split("?")[0], body.error?.message ?? res.statusText);
  return body as T;
}

/** Sayfalı bir listeyi sonuna kadar okur */
export async function listAll<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await directory<Record<string, unknown>>(
      `${path}${sep}maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    );
    out.push(...((page[key] as T[] | undefined) ?? []));
    pageToken = page.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

/** Groups Settings API (dışarıdan e-posta alma, moderasyon gibi grup ayarları) */
export async function groupSettings<T>(groupEmail: string, init: RequestInit = {}): Promise<T> {
  const path = `groups/${encodeURIComponent(groupEmail)}`;
  const res = await fetch(`https://www.googleapis.com/groups/v1/${path}?alt=json`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new GoogleApiError(res.status, `settings/${path}`, body.error?.message ?? res.statusText);
  return body as T;
}
