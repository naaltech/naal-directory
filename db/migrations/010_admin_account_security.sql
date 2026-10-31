-- Yöneticilerin kendi hesabını yönetmesi: iki adımlı doğrulama, şifre sıfırlama, e-posta değiştirme.

-- totp_secret secret-box ile şifreli durur; totp_enabled_at dolana kadar kurulum bitmemiştir
ALTER TABLE admin_users ADD COLUMN totp_secret TEXT;
ALTER TABLE admin_users ADD COLUMN totp_enabled_at TEXT;
-- Son kullanılan kodun zaman adımı: aynı kod ikinci kez kullanılamaz
ALTER TABLE admin_users ADD COLUMN totp_last_step INTEGER;

-- Telefon kaybolursa kullanılan tek seferlik kodlar; yalnızca SHA-256 özetleri saklanır
CREATE TABLE admin_recovery_codes (
  user_id   INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, code_hash)
);

-- Tek kullanımlık anahtarlar: e-postadaki bağlantılar ve girişin ikinci adımı. Anahtarın SHA-256 özeti saklanır.
CREATE TABLE admin_tokens (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_change', 'two_factor')),
  new_email  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX admin_tokens_user ON admin_tokens (user_id, purpose);
CREATE INDEX admin_tokens_expires ON admin_tokens (expires_at);
