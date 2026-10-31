#!/usr/bin/env bash
# En son yerel yedeği şifreleyip sunucu dışına gönderir. `npm run backup` sonrasında cron'dan çalışır.
#
# Şifreleme açık anahtarla yapılır (age): sunucu yedeği şifreler ama çözemez, gizli anahtar sunucuda durmaz.
# Ayarlar .env'den okunur:
#   BACKUP_AGE_RECIPIENT   age açık anahtarı (age1...)
#   BACKUP_REMOTE          rclone hedefi (ör. naal-yedek:naal-yedek/directory)
#   BACKUP_REMOTE_KEEP     uzakta saklama süresi, varsayılan 90d
#
# Çıkış kodu 0 değilse yedek gönderilmemiştir.
set -euo pipefail

env_value() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2-
}

recipient="$(env_value BACKUP_AGE_RECIPIENT || true)"
remote="$(env_value BACKUP_REMOTE || true)"
keep="$(env_value BACKUP_REMOTE_KEEP || true)"
keep="${keep:-90d}"
if [ -z "$recipient" ] || [ -z "$remote" ]; then
  echo "BACKUP_AGE_RECIPIENT ve BACKUP_REMOTE .env'de tanımlı olmalı." >&2
  exit 1
fi

latest="$(ls -1 backups/app-*.db 2>/dev/null | sort | tail -1 || true)"
if [ -z "$latest" ]; then
  echo "backups/ içinde yedek yok; önce npm run backup çalışmalı." >&2
  exit 1
fi

# Dün kalmış yedek bugünün yedeği gibi gönderilmesin: yerel yedek alınamadıysa hata verir
if [ -n "$(find "$latest" -mmin +1440)" ]; then
  echo "En son yedek 24 saatten eski: $latest" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
encrypted="$tmp/$(basename "$latest").age"

age --recipient "$recipient" --output "$encrypted" "$latest"
rclone copyto "$encrypted" "$remote/$(basename "$encrypted")"
rclone delete "$remote" --min-age "$keep" --include "app-*.db.age"

echo "Sunucu dışı yedek: $remote/$(basename "$encrypted")"
