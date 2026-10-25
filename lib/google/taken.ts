// Google'daki kullanılan adresler; Google'a ulaşılamazsa null (o zaman sadece veritabanına bakılır).
import "server-only";

import { isGoogleConfigured } from "./client.ts";
import { fetchTakenEmails } from "./directory.ts";

export async function googleTakenOrNull(): Promise<{ taken: Set<string> | null; error?: string }> {
  if (!isGoogleConfigured()) return { taken: null, error: "Google ayarları eksik" };
  try {
    return { taken: await fetchTakenEmails() };
  } catch (e) {
    return { taken: null, error: (e as Error).message };
  }
}
