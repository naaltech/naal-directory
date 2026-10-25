// Panelde tekrar eden durum etiketleri (Carbon Tag renkleri ile)

export type TagColor = "blue" | "green" | "red" | "gray" | "purple" | "warm-gray" | "teal" | "magenta" | "cyan";

export const ENTITY_STATUS: Record<string, { label: string; type: TagColor }> = {
  PENDING: { label: "Google'a gönderilecek", type: "blue" },
  ACTIVE: { label: "Aktif", type: "green" },
  SUSPENDED: { label: "Askıda", type: "warm-gray" },
  ARCHIVED: { label: "Arşiv", type: "gray" },
  DELETED: { label: "Silindi", type: "gray" },
  ERROR: { label: "Hata", type: "red" },
};

export const EXIT_REASON: Record<string, string> = {
  GRADUATED: "Mezun",
  TRANSFERRED: "Nakil",
};

export const OFFICER_TITLES: Record<string, string> = {
  PRESIDENT: "Başkan",
  VICE_PRESIDENT: "Başkan yardımcısı",
  SECRETARY: "Sekreter",
  TREASURER: "Sayman",
  BOARD_MEMBER: "Yönetim kurulu üyesi",
};

export const JOB_STATUS: Record<string, { label: string; type: TagColor }> = {
  QUEUED: { label: "Bekliyor", type: "blue" },
  RUNNING: { label: "Çalışıyor", type: "purple" },
  DONE: { label: "Tamam", type: "green" },
  FAILED: { label: "Başarısız", type: "red" },
  CANCELLED: { label: "İptal", type: "gray" },
};

export const ACTION_LABELS: Record<string, string> = {
  CREATE_ORG_UNIT: "OU oluşturma",
  DELETE_ORG_UNIT: "Boş OU silme",
  CREATE_GROUP: "Grup oluşturma",
  UPDATE_GROUP: "Grup güncelleme",
  DELETE_GROUP: "Grup silme",
  CREATE_USER: "Hesap açma",
  UPDATE_USER: "Hesap güncelleme",
  SUSPEND_USER: "Hesap askıya alma",
  DELETE_USER: "Hesap silme",
  ADD_MEMBER: "Gruba ekleme",
  REMOVE_MEMBER: "Gruptan çıkarma",
  ADD_ALIAS: "Takma ad ekleme",
  REMOVE_ALIAS: "Takma ad kaldırma",
};

const OUTCOME_DRY: Record<string, string> = {
  created: "oluşturulacak",
  exists: "zaten var",
  updated: "güncellenecek",
  removed: "kaldırılacak",
  absent: "zaten yok",
};
const OUTCOME_LIVE: Record<string, string> = { ...OUTCOME_DRY, created: "oluşturuldu", updated: "güncellendi", removed: "kaldırıldı" };

/** Kuyruk işinin sonucu: "oluşturulacak" (deneme) / "oluşturuldu" (gerçek) */
export function outcomeLabel(action: string, outcome: string, dryRun: boolean): string {
  if (outcome === "created" && action.startsWith("ADD_")) return dryRun ? "eklenecek" : "eklendi";
  return (dryRun ? OUTCOME_DRY : OUTCOME_LIVE)[outcome] ?? outcome;
}

/** 'YYYY-MM-DD ...' → 25.10.2026 */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}
