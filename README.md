# NAAL Hesap Yönetimi

Nevzat Ayaz Anadolu Lisesi'nin Google Workspace hesaplarını yöneten panel. e-Okul sınıf listesinden öğrenci hesaplarını
açar, sınıf ve kulüp gruplarını kurar, yıllar arasında sınıf değişikliklerini, mezun ve nakil gidenleri takip eder.
Öğretmen hesapları ve kulüpler de buradan yönetilir.

Next.js, IBM Carbon, Tailwind ve SQLite (better-sqlite3, düz SQL) ile yazıldı. Google'a yapılan her değişiklik önce
bir kuyruğa yazılır; kuyruk komut satırından, önce deneme olarak çalıştırılır.

## Hesap ve grup kuralları

| | Biçim | OU |
|---|---|---|
| Öğrenci | `ad.soyad@ogr.nevzatayazal.k12.tr` | `/Ogrenciler/{sınıf}/{sınıf}-{şube}` (ör. `/Ogrenciler/9/9-A`) |
| Öğretmen | `ad.soyad@nevzatayazal.k12.tr` | `/Ogretmenler`, ayrılınca `/Ogretmenler/Ayrilanlar` |
| Sınıf grubu | `9a@ogr.nevzatayazal.k12.tr` | Adres yıllar boyunca aynı kalır, her yıl üyeleri değişir |
| Kulüp grubu | `kulupkodu@naal.org.tr` | Dışarıdan e-posta alabilir (aşağıya bakın) |
| Kulüp görevlisi | Öğrencinin kendi hesabına `isim@naal.org.tr` takma adı | Görev süresince `/Kulupler`, bitince şubesine döner |
| Öğretmenler grubu | `ogretmenler@nevzatayazal.k12.tr` | |
| Öğretmen grubu | `idareciler@nevzatayazal.k12.tr` ya da `...@naal.org.tr` | İdareciler, rehberlik, zümreler; üyeler öğretmen (üye ya da yönetici) |
| Alt adres | Gruba `...@nevzatayazal.k12.tr` ya da `...@naal.org.tr` takma adı | Kulüp, öğretmenler ve öğretmen gruplarına eklenir; gelen e-posta gruba düşer |

- Türkçe karakterler adreste sadeleşir (ş→s, ğ→g, ı→i ...).
- Aynı adres varsa sırasıyla ikinci ad, sonra sayı eklenir (`ayse.yilmaz2`). Adres önizlemede elle de değiştirilebilir.
- Mezunlar `/Mezunlar`, nakil gidenler `/Nakil` OU'suna taşınır; hesap 90 gün sonra askıya alınır, 365 gün sonra
  silinir; ayrılan öğretmenler için de aynısı geçerlidir. Süreler veritabanındaki `settings` tablosunda
  (`retention.*` anahtarları) tutulur.

## Yıllık iş akışı

1. **Listeyi yükleyin** (İçe aktar). e-Okul'un "Sınıf listesi" PDF raporu tüm okul için tek dosya olarak yüklenir.
   Eğitim yılı raporun tarihinden bulunur (Eylül ve sonrası o yıl), gerekirse formdan elle seçilir.
2. **Önizlemeyi kontrol edin.** Her öğrenci için: yeni, sınıfı değişmiş, aynı kalmış ya da geri dönmüş. Şüpheli
   durumlar "çakışma" olarak çıkar ve "Aynı öğrenci" / "Yeni öğrenci" seçilerek çözülür:
   - aynı numara bu yıl farklı isimde (yazım hatası mı, başka öğrenci mi),
   - aynı isim farklı numarada (numara değişmiş olabilir).
   Mezunların numaraları yeni gelenlere verildiği için, yıllar sonra aynı numarada farklı isim yeni öğrenci sayılır.
3. **Onaylayın.** Hesap, OU ve grup işleri kuyruğa yazılır. Onaylanan listenin yılı güncel yıl olur.
4. **Ayrılanları işaretleyin** (Öğrenciler > Ayrılanlar). Listede olmayanlar mezun ya da nakil olarak önerilir;
   yanlışlıkla eksik kalanların işaretini kaldırın. Eksik (sadece birkaç şube içeren) bir liste kimseyi aday yapmaz.
5. **Kuyruğu çalıştırın** (Senkronizasyon sayfası): önce "Deneme yap", sonra "İlk 20 işi gönder" ile küçük bir
   parti, sonuç doğruysa "Tümünü gönder". Sunucuda komut satırından da çalışır: `npm run sync`, `npm run sync -- --yes`.
6. **Temizlik**: Google'ı tarayıp boş kalan şube OU'larını ve kullanılmayan sınıf gruplarını silin.

Yıl atlamak sorun değildir (ör. 2023 listesinden sonra 2026 listesi): öğrenci, aradan geçen yıl kadar ileri bir
sınıfta eşleşir. Onaylanmış son listeden eski bir liste ya da henüz başlamamış bir yılın listesi reddedilir. Aynı
yılın listesi tekrar yüklenebilir (sonradan gelen öğrenciler, şube değişiklikleri).

## Kurulum (geliştirme)

Node.js 24 veya üstü gerekir (komut satırı betikleri `.ts` dosyalarını doğrudan çalıştırır).

```bash
npm install
cp .env.example .env      # değerleri doldurun
npm run db:migrate
npm run admin -- create ad.soyad@nevzatayazal.k12.tr "Ad Soyad" --role SUPER_ADMIN
npm run dev
```

Sunucuya kurulum (VPS, pm2, Caddy, yedek, cron) için: [deploy/README.md](deploy/README.md).

### Ortam değişkenleri (`.env`)

| Değişken | Açıklama |
|---|---|
| `DATABASE_PATH` | SQLite dosyası, varsayılan `./data/app.db` |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Servis hesabı JSON anahtarı (`./secrets/...`, git'e eklenmez) |
| `GOOGLE_ADMIN_IMPERSONATE` | Servis hesabının adına çalışacağı süper yönetici hesabı |
| `PASSWORD_ENC_KEY` | İlk şifreleri şifrelemek için 32 baytlık anahtar (base64) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Giriş formunda Cloudflare Turnstile; geliştirmede boş bırakılabilir, üretimde zorunlu |

`PASSWORD_ENC_KEY` bir kez belirlendikten sonra değiştirilmemelidir: değişirse kayıtlı ilk şifreler çözülemez.
Anahtar üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Google ayarları

1. Google Cloud'da bir servis hesabı ve JSON anahtarı oluşturun; Admin SDK API ve Groups Settings API'yi açın.
2. Admin konsolu > Güvenlik > API denetimleri > Alan genelinde yetki: servis hesabının istemci kimliğine şu kapsamları verin:
   ```
   https://www.googleapis.com/auth/admin.directory.user
   https://www.googleapis.com/auth/admin.directory.group
   https://www.googleapis.com/auth/admin.directory.group.member
   https://www.googleapis.com/auth/admin.directory.orgunit
   https://www.googleapis.com/auth/admin.directory.domain.readonly
   https://www.googleapis.com/auth/apps.groups.settings
   ```
3. Bağlantıyı test edin (sadece okur): `npm run google:check`
4. **Kulüplerin dışarıdan e-posta alması için** Admin konsolu > Uygulamalar > Google Workspace > İşletmeler için
   Gruplar > Paylaşım ayarları: en üst kuruluş biriminde "Grup sahipleri kuruluşun dışından gelen e-postalara izin
   verebilir" işaretli olmalı. Bu ayar API ile değiştirilemez. Grubun kendi ayarlarını ("herkes gönderebilir") panel
   kulüp grubunu oluştururken ve düzenlerken kendisi uygular ve doğrular; eski kulüpler için kulüp sayfasında
   "Dış e-posta ayarlarını uygula" butonu vardır.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` / `build` / `start` | Panel |
| `npm run db:migrate` | Bekleyen SQL migration'larını uygular |
| `npm run admin -- <komut>` | Panel yöneticileri: `create`, `list`, `passwd`, `role`, `disable`, `enable`, `remove` |
| `npm run sync` | Kuyruk denemesi: Google'ı okur, ne yapılacağını listeler, hiçbir şey değiştirmez |
| `npm run sync -- --yes` | Kuyruğu gerçekten çalıştırır (`--limit 20`, `--action ...`, `--batch 3` ile daraltılabilir) |
| `npm run sync -- status` / `retry` | Kuyruk durumu / başarısız işleri yeniden dene |
| `npm run retention` | Askıya alınma / silinme vadesi gelenleri listeler; `-- --yes` ile kuyruğa alır |
| `npm run backup` | Veritabanı yedeği (`./backups`, 30 gün saklanır) |
| `npm run roster:parse -- "<dosya.pdf>"` | Listeyi sadece çözümler ve sorunları gösterir (veritabanına dokunmaz) |
| `npm run google:check` | Google bağlantı testi (sadece okur) |
| `npm test` / `npm run typecheck` | Testler (`tests/`, Google'a ve gerçek veriye dokunmaz) / tip kontrolü |

Panelde kayıt ekranı yoktur. Roller: Süper yönetici, Yönetici, Görüntüleyici (sadece okur).

- İlk süper yönetici sunucuda `npm run admin -- create ... --role SUPER_ADMIN` ile açılır.
- Süper yönetici, Yöneticiler sayfasından Yönetici ve Görüntüleyici hesabı ekler; rolünü değiştirir, pasifleştirir,
  şifresini sıfırlar ya da siler. Şifreler otomatik üretilir ve bir kez gösterilir.
- Süper yöneticilik devredilir: devreden kendi şifresini girer, seçilen yönetici süper yönetici olur, devreden
  Yönetici olur. Süper yönetici hesapları panelden değiştirilemez, böylece biri diğerini düşüremez.
- Panele erişim kalmazsa (tek süper yöneticinin şifresi unutuldu) sunucuda `npm run admin -- passwd` / `role`.

## Senkronizasyon kuyruğu

Panel Google'ı doğrudan değiştirmez; her değişiklik `sync_jobs` tablosuna bir iş olarak yazılır. İşçi
(`npm run sync -- --yes`) işleri sırasıyla çalıştırır: önce OU'lar, sonra gruplar, hesaplar ve üyelikler.

- Her iş tekrar çalıştırılabilir: yarıda kesilirse yeniden başlatmak güvenlidir, zaten yapılmış işler "zaten var" geçer.
- Bir işe bağlı işler (ör. grup oluşmadan üyelik) önceki iş bitene kadar bekler.
- Geri alınamaz işlerden önce işçi her şeyi yeniden kontrol eder: OU sadece şube OU'suysa, içinde kullanıcı ve alt
  OU yoksa silinir; grup sadece kapatılmış kulübe ya da üyesiz, kullanılmayan bir sınıfa aitse silinir; panel
  yöneticilerinin hesapları hiçbir zaman silinmez. Sınıf seviyesi ve üst OU'lar (`/Ogrenciler`, `/Mezunlar`, `/Nakil`,
  `/Kulupler`, `/Ogretmenler`) asla silinmez.
- Aynı anda tek işçi çalışabilir (kilit).

Kuyruk panelin Senkronizasyon sayfasından da çalıştırılır (deneme, ilk N iş, tümü). Çalıştırma panel sürecinde arka
planda devam eder, sayfadan ayrılmak onu durdurmaz; ilerleme ve sonuç sayfada görünür, "Durdur" çalışan iş bitince
durdurur. Komut satırıyla aynı kilidi kullanır, ikisi aynı anda çalışmaz. Görüntüleyici rolü çalıştıramaz.
Sayfa ayrıca başarısız işlerin hatalarını gösterir ve yeniden denemeye alır.

Sunucuda `naal-worker` süreci (`npm run worker`) sistem sağlığını izler ve uyarı gönderir. `.env`'de `SYNC_AUTO=1` ise
kuyruğu da kendisi çalıştırır; silme işleri ve sınırları aşan iş yığınları yine yönetici onayı bekler
([deploy/README.md](deploy/README.md), bölüm 8). Senkronizasyon sayfasındaki "Sistem durumu" bu kontrolleri ve gece
yapılan Google karşılaştırmasının (`npm run reconcile`) farklarını gösterir.

Aynı süreç yıllık döngüyü (temiz listenin onayı, ayrılanlar, süresi dolan ilk şifreler; `lib/year-cycle.ts`) ve yönetim
paneli köprüsünü (`lib/panel/`) çalıştırır. Panelin yetkileri elle tutulmaz, dizindeki görev ve okul durumundan
hesaplanıp Supabase'e yazılır: açık kulübün başkanı, başkan yardımcısı ve danışmanı kulübü, aktif `SUPER_ADMIN` hesapları
her şeyi yönetir. Dergi editörü yalnızca bilim kulübündedir ve panelden eklenir.

## Proje yapısı

```
app/login/              Giriş (e-posta + şifre, Turnstile)
app/(panel)/            Panel sayfaları: ice-aktar, ogrenciler, ogretmenler, siniflar, kulupler,
                        senkronizasyon, temizlik, yoneticiler
lib/roster/             Okul listesi çözümleyicileri (PDF -> ortak biçim)
lib/import/             Önizleme ve onay (listeyi veritabanına ve kuyruğa işler)
lib/match.ts            Listedeki öğrenciyi mevcut kayıtlarla eşleştirme
lib/years.ts            Eğitim yılları
lib/leavers.ts          Mezun / nakil adayları ve işaretleme
lib/retention.ts        Askıya alma ve silme vadeleri
lib/teachers.ts, clubs.ts, classes.ts, students.ts, cleanup.ts
lib/sync/               Kuyruk, işçi ve her iş türünün Google işleyicisi
lib/google/             Google API istemcisi (servis hesabı, alan genelinde yetki)
lib/auth/               Yöneticiler, oturumlar, şifreler, Turnstile
db/migrations/          SQL migration'ları (sırayla, bir kez uygulanır)
scripts/                Komut satırı araçları
deploy/                 Sunucu kurulumu (Caddy, adımlar)
```

### Yeni liste biçimi eklemek

e-Okul raporu değişirse ya da başka bir kaynaktan (Excel, MEBBİS) liste gelirse sadece yeni bir çözümleyici yazılır:
`lib/roster/parsers/` altına `RosterParser` arayüzünü (`lib/roster/types.ts`) uygulayan bir dosya ekleyip
`lib/roster/index.ts` içindeki `PARSERS` listesine koyun. Dosyaya en yüksek puanı veren çözümleyici seçilir;
içe aktarmanın geri kalanı değişmez. Denemek için `npm run roster:parse -- "<dosya>"`.

### Veritabanı değişikliği

`db/migrations/` altına sıradaki numarayla bir `.sql` dosyası ekleyin (ör. `005_....sql`). Panel ve komutlar
açılışta bekleyen migration'ları uygular; elle `npm run db:migrate`. Uygulanmış bir migration dosyasını değiştirmeyin.

## Güvenlik

- `.env`, `secrets/`, `data/` ve `backups/` git'e eklenmez. Veritabanı ve yedekler öğrenci bilgisi içerir.
- İlk şifreler veritabanında şifreli durur; panelde görüntülemek denetim kaydına geçer. Öğrenciler ve öğretmenler
  ilk girişte şifrelerini değiştirir.
- Yönetici şifreleri scrypt ile saklanır; 5 hatalı denemede hesap 15 dakika kilitlenir. Turnstile şifreden önce
  kontrol edildiği için botlar hesapları kilitleyemez.
- Panelde yapılan her değişiklik `audit_logs` tablosuna yazılır.
