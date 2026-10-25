// Google bağlantı testi: sadece okur, hiçbir şey değiştirmez.
// Kullanım: node scripts/google-check.mjs
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const key = JSON.parse(readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "utf8"));
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.user",
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member",
  "https://www.googleapis.com/auth/admin.directory.orgunit",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/apps.groups.settings",
];

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
if (!token.access_token) {
  console.error("✗ Token alınamadı:", token);
  process.exit(1);
}
console.log(`✓ Token alındı (${env.GOOGLE_ADMIN_IMPERSONATE} adına)`);

const api = async (path) => {
  const r = await fetch(`https://admin.googleapis.com/admin/directory/v1/${path}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body.error?.message}`);
  return body;
};

const me = await api(`users/${encodeURIComponent(env.GOOGLE_ADMIN_IMPERSONATE)}?fields=customerId,isAdmin,orgUnitPath`);
console.log(`✓ Müşteri Kimliği: ${me.customerId}  süper admin=${me.isAdmin}`);

const domains = await api("customer/my_customer/domains");
for (const d of domains.domains ?? []) {
  console.log(`  alan adı: ${d.domainName}  ${d.isPrimary ? "(birincil)" : "(ikincil)"}  doğrulandı=${d.verified}`);
}
const aliases = await api("customer/my_customer/domainaliases").catch(() => ({}));
for (const a of aliases.domainAliases ?? []) console.log(`  takma ad alanı: ${a.domainAliasName} → ${a.parentDomainName}`);

const ous = await api("customer/my_customer/orgunits?type=all");
console.log(`✓ ${ous.organizationUnits?.length ?? 0} organizasyon birimi:`);
for (const o of (ous.organizationUnits ?? []).sort((a, b) => a.orgUnitPath.localeCompare(b.orgUnitPath))) {
  console.log(`  ${o.orgUnitPath}`);
}

const users = await api("users?customer=my_customer&maxResults=1&fields=users(primaryEmail)");
console.log(`✓ Kullanıcı okuma çalışıyor (${users.users?.length ? "en az 1 kullanıcı" : "kullanıcı yok"})`);
const groups = await api("groups?customer=my_customer&maxResults=1&fields=groups(email)");
console.log(`✓ Grup okuma çalışıyor (${groups.groups?.length ? "en az 1 grup" : "grup yok"})`);
