-- İşçi, bir işten önce bitmesi gereken işleri (aynı adresin CREATE_USER/CREATE_GROUP'u) payload'daki
-- e-postaya göre arar; her iş için tabloyu taramamak için ifade indeksi.
CREATE INDEX sync_jobs_payload_email ON sync_jobs (json_extract(payload, '$.email'));
