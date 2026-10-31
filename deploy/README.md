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

- `.env`: `.env.example`'daki tüm anahtarlar. `PASSWORD_ENC_KEY` mevcut değerle **aynı** olmalı.
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
# Her gece 02:30 veritabanı yedeği (yerelde 30 gün saklanır), sonra şifreli kopyası sunucu dışına
30 2 * * * cd /home/naal/panel && npm run backup >> logs/backup.log 2>&1 && bash deploy/backup-offsite.sh >> logs/backup.log 2>&1
# Her gece 04:00 Google ile veritabanını karşılaştır (sadece okur)
0 4 * * * cd /home/naal/panel && npm run reconcile >> logs/reconcile.log 2>&1
```

Önce `mkdir -p /home/naal/panel/logs`. Kuyruğu Google'a `naal-worker` süreci gönderir, vadesi gelen askı ve silme
işlerini de gece kuyruğa o alır; bkz. bölüm 8. Sunucuda eski `npm run retention` cron satırı varsa `SYNC_AUTO=1`
yaptıktan sonra silin. Silmezseniz zarar vermez, aynı işi iki kez eklemez.

## 7. Sunucu dışı yedek

Yedek öğrenci verisi içerir. `deploy/backup-offsite.sh` onu sunucuda şifreler, sonra rclone ile gönderir. Sunucu yalnızca
açık anahtarı bilir; ele geçirilse bile uzaktaki yedekler çözülemez.

1. Sunucuda araçları kurun: `sudo apt install -y age rclone`.
2. **Sunucuda değil, kendi bilgisayarınızda** anahtar üretin: `age-keygen -o naal-yedek.key`. Çıktıdaki `age1...` açık
   anahtardır. `naal-yedek.key` dosyasını parola yöneticisi gibi güvenli bir yerde, en az iki kopya saklayın.
3. Hedef için yalnızca yedeklere ayrılmış, herkese kapalı bir R2 bucket'ı ya da benzeri depolama açın ve yalnızca o
   bucket'a erişebilen bir anahtar üretin. `rclone config` ile `naal` kullanıcısında tanımlayın.
4. `.env`'e `BACKUP_AGE_RECIPIENT` ve `BACKUP_REMOTE` yazın, elle deneyin:
   ```bash
   npm run backup && bash deploy/backup-offsite.sh
   ```

**Geri yükleme** (öğretmen ve öğrenci kayıtları dahil tüm veriyi önceki gece haline döndürür):

```bash
pm2 stop naal-panel
rclone copy naal-yedek:naal-yedek/directory/app-YYYYMMDD-HHMM.db.age .
age --decrypt --identity naal-yedek.key --output data/app.db app-YYYYMMDD-HHMM.db.age
rm -f data/app.db-wal data/app.db-shm app-YYYYMMDD-HHMM.db.age
chmod 600 data/app.db
pm2 start naal-panel
```

`.env` ve `secrets/service-account.json` yedeğin içinde değildir, ayrı saklanmalıdır. Özellikle `PASSWORD_ENC_KEY`
kaybolursa yedekteki ilk şifreler çözülemez. Yılda en az bir kez, Eylül'deki liste yüklemesinden önce, yedeği boş bir
makinede geri yükleyip panelin açıldığını deneyin.

Bu betik `data/app.db`'yi korur. Supabase verisi (kulüpler, sertifikalar, dergiler) ayrı bir konudur ve Supabase
panelinden yedek planı doğrulanmalıdır.

## 8. Otomatik çalışma

`naal-worker` süreci `ecosystem.config.cjs` ile panelle birlikte başlar. Varsayılan olarak yalnızca izler: sağlığı
kontrol eder ve uyarı gönderir, Google'a hiçbir şey göndermez.

1. `.env`'e `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_EMAIL_TO` ve `ALERT_EMAIL_FROM` yazın.
   Şifre, gönderen hesabın uygulama şifresidir. Gönderen adresler o hesabın takma adı olmalı.
2. Panelin Senkronizasyon sayfasında "Deneme yap" ile kuyruğun beklendiği gibi olduğuna bakın.
3. `.env`'e `SYNC_AUTO=1` yazıp `pm2 reload naal-worker --update-env` çalıştırın.
4. Uptime Robot gibi bir dış serviste `https://<panel adresi>/healthz` adresini izleyin. Sunucu tamamen kapanırsa kendi
   uyarısını gönderemez; bu yüzden dış izleme zorunludur. Adres sorun varsa 503 döner ve ayrıntı vermez.

Otomatik modda kurallar:

| İş | Davranış |
|---|---|
| OU, grup, hesap, üyelik, takma ad | Dakikada bir otomatik |
| Askıya alma | Bir seferde en fazla 300 (`sync.autoMaxSuspend`) otomatik, fazlası onay bekler |
| Silme (hesap, grup, OU) | Hiçbir zaman otomatik değil, panelde "Tümünü gönder" ile başlatılır |
| Onaylanmış listenin işleri | Sınıra sayılmaz, otomatik çalışır |
| Listeden gelmeyen 300'den fazla iş (`sync.autoMaxJobs`) | Hiçbiri çalışmaz, onay bekler |
| Bir çalıştırmada 10 başarısız iş (`sync.autoMaxFailures`) | Çalıştırma durur, otomatik mod panelden açılana kadar kapalı kalır |

"Tümünü gönder" eskisi gibi kuyruktaki her işi, silmeler dahil, çalıştırır. Basmadan önce sayfadaki uyarıyı okuyun.

### Yıllık döngü

Yöneticinin tek işi yeni yılın e-Okul listesini panele yüklemektir. 15 Eylülden sonra liste yoksa hatırlatma gider.

- Liste temizse kendiliğinden onaylanır. Şunlardan biri varsa önizlemede nedeni yazar ve onay bekler: sistemdeki ilk
  liste, elle seçilen yıl, Google'da kontrol edilemeyen adresler, okuma uyarısı, hatalı satır, satırların %40'ından
  fazlasının yeni öğrenci olması (`import.autoMaxNewRatio`).
- Liste onaylanınca ayrılanlar işaretlenir. Listede 12. sınıf yoksa liste eksik sayılır ve kimse işaretlenmez. 30'dan
  fazla nakil adayı varsa (`leavers.autoMaxTransfer`) mezunlar işaretlenir, nakiller onay bekler.
- İşaretlenen öğrenci askı tarihine kadar panelden geri alınabilir; yeni listede görünürse kendiliğinden geri döner.
- İlk şifreler 60 gün sonra silinir (`password.keepDays`). Kuyrukta şifreyi bekleyen iş varsa silinmez.
- Boş OU ve kullanılmayan gruplar gece taranır; sayısı "Sistem durumu"nda görünür, silmek yöneticinin kararıdır.
- Mezunların askısı aynı güne denk geldiği için otomatik sınır 300'dür. Silmeler yine "Tümünü gönder" bekler.

Ayarlar `settings` tablosundadır; `import.autoConfirm` ve `leavers.autoMark` değeri `0` yapılırsa ilgili adım kapanır.

### Yönetim paneli köprüsü

`.env`'de `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` varsa işçi dakikada bir kulüplerin açık/kapalı durumunu ve `panel_roles` tablosunu eşitler, SMTP ayarları ve `CERT_EMAIL_FROM` de varsa panelden gelen toplu sertifikaları üretip gönderir ve
panelden gelen istekleri (editör, üyelik) işler. `SYNC_AUTO`'dan bağımsızdır. Kurulum sırası
`naal-org-admin/supabase/pending/README.md` dosyasındadır; o dosyanın 4. adımından önce bu değişkenleri yazmayın.

## 9. Otomatik deploy

`main`'e gelen ve CI'dan geçen her commit sunucuya kurulur (`deploy/deploy.sh`): yedek alınır, kod güncellenir, migration
ve build çalışır, süreçler yenilenir. Panel açılmazsa önceki commit'e dönülür ama migration'lar geri alınmaz.

1. Sunucudaki kopya git deposu olmalı. Mevcut `.env`, `secrets/`, `data/` ve `backups/` git dışındadır, korunur:
   ```bash
   cd /home/naal/panel
   git init -b main
   git remote add origin https://github.com/naaltech/naal-directory
   git fetch origin
   git reset --hard origin/main
   ```
   Depo gizliyse sunucuya yalnızca okuma yetkili bir deploy anahtarı ekleyin.
2. Yalnızca bu iş için bir SSH anahtarı üretip açık kısmını `naal` kullanıcısının `authorized_keys` dosyasına ekleyin.
   `node`, `npm` ve `pm2` etkileşimsiz SSH oturumunda da bulunmalı.
3. GitHub deposunda şu Actions sırlarını tanımlayın: `DEPLOY_SSH_KEY`, `DEPLOY_TARGET` (`naal@sunucu`) ve
   `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan sunucu` çıktısı).
4. Depo değişkeni `DEPLOY_ENABLED=true` yapın. Bu değişken olmadan deploy işi çalışmaz.

## Elle güncelleme

```bash
bash deploy/deploy.sh <commit>
```

Loglar: `pm2 logs naal-panel`, `pm2 logs naal-worker`
