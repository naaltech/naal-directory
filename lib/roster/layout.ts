// Konumlu metin parçalarından satır ve sütun çıkarma yardımcıları.
// PDF raporları Türkçe harfleri ayrı parçalar halinde yazabiliyor ("AY" "Ş" "ENAZ"),
// ve aynı satırın hücreleri 1-2 birim farklı yükseklikte olabiliyor; bunlar burada toparlanır.

import type { TextItem } from "./pdf-text.ts";

export interface Cell {
  x: number;
  text: string;
}

export interface Line {
  y: number;
  cells: Cell[];
  /** Hücrelerin boşlukla birleştirilmiş hali (regex ile aramak için) */
  text: string;
}

/**
 * Parçalar arası boşluğa göre karar:
 *   < WORD_GAP  → aynı kelimenin devamı ("AY" + "Ş" + "E")
 *   < CELL_GAP  → aynı hücre, araya boşluk (e-Okul boşluğu karakter değil ~1.5 birim boşluk olarak yazıyor)
 *   ≥ CELL_GAP  → yeni hücre (sütunlar arası 20+ birim)
 */
const WORD_GAP = 0.5;
const CELL_GAP = 8;

/** y farkı `yTolerance`'tan küçük parçaları aynı satıra, bitişik parçaları aynı hücreye toplar. */
export function toLines(items: TextItem[], yTolerance = 2.5): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: TextItem[][] = [];
  for (const it of sorted) {
    const g = groups.at(-1);
    if (g && Math.abs(g[0].y - it.y) <= yTolerance) g.push(it);
    else groups.push([it]);
  }

  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let end = -Infinity;
    for (const it of g) {
      const last = cells.at(-1);
      const gap = it.x - end;
      if (last && gap < WORD_GAP) last.text += it.str;
      else if (last && gap < CELL_GAP) last.text += ` ${it.str}`;
      else cells.push({ x: it.x, text: it.str });
      end = it.x + it.width;
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const kept = cells.filter((c) => c.text);
    return { y: g[0].y, cells: kept, text: kept.map((c) => c.text).join(" ") };
  });
}

export interface Column<K extends string> {
  key: K;
  /** Başlık hücresinin x'i; sütun bir sonraki sütunun başlangıcına kadar uzanır */
  x: number;
}

/**
 * Başlık satırındaki etiketlerden sütun konumlarını bulur.
 * `labels`: sütun anahtarı → başlıkta aranacak metin (büyük/küçük harf ve boşluk duyarsız).
 */
export function findColumns<K extends string>(header: Line, labels: Record<K, string>): Column<K>[] | null {
  const norm = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/\s+/g, "");
  const cols: Column<K>[] = [];
  for (const key of Object.keys(labels) as K[]) {
    const cell = header.cells.find((c) => norm(c.text) === norm(labels[key]));
    if (!cell) return null;
    cols.push({ key, x: cell.x });
  }
  return cols.sort((a, b) => a.x - b.x);
}

/** Satırın hücrelerini sütunlara dağıtır; aynı sütuna düşen hücreler boşlukla birleşir. */
export function splitByColumns<K extends string>(line: Line, cols: Column<K>[], leftSlack = 15): Record<K, string> {
  const out = Object.fromEntries(cols.map((c) => [c.key, ""])) as Record<K, string>;
  for (const cell of line.cells) {
    let col = cols[0];
    for (const c of cols) if (cell.x >= c.x - leftSlack) col = c;
    out[col.key] = out[col.key] ? `${out[col.key]} ${cell.text}` : cell.text;
  }
  return out;
}
