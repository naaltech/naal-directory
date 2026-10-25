// Okul listesi içe aktarma: tüm çözümleyicilerin ortak çıktı biçimi.
// Yeni bir liste biçimi (yeni e-Okul raporu, Excel, MEBBİS ...) geldiğinde sadece
// bu arayüzü uygulayan yeni bir çözümleyici yazılır; içe aktarmanın geri kalanı değişmez.

export type Gender = "F" | "M";

export interface RosterStudent {
  /** Listede sıra numarası (S.No) */
  rowNo: number;
  schoolNo: string;
  /** Kaynaktaki haliyle (çoğunlukla BÜYÜK HARF); başlık harfine çevirme içe aktarmada yapılır */
  firstName: string;
  lastName: string;
  gender?: Gender;
  nationalId?: string;
}

export interface RosterSection {
  grade: number; // 9..12, hazırlık 0
  section: string; // "A"
  /** "ALANI YOK", "SAYISAL" ... */
  field?: string;
  advisorName?: string; // sınıf öğretmeni
  presidentName?: string; // sınıf başkanı
  vicePresidentName?: string;
  deputyPrincipalName?: string; // sınıftan sorumlu müdür yardımcısı
  students: RosterStudent[];
  /** Kaynakta yazan toplamlar; doğrulamada öğrenci sayısıyla karşılaştırılır */
  expected?: { female?: number; male?: number; total?: number };
  /** Kaynak içindeki yeri (hata mesajları için), örn. "sayfa 3" */
  source: string;
}

export interface RosterIssue {
  level: "error" | "warning";
  message: string;
  source?: string;
}

export interface ParsedRoster {
  parserId: string;
  schoolName?: string;
  /** Raporun üretildiği tarih (varsa) */
  reportDate?: Date;
  sections: RosterSection[];
  issues: RosterIssue[];
}

export interface RosterFile {
  name: string;
  bytes: Uint8Array;
}

export interface RosterParser {
  id: string;
  label: string;
  /** 0 = bu biçim değil, 1 = kesin bu biçim. En yüksek puanlı çözümleyici seçilir. */
  detect(file: RosterFile): Promise<number>;
  parse(file: RosterFile): Promise<ParsedRoster>;
}
