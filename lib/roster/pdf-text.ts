// PDF'ten konumlu metin parçalarını çıkarır. pdfjs'e bağımlı tek dosya budur.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface TextItem {
  page: number;
  x: number;
  y: number; // PDF koordinatı: yukarı doğru artar
  width: number;
  str: string;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

export async function extractPdfText(bytes: Uint8Array): Promise<TextItem[][]> {
  // pdfjs verilen tamponu worker'a devrettiği için kopyası verilir
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  const pages: TextItem[][] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ page: p, x: it.transform[4], y: it.transform[5], width: it.width, str: it.str });
      }
      pages.push(items);
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}
