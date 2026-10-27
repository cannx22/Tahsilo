# Canlıya alma rehberi

> **Coolify kullanıyorsanız** [COOLIFY.md](COOLIFY.md) rehberini izleyin; aşağıdaki adımlar Coolify dışında, düz Docker Compose kurulumu içindir.

Tahsilo üç konteynerden oluşur: PostgreSQL, API ve web. Dışarıya yalnızca web açılır. Web, `/api/v1` isteklerini iç ağdan API'ye iletir; webhook'lar ve sağlayıcı sayfaları da bu yoldan gelir.

## 1. Ön koşullar

- Docker 24+ ve Docker Compose v2
- Bir alan adı ve HTTPS sonlandıran bir ters vekil (Caddy, Nginx veya bulut yük dengeleyici)
- SMTP hesabı (e-posta bildirimleri için)

## 2. Ayarlar

```bash
cp .env.production.example .env
```

`.env` dosyasında `SERVICE_FQDN_WEB` alanına alan adınızı yazın. Diğer `SERVICE_PASSWORD_*` alanlarına rastgele değerler girin. **`SERVICE_PASSWORD_64_ENCRYPTION` kaybolursa şifreli belgeler ve bağlantı sırları açılamaz**; bu değeri parola kasası gibi güvenli bir yerde ayrıca saklayın.

`NODE_ENV=production` olduğu için oturum çerezleri yalnızca HTTPS üzerinden gönderilir.

## 3. Başlatma

```bash
docker compose up -d --build
docker compose logs -f api   # "Tahsilo API ..." satırını bekleyin
```

API her başlangıçta bekleyen migration'ları uygular. Bu işlem veri silmez.

İlk platform yöneticisini oluşturun:

```bash
docker compose exec -e PLATFORM_PASSWORD='en-az-12-karakter' api node prisma/create-platform-admin.js admin@firma.com "Ad Soyad"
```

Firmalar `/register` sayfasından kendi hesaplarını açar. Platform paneli `/platform` adresindedir.

## 4. Ters vekil (örnek: Caddy)

Compose dosyası host'a port açmaz (Coolify'ın proxy'si için). Düz kurulumda web servisine `ports: ["127.0.0.1:3000:3000"]` ekleyin, sonra:

```
tahsilo.example.com {
  reverse_proxy localhost:3000
}
```

## 5. Yedekleme

```bash
node scripts/backup.mjs        # yerel kurulum
```

Docker kurulumunda veritabanı ve belge deposu ayrı ayrı yedeklenir:

```bash
docker compose exec -T db pg_dump -U tahsilo --format=custom tahsilo > backups/tahsilo-$(date +%F).dump
docker run --rm -v tahsilo_storage:/data -v "$PWD/backups":/backup alpine tar czf /backup/storage-$(date +%F).tgz -C /data .
```

Günlük bir zamanlayıcıyla (cron, systemd timer) çalıştırın ve yedekleri sunucu dışına (S3, başka bir sunucu) kopyalayın. Yedekteki belgeler şifrelidir; `ENCRYPTION_KEY` olmadan açılamaz, o yüzden anahtar yedekle aynı yerde saklanmamalıdır.

### Yedekten geri yükleme

> Geri yükleme hedef veritabanının üzerine yazar. Önce boş bir veritabanında deneyin.

```bash
createdb -U postgres tahsilo_geri
pg_restore -U postgres --no-owner -d tahsilo_geri backups/tahsilo-.../database.dump
# belgeler: yedekteki storage klasörünü STORAGE_DIR konumuna kopyalayın
```

Geri yüklemeyi en az ayda bir boş bir veritabanında deneyin. Yedek, ancak geri yüklenebildiği kanıtlanmışsa işe yarar.

## 6. İzleme

- `GET /api/v1/health`: veritabanı erişimi; konteyner sağlık kontrolü bunu kullanır.
- Platform paneli → Sistem sağlığı: kuyruk birikimi, başarısız işler, webhook hataları.
- API logları: `docker compose logs api`. Merkezi log için Docker log sürücüsünü (Loki, CloudWatch vb.) yapılandırın.

## 7. Güncelleme

```bash
git pull
docker compose up -d --build
```

Güncellemeden önce yedek alın. Migration'lar başlangıçta otomatik uygulanır.

## 8. Canlıya alma kontrol listesi

- [ ] Tüm SERVICE_PASSWORD_* değerleri rastgele ve örnekten farklı
- [ ] Şifreleme anahtarı (SERVICE_PASSWORD_64_ENCRYPTION) güvenli bir kasada ayrıca saklanıyor
- [ ] HTTPS çalışıyor; `NODE_ENV=production`
- [ ] Günlük yedek + sunucu dışı kopya + aylık geri yükleme denemesi
- [ ] SMTP ile test bildirimi alındı
- [ ] Platform yöneticisi oluşturuldu, demo kullanıcıları yüklenmedi (`db:seed` üretimde **çalıştırılmamalı**)
- [ ] Sandbox sağlayıcılar yerine gerçek POS/ERP/banka adaptörleri bağlandı veya sandbox kullanımı kullanıcılara açıkça belirtildi
- [ ] KVKK aydınlatma metni ve PCI DSS kapsam değerlendirmesi uzmanlarla yapıldı
