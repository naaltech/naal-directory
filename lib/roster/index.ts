// Okul listesi içe aktarma giriş noktası.
// Yeni bir biçim eklemek için: parsers/ altına RosterParser uygulayan bir dosya yazın
// ve PARSERS listesine ekleyin. Dosyaya en yüksek puanı veren çözümleyici kullanılır.

import { eokulSinifListesiPdf } from "./parsers/eokul-sinif-listesi-pdf.ts";
import type { ParsedRoster, RosterFile, RosterParser } from "./types.ts";
import { validateRoster } from "./validate.ts";

export * from "./types.ts";

export const PARSERS: RosterParser[] = [eokulSinifListesiPdf];

export async function parseRoster(file: RosterFile, parserId?: string): Promise<ParsedRoster> {
  let parser = parserId ? PARSERS.find((p) => p.id === parserId) : undefined;
  if (parserId && !parser) throw new Error(`Bilinmeyen çözümleyici: ${parserId}`);

  if (!parser) {
    const scored = await Promise.all(PARSERS.map(async (p) => ({ p, score: await p.detect(file) })));
    const best = scored.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score === 0) {
      throw new Error(
        `"${file.name}" tanınmadı. Desteklenen biçimler: ${PARSERS.map((p) => p.label).join(", ")}`,
      );
    }
    parser = best.p;
  }

  const roster = await parser.parse(file);
  roster.issues.push(...validateRoster(roster));
  return roster;
}
