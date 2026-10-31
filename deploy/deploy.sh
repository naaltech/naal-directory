#!/usr/bin/env bash
# Verilen commit'i sunucuya kurar; panel açılmazsa önceki commit'e döner. CI'dan SSH ile çalışır:
#   ssh naal@sunucu bash -s -- <commit> < deploy/deploy.sh
#
# Migration'lar geri alınmaz: geri dönüşte kod eski haline gelir, veritabanı yeni şemada kalır. Bu yüzden
# migration'lar eski kodu bozmayacak şekilde yazılmalı. Sorun çıkarsa deploy başında alınan yedek backups/ içindedir.
set -euo pipefail

sha="${1:?Kullanım: deploy.sh <commit>}"
cd "${PANEL_DIR:-/home/naal/panel}"
previous="$(git rev-parse HEAD)"

# Zincir bilerek &&: `if` içinde çağrılan fonksiyonda `set -e` çalışmaz, hata sessizce geçilirdi
install() {
  npm ci &&
    npm run db:migrate &&
    npm run build &&
    pm2 startOrReload ecosystem.config.cjs --update-env &&
    pm2 save
}

# Yanıt veren panel açılmıştır; 503 yalnızca sağlık uyarısı demektir, deploy'u geri almaz
panel_up() {
  local code
  for _ in $(seq 1 "${HEALTH_RETRIES:-30}"); do
    code="$(curl --silent --output /dev/null --max-time 5 --write-out '%{http_code}' http://127.0.0.1:3000/healthz || true)"
    if [ "$code" = 200 ] || [ "$code" = 503 ]; then return 0; fi
    sleep "${HEALTH_WAIT:-2}"
  done
  return 1
}

rollback() {
  echo "Kurulum başarısız, $previous sürümüne dönülüyor." >&2
  git checkout --quiet --detach "$previous"
  npm ci
  npm run build
  pm2 startOrReload ecosystem.config.cjs --update-env
  exit 1
}

npm run backup
git fetch --quiet origin
git checkout --quiet --detach "$sha"

if ! install || ! panel_up; then
  rollback
fi

echo "Kuruldu: $sha"
