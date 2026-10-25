// Google'da kullanılan tüm adresler: kullanıcıların birincil adresleri ve takma adları,
// grupların adresleri ve takma adları. Aynı alan adında bunlar tek bir ad alanını paylaşır;
// yeni e-posta önerirken hepsinden kaçınmak gerekir.
import "server-only";

import { listAll } from "./client.ts";

interface GUser {
  primaryEmail: string;
  aliases?: string[];
  nonEditableAliases?: string[];
}
interface GGroup {
  email: string;
  aliases?: string[];
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; emails: Set<string> } | null = null;

export async function fetchTakenEmails(force = false): Promise<Set<string>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.emails;

  const [users, groups] = await Promise.all([
    listAll<GUser>("users?customer=my_customer&fields=nextPageToken,users(primaryEmail,aliases,nonEditableAliases)", "users"),
    listAll<GGroup>("groups?customer=my_customer&fields=nextPageToken,groups(email,aliases)", "groups"),
  ]);

  const emails = new Set<string>();
  const add = (e?: string) => e && emails.add(e.toLowerCase());
  for (const u of users) {
    add(u.primaryEmail);
    u.aliases?.forEach(add);
    u.nonEditableAliases?.forEach(add);
  }
  for (const g of groups) {
    add(g.email);
    g.aliases?.forEach(add);
  }
  cache = { at: Date.now(), emails };
  return emails;
}
