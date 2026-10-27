'use client';

import { ArrowLeft, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SourceBadge } from '@/components/badges';
import { ConnectionStatusBadge } from '@/components/bank-connections';
import { ImportWizard } from '@/components/import-wizard';
import { AccountTransactions, ImportHistory } from '@/components/txn-table';
import { Button, Card, ErrorBox, Loading, PageHeader, Stat } from '@/components/ui';
import { useApi } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function BankAccountPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const { data: a, error, reload } = useApi<any>(`/bank-accounts/${id}`);
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!a) return <Loading />;

  return (
    <>
      <Link href="/banks" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Bankalar
      </Link>
      <PageHeader
        title={a.name}
        description={`${a.bankName}${a.ibanMasked ? ` • ${a.ibanMasked}` : ''} • ${a.currency}`}
        actions={
          can('import.create') &&
          !a.connectionId && (
            <Button onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Ekstre içe aktar
            </Button>
          )
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Bakiye" value={money(a.balance, a.currency)} badge={<SourceBadge source={a.balanceSource} />} hint={a.balanceAsOf ? `${date(a.balanceAsOf)} itibarıyla` : 'Bakiye bilinmiyor'} />
        <Stat
          label="Bağlantı"
          value={a.connectionId && a.connection ? 'Banka bağlantısı' : 'Ekstre ile'}
          badge={a.connectionId && a.connection ? <ConnectionStatusBadge status={a.connection.status} /> : undefined}
          hint={
            a.connectionId && a.connection
              ? `Son senkronizasyon: ${relative(a.connection.lastSyncAt)}${a.connection.consentExpiresAt ? ` • izin bitişi ${date(a.connection.consentExpiresAt)}` : ''}`
              : 'Bankalar sayfasından otomatik bağlantı kurulabilir'
          }
          href={a.connectionId ? '/banks' : undefined}
        />
        <Stat label="İçe aktarma" value={`${a.imports.length} dosya`} hint={a.imports[0] ? `Son: ${a.imports[0].fileName}` : 'Henüz yok'} />
      </div>

      <Card title="Hareketler" padded={false} className="mt-6">
        <AccountTransactions key={version} filter={{ bankAccountId: id }} />
      </Card>
      <Card title="İçe aktarma geçmişi" padded={false} className="mt-6">
        <ImportHistory imports={a.imports} />
      </Card>

      {importing && (
        <ImportWizard
          open
          onClose={() => setImporting(false)}
          onDone={() => {
            reload();
            setVersion((v) => v + 1);
          }}
          target={{ bankAccountId: id, label: a.name }}
          currency={a.currency}
        />
      )}
    </>
  );
}
