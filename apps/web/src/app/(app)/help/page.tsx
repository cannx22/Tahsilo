'use client';

import { SourceBadge, StatusBadge } from '@/components/badges';
import { Card, PageHeader, Table, Td, Th } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/session';

const ROLE_HELP: Record<string, string> = {
  OWNER: 'Tüm modüller, banka/kart tanımları, kullanıcılar, ERP ve terminal yapılandırması.',
  ACCOUNTANT: 'Hareketler, içe aktarma, giderler, cari/fatura, tahsilat, mutabakat, raporlar.',
  MANAGER: 'Kendi departmanının giderlerini görür ve onaylar; kendi kartını görür.',
  EMPLOYEE: 'Kendi kartının hareketleri, kendi giderleri ve fiş ekleme.',
  OPERATIONS: 'Ödeme linkleri ve tahsilat durumları; cari ve faturaları görüntüleme.',
  AUDITOR: 'Tüm kayıtları salt okunur inceleme, rapor dışa aktarma ve denetim kaydı.',
};

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Yardım" description="Tahsilo'da verinin nasıl göründüğü ve sandbox entegrasyonlarının nasıl test edildiği." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Veri kaynağı etiketleri">
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <SourceBadge source="CONNECTED" /> <span>API&apos;den alındı (banka, sanal POS). Son senkronizasyon zamanı gösterilir.</span>
            </li>
            <li className="flex gap-3">
              <SourceBadge source="IMPORTED" /> <span>Ekstre dosyasından içe aktarıldı. Dosya adı ve aktarım zamanı saklanır.</span>
            </li>
            <li className="flex gap-3">
              <SourceBadge source="MANUAL" /> <span>Kullanıcı tarafından girildi; giren kişi ve tarih kaydedilir. Banka verisi gibi gösterilmez.</span>
            </li>
            <li className="flex gap-3">
              <SourceBadge source="FORECAST" /> <span>Hesaplanan değer (ör. nakit akışı). Kesin bakiye değildir; varsayımlar ayrıca gösterilir.</span>
            </li>
            <li className="flex gap-3">
              <StatusBadge status="UNMATCHED" /> <span>Kaynaklar arasında henüz doğrulanmamış fark veya eşleşmemiş kayıt.</span>
            </li>
          </ul>
        </Card>

        <Card title="Ekstre içe aktarma ve mükerrer kayıt">
          <ul className="list-disc space-y-2 pl-5 text-sm text-navy">
            <li>CSV, TXT ve XLSX desteklenir. Türk bankalarının Windows-1254 kodlamalı dosyaları otomatik tanınır.</li>
            <li>Sütunlar otomatik tahmin edilir; önizleme ekranında düzeltebilirsiniz.</li>
            <li>Referans sütunu varsa her hareket referansıyla, yoksa tarih + tutar + açıklama + dosya içi sırasıyla tanımlanır.</li>
            <li>Aynı dosyayı tekrar yüklemek mükerrer kayıt oluşturmaz; atlanan satırlar sonuçta “Mükerrer” olarak sayılır.</li>
            <li>Dosyada bakiye sütunu varsa hesabın bakiyesi en güncel satırdan “Dosyadan” etiketiyle güncellenir.</li>
          </ul>
        </Card>

        <Card title="Kart işlemleri: provizyon ve kesinleşme">
          <div className="space-y-2 text-sm text-navy">
            <p>
              <StatusBadge status="PENDING" /> Provizyon: banka tutarı bloke etmiştir ama işlem kesinleşmemiştir.
            </p>
            <p>
              <StatusBadge status="POSTED" /> Kesinleşti: harcama karta yansımıştır ve ekstreye girer.
            </p>
            <p>
              <StatusBadge status="REVERSED" /> Kesinleşen işlem içe aktarıldığında aynı tutarlı eski provizyon ters kayda alınır; böylece harcama iki kez sayılmaz.
            </p>
            <p className="text-muted">Kart borcunun ödenmesi ayrı bir olaydır: banka hesabından çıkan ödeme mutabakatta ilgili ekstreyle eşleştirilir.</p>
          </div>
        </Card>

        <Card title="Roller" padded={false}>
          <Table>
            <tbody>
              {Object.entries(ROLE_LABEL).map(([k, l]) => (
                <tr key={k}>
                  <Td className="font-medium text-navy">{l}</Td>
                  <Td className="text-muted">{ROLE_HELP[k]}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="MockPOS (sanal POS sandbox) test kartları" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Kart numarası</Th>
                <Th>Sonuç</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="font-mono">4111 1111 1111 1111</Td>
                <Td>Başarılı ödeme</Td>
              </tr>
              <tr>
                <Td className="font-mono">4000 0000 0000 3220</Td>
                <Td>3D Secure doğrulaması ister — kod: 123456</Td>
              </tr>
              <tr>
                <Td className="font-mono">4000 0000 0000 0002</Td>
                <Td>Reddedilir (yetersiz bakiye)</Td>
              </tr>
            </tbody>
          </Table>
          <p className="px-5 py-3 text-xs text-muted">
            Herhangi bir ileri tarih ve CVC kullanılabilir. Kart bilgisi sağlayıcının sayfasında girilir; Tahsilo kart numarası almaz ve saklamaz. Sağlayıcı sonucu
            webhook ile (bilerek iki kez) bildirir; Tahsilo sonucu sağlayıcıdan sorgulayarak doğrular ve çift tahsilat oluşturmaz.
          </p>
        </Card>

        <Card title="MockERP (ERP sandbox) yapılandırması">
          <ul className="list-disc space-y-2 pl-5 text-sm text-navy">
            <li>
              <b>companyCode</b>: ERP&apos;deki şirket kodu. Her kod için örnek cariler ve faturalar ayrı tutulur.
            </li>
            <li>
              <b>apiKey</b>: herhangi bir değer. <code>invalid</code> verilirse kalıcı yetki hatası oluşur (yeniden denenmez).
            </li>
            <li>
              <b>failRate</b> (0–1, isteğe bağlı): rastgele geçici hata oranı. Geçici hatalar 10 sn, 20 sn, 40 sn aralıklarla otomatik yeniden denenir.
            </li>
            <li>Veri yönü: cari ve faturalar ERP → Tahsilo; tahsilat sonuçları ve onaylı giderler Tahsilo → ERP. Aynı kayıt tekrar aktarılırsa ERP&apos;de mükerrer oluşmaz.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
