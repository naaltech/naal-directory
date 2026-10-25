# VPS kurulumu (pm2 + Caddy)

Ubuntu/Debian, Node.js 24 LTS. Panel tek süreç olarak 127.0.0.1:3000'de çalışır, dışarıya HTTPS ile Caddy açar.

## 1. Sunucu hazırlığı

```bash
sudo apt install -y build-essential python3 caddy
sudo npm install -g pm2
sudo adduser --disabled-password naal
```

`build-essential` better-sqlite3'ün derlenmesi için gerekir (hazır derlenmiş paket bulunamazsa).
Paneli root ile değil `naal` kullanıcısıyla çalıştırın.

## 2. Dosyalar

Projeyi `/home/naal/panel` altına kopyalayın (`node_modules`, `.next`, `data` hariç). Ayrıca elle taşıyın:

- `.env`: `.env.example`'daki tüm anahtarlar. `PASSWORD_ENC_KEY` ve `NATIONAL_ID_HASH_KEY` mevcut değerlerle **aynı** olmalı.
- `secrets/service-account.json`
- `data/app.db`: paneli kapattıktan sonra kopyalayın (ya da `npm run backup` ile alınan yedeği `data/app.db` olarak koyun).

```bash
chmod 600 .env secrets/*.json data/app.db
```

## 3. Cloudflare Turnstile

dash.cloudflare.com > Turnstile > Add widget. Alan adı olarak panelin adresini (ör. `hesap.naal.org.tr`) girin,
mod "Managed". Çıkan Site Key ve Secret Key'i `.env`'e `TURNSTILE_SITE_KEY` ve `TURNSTILE_SECRET_KEY` olarak yazın.
Üretimde bu iki değer boşsa kimse giriş yapamaz.

## 4. Kurulum ve başlatma

```bash
cd /home/naal/panel
npm ci
npm run db:migrate
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`pm2 startup` bir `sudo ...` komutu yazdırır; onu çalıştırın, sunucu yeniden başlayınca panel de açılır.
Yönetici hesabı: `npm run admin` (sunucuda).

## 5. HTTPS

`deploy/Caddyfile`'daki alan adını düzenleyip `/etc/caddy/Caddyfile` olarak kopyalayın:

```bash
sudo systemctl reload caddy
```

DNS'te alan adının A kaydı VPS'in IP'sini göstermeli. Güvenlik duvarında sadece 22, 80, 443 açık olsun
(3000 dışarıya kapalı kalmalı):

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

## 6. Zamanlanmış görevler

`naal` kullanıcısının crontab'ına (`crontab -e`):

```cron
# Her gece 02:30 veritabanı yedeği (30 gün saklanır)
30 2 * * * cd /home/naal/panel && npm run backup >> logs/backup.log 2>&1
# Her gece 03:00 vadesi gelen askıya alma/silme işlerini kuyruğa al
0 3 * * * cd /home/naal/panel && npm run retention -- --yes >> logs/retention.log 2>&1
```

Önce `mkdir -p /home/naal/panel/logs`. Kuyruğu Google'a gönderme (`npm run sync -- --yes`) ilk zamanlarda elle
yapılmalı; her şeyin doğru gittiğinden emin olunca o da cron'a eklenebilir.

Yedekleri sunucu dışına da kopyalayın (öğrenci verisi içerir, şifreli bir yere).

## Güncelleme

```bash
cd /home/naal/panel
npm run backup
# yeni dosyaları kopyalayın
npm ci
npm run db:migrate
npm run build
pm2 reload naal-panel
```

Loglar: `pm2 logs naal-panel`
