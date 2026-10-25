/** SQLite'ın UTC 'YYYY-MM-DD HH:MM:SS' metnini Türkiye saatiyle gösterir */
export function formatDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(`${d.replace(" ", "T")}Z`).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  });
}
