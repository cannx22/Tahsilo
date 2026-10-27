import { CryptoService } from '../src/common/crypto.service';
import { base32Encode, totp, verifyTotp } from '../src/auth/totp';
import { withDedupeKeys } from '../src/imports/imports.service';
import { guessMapping, mapRows, parseAmount, parseDate } from '../src/imports/parse';
import { nextDueDate } from '../src/ledger/ledger.service';

describe('ekstre ayrıştırma', () => {
  it('Türk ve İngiliz sayı biçimlerini okur', () => {
    expect(parseAmount('1.234,56', ',')).toBe('1234.56');
    expect(parseAmount('-1.234,56', ',')).toBe('-1234.56');
    expect(parseAmount('1.234,56-', ',')).toBe('-1234.56');
    expect(parseAmount('(250,00)', ',')).toBe('-250.00');
    expect(parseAmount('1,234.56', '.')).toBe('1234.56');
    expect(parseAmount('₺ 99,90', ',')).toBe('99.90');
    expect(parseAmount('abc', ',')).toBeNull();
    expect(parseAmount('', ',')).toBeNull();
  });

  it('tarihleri biçime göre okur ve geçersiz tarihi reddeder', () => {
    expect(parseDate('03.10.2026', 'DD.MM.YYYY')).toBe('2026-10-03');
    expect(parseDate('03/10/26', 'DD/MM/YYYY')).toBe('2026-10-03');
    expect(parseDate('10/03/2026', 'MM/DD/YYYY')).toBe('2026-10-03');
    expect(parseDate('2026-10-03 14:22', 'DD.MM.YYYY')).toBe('2026-10-03');
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBeNull();
  });

  it('Türkçe başlıklardan sütun eşlemesi tahmin eder', () => {
    const m = guessMapping({
      headers: ['İşlem Tarihi', 'Açıklama', 'Borç', 'Alacak', 'Bakiye', 'Dekont No'],
      rows: [
        ['İşlem Tarihi', 'Açıklama', 'Borç', 'Alacak', 'Bakiye', 'Dekont No'],
        ['01.10.2026', 'Kira', '45.000,00', '', '100.000,00', 'D1'],
      ],
    });
    expect(m).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, balance: 4, reference: 5, decimal: ',' });
  });

  it('borç/alacak sütunlarını işaretli tutara çevirir ve hatalı satırları raporlar', () => {
    const table = {
      headers: ['Tarih', 'Açıklama', 'Borç', 'Alacak'],
      rows: [
        ['Tarih', 'Açıklama', 'Borç', 'Alacak'],
        ['01.10.2026', 'Kira', '45.000,00', ''],
        ['02.10.2026', 'Tahsilat', '', '1.000,00'],
        ['xx', 'Bozuk', '1', ''],
      ],
    };
    const { rows, errors } = mapRows(table, { hasHeader: true, date: 0, description: 1, debit: 2, credit: 3, dateFormat: 'DD.MM.YYYY', decimal: ',' });
    expect(rows.map((r) => r.amount)).toEqual(['-45000.00', '1000.00']);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(4);
  });

  it('mükerrerlik anahtarı aynı dosyada deterministik, aynı gün aynı tutarlı iki işlemi ayırır', () => {
    const row = { line: 2, date: '2026-10-08', description: 'BSMV', amount: '-12.50', pending: false };
    const first = withDedupeKeys('bank:x', [row, { ...row, line: 3 }]);
    const again = withDedupeKeys('bank:x', [row, { ...row, line: 3 }]);
    expect(first[0].key).not.toBe(first[1].key);
    expect(first.map((k) => k.key)).toEqual(again.map((k) => k.key));
    expect(withDedupeKeys('bank:y', [row])[0].key).not.toBe(first[0].key);
  });
});

describe('tekrarlı ödeme vadesi', () => {
  it('ay sonunu korur', () => {
    expect(nextDueDate(new Date('2026-01-31'), 'MONTHLY')!.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(nextDueDate(new Date('2026-03-15'), 'QUARTERLY')!.toISOString().slice(0, 10)).toBe('2026-06-15');
    expect(nextDueDate(new Date('2026-03-15'), 'NONE')).toBeNull();
  });
});

describe('TOTP', () => {
  it('RFC 6238 test vektörünü üretir', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp(secret, Math.floor(59 / 30))).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '287083', 59_000)).toBe(false);
  });
});

describe('şifreleme anahtarı', () => {
  it('base64 32 bayt anahtarı aynen kullanır, uzun parolayı türetir, kısa değeri reddeder', () => {
    const b64 = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
    expect(CryptoService.deriveKey(b64).equals(Buffer.from(b64, 'base64'))).toBe(true);
    expect(CryptoService.deriveKey('x'.repeat(64))).toHaveLength(32);
    expect(() => CryptoService.deriveKey('kisa')).toThrow();
  });
});
