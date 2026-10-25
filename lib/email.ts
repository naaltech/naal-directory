// Türkçe isimlerden Google e-posta adresi üretme.
// Ekranda görünen ad Türkçe karakterli kalır ("Şükrü Çağlar"),
// sadece e-postanın @ öncesi kısmı sadeleşir ("sukru.caglar").

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", i: "i", ö: "o", ş: "s", ü: "u",
  â: "a", î: "i", û: "u",
};

/** Google'ın kullanıcı adı sınırı 64 karakter. */
const MAX_LOCAL_PART = 64;

/** Okulda başka amaçla kullanılan, öğrenciye/öğretmene verilmeyecek adresler. */
export const RESERVED_LOCAL_PARTS = new Set([
  "admin", "administrator", "info", "bilgi", "mudur", "mudurluk", "muduryardimcisi",
  "postmaster", "abuse", "noreply", "no-reply", "destek", "support", "okul", "ogretmen",
  "ogrenci", "ogretmenler", "ogrenciler", "veli", "rehberlik", "kulup", "kulupler",
]);

/** "ŞÜKRÜ ÇAĞLAR" / "şükrü çağlar" → "sukru caglar" */
export function asciiFold(input: string): string {
  return input
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıiöşüâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    // Kalan aksanlar (é, ä, ñ ...) ve "i̇" gibi birleşik noktalar
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** E-postada kullanılabilir hale getirir: sadece a-z ve 0-9. */
export function slug(part: string): string {
  return asciiFold(part).replace(/[^a-z0-9]/g, "");
}

/** Excel'den gelen "AHMET EMRE" / "ayşe-nur" → "Ahmet Emre" / "Ayşe-Nur" (Türkçe İ/ı doğru) */
export function toTitleCaseTr(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase("tr-TR"));
}

/**
 * name:      öğrenci ve öğretmen → ad.soyad
 * firstName: kulüp kadrosu → ahmet@naal.org.tr; çakışmada ikinci isim, sonra soyad.
 *            Panelde öneri olarak gösterilir, adresi yönetici elle onaylar.
 * schoolNo:  kullanılmıyor (okul numaraları mezunlardan sonra yeniden veriliyor)
 */
export type EmailStrategy = "name" | "firstName" | "schoolNo";

export interface EmailInput {
  firstName: string; // "Ahmet Emre"
  lastName: string; // "Yılmaz Kaya"
  schoolNo?: string;
}

/**
 * Sırasıyla denenecek adayları üretir. Örn. Ahmet Emre / Yılmaz:
 *   ahmet.yilmaz → ahmetemre.yilmaz → ahmet.emre.yilmaz → ahmet.yilmaz2 → ahmet.yilmaz3 ...
 * schoolNo stratejisinde tek aday vardır: "1234".
 */
export function* emailCandidates(input: EmailInput, strategy: EmailStrategy = "name"): Generator<string> {
  if (strategy === "schoolNo") {
    if (!input.schoolNo) throw new Error("Okul numarası yok");
    yield slug(input.schoolNo);
    return;
  }

  const given = input.firstName.trim().split(/\s+/).map(slug).filter(Boolean);
  // Çift soyad birleşik yazılır: "Yılmaz Kaya" → "yilmazkaya"
  const surname = input.lastName.trim().split(/\s+/).map(slug).filter(Boolean).join("");
  if (given.length === 0 || !surname) throw new Error("Ad veya soyad boş");

  const fit = (local: string) => local.slice(0, MAX_LOCAL_PART).replace(/\.+$/, "");

  const base = fit(`${given[0]}.${surname}`);
  const seen = new Set<string>();
  const emit = function* (local: string) {
    if (!seen.has(local)) {
      seen.add(local);
      yield local;
    }
  };

  if (strategy === "firstName") {
    // ahmet → ahmetemre → ahmet.yilmaz → ahmetemre.yilmaz → ahmet.yilmaz2 ...
    yield* emit(fit(given[0]));
    if (given.length > 1) yield* emit(fit(given.join("")));
    yield* emit(base);
    if (given.length > 1) yield* emit(fit(`${given.join("")}.${surname}`));
    for (let n = 2; n < 100; n++) yield* emit(fit(base.slice(0, MAX_LOCAL_PART - String(n).length)) + n);
    return;
  }

  yield* emit(base);
  if (given.length > 1) {
    yield* emit(fit(`${given.join("")}.${surname}`));
    yield* emit(fit(`${given.join(".")}.${surname}`));
  }
  for (let n = 2; n < 100; n++) {
    const suffix = String(n);
    yield* emit(fit(base.slice(0, MAX_LOCAL_PART - suffix.length)) + suffix);
  }
}

/**
 * İlk boş adresi döndürür. `isTaken` hem veritabanına hem Google'a bakmalı
 * (aynı alan adındaki kullanıcılar, gruplar ve takma adlar aynı ad alanını paylaşır).
 * Aynı Excel içindeki çakışmalar için `reservedInBatch` setini verin.
 */
export async function pickEmail(
  input: EmailInput,
  domain: string,
  isTaken: (email: string) => Promise<boolean>,
  opts: { strategy?: EmailStrategy; reservedInBatch?: Set<string> } = {},
): Promise<string> {
  for (const local of emailCandidates(input, opts.strategy)) {
    if (RESERVED_LOCAL_PARTS.has(local)) continue;
    const email = `${local}@${domain}`;
    if (opts.reservedInBatch?.has(email)) continue;
    if (await isTaken(email)) continue;
    opts.reservedInBatch?.add(email);
    return email;
  }
  throw new Error(`Boş e-posta bulunamadı: ${input.firstName} ${input.lastName}`);
}
