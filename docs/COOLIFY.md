# Coolify ile kurulum

Tahsilo, Coolify'ın **Docker Compose** kurulum tipiyle tek seferde ayağa kalkar. Kurulumda PostgreSQL, API ve web olmak üzere üç servis çalışır. Dışarıya yalnızca web açılır; API ve veritabanı Coolify'ın iç ağında kalır.

## 1. Kaynağı ekle

1. Coolify → **Projects** → projenizi seçin → **+ New** → **Public Repository** (depo gizliyse **Private Repository (with GitHub App)**).
2. Depo adresi: `https://github.com/cannx22/Tahsilo`, dal: `master`.
3. **Build Pack**: `Docker Compose`.
4. **Docker Compose Location**: `/docker-compose.yml`
5. **Continue** deyin. Coolify `db`, `api` ve `web` servislerini listeler.

## 2. Alan adı

**web** servisinin **Domains** alanına alan adınızı **port ile** yazın:

```
https://tahsilo.firma.com:3000
```

Buradaki `:3000` konteyner portudur; kullanıcılar adresi portsuz açar. Coolify HTTPS sertifikasını Let's Encrypt ile kendisi alır. Alan adınızın DNS kaydı (A kaydı) Coolify sunucusunun IP adresini göstermeli.

`api` ve `db` servislerine alan adı **vermeyin**.

## 3. Ortam değişkenleri

**Environment Variables** sekmesinde aşağıdaki değerleri Coolify otomatik üretir; dokunmanıza gerek yok:

| Değişken | Ne işe yarar |
|---|---|
| `SERVICE_FQDN_WEB` | Web alan adınız. Ödeme dönüşleri, banka izin dönüşleri ve webhook'lar bu adresi kullanır |
| `SERVICE_PASSWORD_POSTGRES` | Veritabanı parolası |
| `SERVICE_PASSWORD_64_JWT` | Oturum imzalama anahtarı |
| `SERVICE_PASSWORD_64_ENCRYPTION` | Belge ve bağlantı sırlarının şifreleme anahtarı |
| `SERVICE_PASSWORD_MOCKPOS` | Sandbox POS webhook imza sırrı |

> **Önemli:** İlk kurulumdan sonra `SERVICE_PASSWORD_64_ENCRYPTION` değerini kopyalayıp bir parola kasasında saklayın. Bu değer değişir ya da kaybolursa yüklenen fişler, ekstreler ve ERP/POS/banka bağlantı sırları **açılamaz**.

İsteğe bağlı olarak eklenebilecekler:

| Değişken | Örnek |
|---|---|
| `SMTP_URL` | `smtps://kullanici:parola@smtp.firma.com:465` (boşsa e-posta gönderilmez) |
| `MAIL_FROM` | `Tahsilo <bildirim@firma.com>` |
| `BANK_SYNC_INTERVAL_MINUTES` | `60` |

## 4. Kur

**Deploy** düğmesine basın. İlk derleme 5–10 dakika sürebilir.

- API her açılışta veritabanı migration'larını otomatik uygular. Bu işlem veri silmez.
- Servisler sağlık kontrolüyle bekler: önce `db`, sonra `api`, en son `web` başlar.

Kurulum bitince `https://tahsilo.firma.com` adresini açın. `/register` sayfasından ilk firmanızı oluşturun.

## 5. Platform yöneticisi

Coolify → **api** servisi → **Terminal**:

```bash
PLATFORM_PASSWORD='en-az-12-karakterlik-parola' node prisma/create-platform-admin.js siz@firma.com "Ad Soyad"
```

Ardından `https://tahsilo.firma.com/platform` adresinden giriş yapın.

> Demo verisi (`db:seed`) canlı ortamda çalıştırılmamalı. Bilinen parolalı demo kullanıcıları oluşturur.

## 6. Yedekleme

- **Veritabanı:** Coolify'da `db` servisine **Scheduled Backups** ekleyin (örn. günlük, S3 hedefli).
- **Belgeler:** `tahsilo-storage` volume'ü şifreli fiş/ekstre dosyalarını tutar. Sunucuda yedeklemek için:
  ```bash
  docker run --rm -v <coolify-volume-adı>:/data -v /root/yedek:/backup alpine tar czf /backup/storage-$(date +%F).tgz -C /data .
  ```
  Volume'ün tam adını Coolify → **Storages** sekmesinde görebilirsiniz.

Ayda bir kez yedeği boş bir veritabanına geri yükleyip deneyin ([DEPLOYMENT.md](DEPLOYMENT.md#yedekten-geri-yükleme)).

## 7. Güncelleme

Depoya her push'tan sonra Coolify'da **Redeploy** yapın. İsterseniz **Webhooks** ile otomatik kurulum açabilirsiniz. Güncellemeden önce yedek alın.

## Sorun giderme

| Belirti | Kontrol |
|---|---|
| `web` açılmıyor, 502 | `api` sağlıklı mı? `api` loglarında `Tahsilo API` satırı ve migration çıktısı görünmeli |
| Giriş yapınca hemen çıkış oluyor | Alan adı HTTPS ile mi açılıyor? Üretimde oturum çerezi yalnızca HTTPS'te gönderilir |
| Ödeme veya banka izninden sonra yanlış adrese dönüyor | `SERVICE_FQDN_WEB` değeri gerçek alan adınız mı? |
| `ENCRYPTION_KEY en az 32 karakter` hatası | `SERVICE_PASSWORD_64_ENCRYPTION` boş kalmış; Coolify'da değeri üretin veya elle 32+ karakter girin |
