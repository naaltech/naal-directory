// Betikler için ortak Google kimlik doğrulaması (servis hesabı + alan genelinde yetki).
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

export async function getApi() {
  const key = JSON.parse(readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    sub: env.GOOGLE_ADMIN_IMPERSONATE,
    scope: SCOPES.join(" "),
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url")}`;
  const tokenRes = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const token = await tokenRes.json();
  if (!token.access_token) throw new Error(`Token alınamadı: ${JSON.stringify(token)}`);

  return async function api(path, init = {}) {
    const r = await fetch(`https://admin.googleapis.com/admin/directory/v1/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json", ...init.headers },
    });
    const body = r.status === 204 ? {} : await r.json();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${body.error?.message}`);
    return body;
  };
}
