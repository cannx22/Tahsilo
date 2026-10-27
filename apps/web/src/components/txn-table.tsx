'use client';

import Link from 'next/link';
import { useState } from 'react';
import { qs, useApi } from '@/lib/api';
import { date } from '@/lib/format';
import { SourceBadge, SourceTypeLabel, StatusBadge } from './badges';
import { Amount } from './money';
import { EmptyState, ErrorBox, Loading, Pagination, Table, Td, Th } from './ui';

/** Belirli bir hesap/kart için sade hareket listesi (detay sayfalarında kullanılır). */
export function AccountTransactions({ filter }: { filter: { bankAccountId?: string; cardAccountId?: string } }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<any>(`/transactions${qs({ ...filter, page, pageSize: 25 })}`);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data && loading) return <Loading />;
  if (!data?.items.length) return <EmptyState title="Hareket yok" description="Ekstre içe aktararak hareketleri getirin." />;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Tarih</Th>
            <Th>Açıklama</Th>
            <Th>Kategori</Th>
            <Th>Durum</Th>
            <Th>Kaynak</Th>
            <Th align="right">Tutar</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((t: any) => (
            <tr key={t.id} className="hover:bg-slate-50">
              <Td className="whitespace-nowrap text-xs text-muted">{date(t.date)}</Td>
              <Td>
                <Link href={`/transactions/${t.id}`} className="font-medium text-navy hover:text-brand">
                  {t.description}
                </Link>
                <div>
                  <SourceTypeLabel type={t.sourceType} />
                </div>
              </Td>
              <Td>{t.category?.name ?? <span className="text-xs text-muted">Kategorisiz</span>}</Td>
              <Td>
                <StatusBadge status={t.status} />
              </Td>
              <Td>
                <SourceBadge source={t.dataSource} />
              </Td>
              <Td align="right">
                <Amount value={t.amount} currency={t.currency} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </>
  );
}

/** Ekstre içe aktarma geçmişi tablosu. */
export function ImportHistory({ imports }: { imports: any[] }) {
  if (!imports?.length) return <EmptyState title="Henüz içe aktarma yok" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Zaman</Th>
          <Th>Dosya</Th>
          <Th align="right">Satır</Th>
          <Th align="right">Yeni</Th>
          <Th align="right">Mükerrer</Th>
          <Th align="right">Hatalı</Th>
        </tr>
      </thead>
      <tbody>
        {imports.map((b) => (
          <tr key={b.id}>
            <Td className="whitespace-nowrap text-xs text-muted">{new Date(b.createdAt).toLocaleString('tr-TR')}</Td>
            <Td>{b.fileName}</Td>
            <Td align="right">{b.rowCount}</Td>
            <Td align="right">{b.importedCount}</Td>
            <Td align="right">{b.duplicateCount}</Td>
            <Td align="right" className={b.errorCount ? 'text-warning-700' : ''}>
              {b.errorCount}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
