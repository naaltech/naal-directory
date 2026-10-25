export const BATCH_STATUS: Record<string, { label: string; type: "blue" | "green" | "red" | "gray" | "purple" }> = {
  UPLOADED: { label: "Yüklendi", type: "gray" },
  PARSED: { label: "Önizleme", type: "blue" },
  CONFIRMED: { label: "Onaylandı", type: "purple" },
  PROCESSING: { label: "İşleniyor", type: "purple" },
  COMPLETED: { label: "Tamamlandı", type: "green" },
  FAILED: { label: "Hata", type: "red" },
};
