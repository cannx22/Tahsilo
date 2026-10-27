'use client';

import { Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SourceBadge } from '@/components/badges';
import { BankConnections, ConnectionStatusBadge } from '@/components/bank-connections';
import { BranchField } from '@/components/branch-select';
import { ImportWizard } from '@/components/import-wizard';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, isoDate, money, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function BanksPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<any[]>('/bank-accounts');
  const [creating, setCreating] = useState(false);
  const [balanceFor, setBalanceFor] = useState<any>(null);
  const [importFor, setImportFor] = useState<any>(null);
  const { run, busy } = useAction();

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await run(() => api('/bank-accounts', { body: formValues(e.currentTarget) }), 'Banka hesabı eklendi');
    if (ok) {
      setCreating(false);
      reload();
    }
  }

  async function saveBalance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const ok = await run(() => api(`/bank-accounts/${balanceFor.id}/balance`, { body: { balance: Number(v.balance), asOf: v.asOf } }), 'Bakiye kaydedildi');
    if (ok) {
      setBalanceFor(null);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Bankalar"
        description="Banka hesapları, bakiyeler ve ekstre aktarımları. Her bakiyenin kaynağı ve tarihi gösterilir."
        actions={
          can('bank.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Hesap ekle
            </Button>
          )
        }
      />
      <BankConnections onChange={reload} />

      <Card padded={false} className="mt-6">
        {error ? (
          <div className="p-5">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : !data && loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Henüz banka hesabı yok" description="Hesap ekleyip ekstre dosyası içe aktararak başlayın." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Hesap</Th>
                <Th>Bağlantı</Th>
                <Th align="right">Bakiye</Th>
                <Th>Bakiye kaynağı</Th>
                <Th>Son aktarım</Th>
                <Th align="right">Hareket</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/banks/${a.id}`} className="font-medium text-navy hover:text-brand">
                      {a.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {a.bankName} {a.ibanMasked && `• ${a.ibanMasked}`} • {a.currency}
                      {!a.isActive && ' • pasif'}
                    </div>
                  </Td>
                  <Td>
                    {a.connectionId && a.connection ? (
                      <div className="flex flex-col items-start gap-1">
                        <SourceBadge source="CONNECTED" />
                        {a.connection.status !== 'ACTIVE' && <ConnectionStatusBadge status={a.connection.status} />}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Ekstre ile</span>
                    )}
                  </Td>
                  <Td align="right" className="font-semibold">
                    {money(a.balance, a.currency)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <SourceBadge source={a.balanceSource} />
                      <span className="text-xs text-muted">{a.balanceAsOf ? date(a.balanceAsOf) : ''}</span>
                    </div>
                  </Td>
                  <Td className="text-xs text-muted">{a.lastImport ? `${relative(a.lastImport.createdAt)} • ${a.lastImport.fileName}` : 'Yok'}</Td>
                  <Td align="right">{a.transactionCount}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {can('import.create') && !a.connectionId && (
                        <Button size="sm" variant="secondary" onClick={() => setImportFor(a)}>
                          <Upload className="h-3.5 w-3.5" /> Ekstre içe aktar
                        </Button>
                      )}
                      {can('bank.manage') && !a.connectionId && (
                        <Button size="sm" variant="ghost" onClick={() => setBalanceFor(a)}>
                          Bakiye gir
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Banka hesabı ekle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="bank-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="bank-form" onSubmit={create} className="space-y-3">
          <Field label="Banka">
            <Input name="bankName" required maxLength={80} placeholder="Örn. İş Bankası" />
          </Field>
          <Field label="Hesap adı">
            <Input name="name" required maxLength={80} placeholder="Örn. Ana TL hesabı" />
          </Field>
          <Field label="IBAN" hint="Yalnızca maskelenmiş hali saklanır (ilk 4 ve son 4 hane).">
            <Input name="iban" maxLength={34} placeholder="TR.." />
          </Field>
          <Field label="Para birimi">
            <Input name="currency" defaultValue="TRY" maxLength={3} minLength={3} required />
          </Field>
          <BranchField hint="Hesabın hareketleri bu şubeye yazılır" />
        </form>
      </Modal>

      <Modal
        open={!!balanceFor}
        onClose={() => setBalanceFor(null)}
        title={`Manuel bakiye • ${balanceFor?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBalanceFor(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="balance-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="balance-form" onSubmit={saveBalance} className="space-y-3">
          <Notice tone="warning">Manuel bakiye “Manuel” etiketiyle gösterilir ve banka verisi gibi sunulmaz. Değişiklik denetim kaydına yazılır.</Notice>
          <Field label={`Bakiye (${balanceFor?.currency ?? ''})`}>
            <Input name="balance" type="number" step="0.01" required />
          </Field>
          <Field label="Bakiye tarihi">
            <Input name="asOf" type="date" defaultValue={isoDate(new Date())} required />
          </Field>
        </form>
      </Modal>

      {importFor && (
        <ImportWizard
          open
          onClose={() => setImportFor(null)}
          onDone={reload}
          target={{ bankAccountId: importFor.id, label: importFor.name }}
          currency={importFor.currency}
        />
      )}
    </>
  );
}
