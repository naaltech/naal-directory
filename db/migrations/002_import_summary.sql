-- İçe aktarma özeti: okul adı, rapor tarihi, şubeler (sınıf öğretmeni, beklenen sayılar,
-- önerilen OU ve grup adresi), çözümleyici sorunları ve Google kontrolünün sonucu.
ALTER TABLE import_batches ADD COLUMN summary TEXT CHECK (summary IS NULL OR json_valid(summary));
