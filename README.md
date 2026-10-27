# Tahsilo

İşletmeler için bütünleşik finans yönetim platformu: banka hareketleri, şirket kartları, harcamalar, tahsilat (sanal POS), ödemeler, faturalar, cari hesaplar, nakit akışı, mutabakat, ERP ve raporlama tek panelde.

Bu depo ürün dokümanındaki (Sürüm 3.0) MVP, MVP+ ve Faz 2–3'ün yazılım tarafını uygular:

- açık bankacılık bağlantı altyapısı,
- bütçe ve onay kuralları,
- şubeler,
- bildirimler,
- platform yönetimi.

Gerçek banka, POS ve ERP sağlayıcıları sözleşme ve erişim geldiğinde adaptör olarak eklenir. Coolify ile kurulum için [docs/COOLIFY.md](docs/COOLIFY.md), düz Docker Compose için [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) dosyasına bakın.

## Hızlı başlangıç

Gereksinimler: Node.js 20+ ve PostgreSQL 14+ (Windows'ta `C:\Program Files\PostgreSQL` altındaki kurulum otomatik bulunur).

```bash
npm install
cp apps/api/.env.example apps/api/.env   # JWT_SECRET ve ENCRYPTION_KEY'i rastgele değerlerle değiştirin
npm run db:start                         # yerel PostgreSQL kümesini (.pgdata) başlatır, tahsilo ve tahsilo_test veritabanlarını açar
npm run db:migrate                       # şemayı uygular
npm run db:seed                          # demo firması ve kullanıcıları
npm run dev                              # API :4000, web :3000
```

3000 portu doluysa web'i başka portta açın (`npm run dev -w apps/web -- -p 3100`) ve `apps/api/.env` içindeki `WEB_URL` değerini aynı adrese çekin (ödeme dönüş adresleri ve CORS bunu kullanır).

Kendi PostgreSQL sunucunuzu kullanıyorsanız `db:start` adımını atlayın ve `DATABASE_URL` / `TEST_DATABASE_URL` değerlerini düzenleyin.

Rastgele sır üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # ENCRYPTION_KEY
```

### Demo kullanıcıları

Hepsinin parolası `Tahsilo2026!`

| E-posta | Rol |
|---|---|
| demo@tahsilo.local | Firma sahibi / finans yöneticisi |
| muhasebe@tahsilo.local | Muhasebe / finans uzmanı |
| yonetici@tahsilo.local | Ekip yöneticisi (Satış) |
| calisan@tahsilo.local | Çalışan / kart sahibi (Satış Kartı •••• 1234) |
| operasyon@tahsilo.local | Operasyon / tahsilat |
| denetci@tahsilo.local | Denetçi (salt okunur) |

Platform yöneticisi (yalnızca geliştirme): `platform@tahsilo.local` / `Tahsilo2026!`. Panel `/platform` adresinde. Üretimde `npm run platform:admin -w apps/api -- <e-posta> "<ad>"` ile oluşturulur (`PLATFORM_PASSWORD` ortam değişkeniyle).

### Sandbox sağlayıcılar

Gerçek banka/POS/ERP sözleşmesi olmadan uçtan uca akışlar çalışsın diye iki sandbox sağlayıcı vardır. Bunlar Tahsilo'nun parçası değildir, yalnızca adaptör arayüzünün arkasında dururlar. Gerçek sağlayıcı eklendiğinde yalnızca adaptör yazılır.

**MockPOS** (sanal POS). Ödeme sayfası sağlayıcı tarafında barındırılır; kart numarası Tahsilo'ya hiç gelmez.

| Kart | Sonuç |
|---|---|
| 4111 1111 1111 1111 | Başarılı |
| 4000 0000 0000 3220 | 3D Secure ister (kod `123456`) |
| 4000 0000 0000 0002 | Reddedilir (yetersiz bakiye) |

MockPOS her webhook'u bilerek iki kez gönderir. Tahsilo olay kimliğiyle tekilleştirir ve sonucu her zaman sağlayıcıdan sorgulayarak doğrular.

**Örnek Bankası** (açık bankacılık). Bankalar → "Banka bağla" ile izin ekranına gidilir; hesap seçilip izin verilir. Hesaplar ve hareketler arka planda senkronize edilir (varsayılan saatte bir, `BANK_SYNC_INTERVAL_MINUTES`). İzin 90 gün geçerlidir; bitişe 7 gün kala bildirim gelir, süre dolunca bağlantı "yeniden izin gerekli" durumuna geçer. Hareketler gün bazında deterministik üretilir: bugünkü işlemler bekleyen (provizyon), geçmiş günler kesinleşmiş gelir.

**MockERP**. Yapılandırma `{ companyCode, apiKey, failRate? }`. `apiKey: "invalid"` kalıcı yetki hatası üretir. `failRate: 0.5` gibi bir değer, yeniden deneme davranışını görmek için rastgele geçici hata üretir.

## Mimari

```
apps/
  api/   NestJS 11 + Prisma 6 + PostgreSQL — modüler monolit
  web/   Next.js 15 (App Router) + Tailwind — /api/v1 istekleri API'ye proxy'lenir
scripts/pg.mjs   yönetici yetkisi gerektirmeyen yerel PostgreSQL
```

| Modül (apps/api/src) | Sorumluluk |
|---|---|
| `prisma/` | Tenant kapsamlı Prisma istemcisi: her sorguya `tenantId` otomatik eklenir; bağlam yoksa sorgu reddedilir |
| `auth/`, `common/` | Çerez tabanlı JWT oturumu, rol → izin eşlemesi, audit log, AES-256-GCM şifreleme |
| `accounts/` | Banka hesapları, şirket kartları, kart ekstreleri |
| `imports/`, `transactions/` | CSV/XLSX ekstre içe aktarma, mükerrerlik anahtarı, birleşik hareket listesi, kategori önerisi |
| `expenses/`, `documents/` | Gider kaydı, onay/red (görevler ayrılığı), şifreli fiş/belge deposu |
| `ledger/` | Cari hesaplar, faturalar, planlı ödemeler (tekrarlı) |
| `collections/` | Ödeme linki, POS adaptörü, webhook doğrulama, iade |
| `erp/` | ERP adaptörü, veritabanı tabanlı iş kuyruğu (`FOR UPDATE SKIP LOCKED`, üstel geri çekilme) |
| `reconciliation/` | Banka ↔ POS / fatura / planlı ödeme / ekstre eşleşme önerileri |
| `finance/` | Genel bakış, nakit akışı tahmini, raporlar ve CSV/XLSX dışa aktarma |
| `banking/` | Banka adaptörü, izin (consent) akışı, şifreli belirteç, otomatik senkronizasyon, izin süresi takibi |
| `budgets/` | Aylık kategori/departman bütçeleri, gerçekleşen hesabı, eşik uyarıları, onay kuralları |
| `notifications/` | Uygulama içi bildirim + e-posta (SMTP yoksa `storage/_outbox`), tekrar engelleme |
| `platform/` | Ayrı oturumla platform yönetimi: firma listesi, askıya alma, sistem sağlığı; müşteri finansal verisine erişim yok |

**Şube filtresi:** Üst bardan seçilen şube `X-Branch-Id` başlığıyla gider. Tenant uzantısı liste ve toplam sorgularını o şubeye daraltır; tekil kayıt erişimi ve yazmalar etkilenmez.

**Onay kuralları:** Gider tutarına göre en yüksek eşleşen kuralın rolleri onaylayabilir. Firma sahibi her zaman onaylayabilir. Kimse kendi giderini onaylayamaz. Ekip yöneticisi yalnızca kendi departmanının giderini onaylar. Otomatik onay limitinin altındaki giderler doğrudan onaylanır.

### Finansal doğruluk kuralları

- Tutarlar `Decimal(18,2)` ile tutulur. Farklı para birimleri hiçbir yerde toplanmaz.
- Her hareketin kaynağı (`BANK`/`CARD`/`POS`/`MANUAL`) ve veri kalitesi (`CONNECTED`/`IMPORTED`/`MANUAL`) saklanır ve arayüzde gösterilir.
- Kart provizyonu (`PENDING`), kesinleşme (`POSTED`) ve ekstre borcunun ödenmesi ayrı izlenir. Kesinleşen işlem gelince eşleşen provizyon ters kayda alınır.
- Sanal POS tahsilatları genel bakıştaki para girişine eklenmez: para bankaya geçtiğinde banka hareketi olarak sayılır, POS kaydıyla mutabakat yapılır.
- Nakit akışı tahmini her zaman "TAHMİN" etiketi ve varsayımlarıyla gösterilir.
- Mükerrerlik anahtarı: kaynak referansı varsa o, yoksa tarih + tutar + açıklama + dosya içi tekrar sırası. Aynı dosyanın tekrar yüklenmesi kayıt üretmez; aynı gün aynı tutarlı iki gerçek işlem ayrı kalır.

## Testler

```bash
npm test          # apps/api: birim + uçtan uca testler (tahsilo_test veritabanında)
```

Uçtan uca testler MVP kabul kriterlerini doğrular:

- Tenant izolasyonu: okuma, güncelleme, içe aktarma, belge indirme ve yabancı anahtar ile erişim denendi.
- Aynı dosyanın tekrar yüklenmesi mükerrer kayıt üretmiyor.
- Yinelenen webhook çift tahsilat üretmiyor; sahte imza reddediliyor.
- Rol bazlı erişim çalışıyor.
- ERP hataları görünür, kalıcı/geçici hata ayrımı var ve iş yeniden denenebiliyor.
- Bütçe gerçekleşeni doğru hesaplanıyor; onay kuralı ve otomatik onay limiti uygulanıyor; bildirimler tekrarlanmıyor.
- Şube filtresi listeleri daraltıyor, başka firmanın şube kimliği etkisiz kalıyor.
- Banka bağlantısında izin, senkronizasyon, tekrar senkronizasyonda mükerrersizlik ve izin süresinin dolması akışı çalışıyor; başka firma izin durumunu kullanamıyor.
- Platform oturumu ile firma oturumu birbirinin yerine geçemiyor; askıya alınan firma giriş yapamıyor.

## MVP kabul kriterleri

| Kriter | Durum |
|---|---|
| Her firma yalnızca kendi verisini görür | Prisma tenant uzantısı + `assertOwned` + testler |
| Dosya kaynağı/zamanı görünür, tekrar yükleme mükerrer üretmez | `ImportBatch`, dedupe anahtarı, testler |
| Manuel / dosya / API / tahmin verisi ayırt edilir | `dataSource` + `SourceBadge` |
| Ödeme sonucu sağlayıcıdan doğrulanır, yinelenen webhook çift tahsilat oluşturmaz | `WebhookEvent` tekilliği + satır kilidi + testler |
| ERP senkronizasyon hataları görünür ve yeniden denenebilir | `SyncJob` ekranı + retry + testler |
| Rol bazlı erişim ve audit log | `permissions.ts`, `AuditService` |
| Raporlarda dönem, para birimi, veri kaynağı | Rapor başlığı + CSV/XLSX başlık satırları |

## Üretime geçmeden önce yapılması gerekenler

Bunlar bilinçli olarak bu sürümün dışında bırakıldı veya sizin kararınızı/erişiminizi gerektiriyor:

1. **Gerçek entegrasyonlar.** Seçilen sanal POS, ERP (Logo, Mikro, Netsis vb.) ve bankalar için sözleşme, sandbox erişimi ve API dokümanı gerekir. `PosAdapter` / `ErpAdapter` / `BankAdapter` arayüzlerine yeni adaptör eklenir. Türkiye'de açık bankacılık için BKM Geçit veya bankaların doğrudan API'leri değerlendirilmeli.
2. **MFA'yı zorunlu kılma.** TOTP tabanlı iki adımlı doğrulama hazır (Hesabım → İki adımlı doğrulama) ama isteğe bağlı. Finans rolleri için zorunlu tutma politikası eklenebilir.
3. **PostgreSQL Row-Level Security.** Uygulama katmanı izolasyonuna ek savunma katmanı olarak.
4. **Obje depolama.** `StorageService` şu an diski kullanıyor (şifreli). Üretimde S3 uyumlu depolamaya geçilmeli.
5. **Redis kuyruğu.** Yük artarsa veritabanı kuyruğu BullMQ'ya taşınabilir; yalnızca `JobWorkerService` değişir.
6. **Uyum.** KVKK, PCI DSS kapsamı ve ödeme hizmetleri mevzuatının uzmanlarla değerlendirilmesi.
7. **Operasyon.** Docker Compose, yedekleme betiği (`npm run backup`; geri yüklemesi denendi) ve CI iş akışı hazır. Sunucu, HTTPS, zamanlanmış yedek ve merkezi log kurulumu ortamınıza göre yapılmalı. Docker imajları bu makinede Docker kurulu olmadığı için derlenip denenmedi; ilk derleme CI'da veya sunucuda yapılacak.
8. **Bağımlılık uyarıları.** `npm audit --omit=dev` üç uyarı gösterir, hiçbiri kullanılan kod yolunda değil: `csv-parse` (`columns` seçeneği kullanılmıyor), `uuid` (exceljs içinde; `buf` parametresi kullanılmıyor), `deepmerge-ts` (yalnızca Prisma CLI). `multer` ve `postcss` `overrides` ile yamalı sürümlere sabitlendi.
9. **Kapsam dışı.** PDF ekstre okuma (CSV/XLSX destekleniyor), e-fatura/e-arşiv (entegratör gerekir), döviz çevrimi, ödeme başlatma/para transferi (dokümanda da sonraki faz).
