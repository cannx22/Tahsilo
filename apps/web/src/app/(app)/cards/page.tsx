'use client';

import { CreditCard, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@/components/badges';
import { BranchField } from '@/components/branch-select';
import { ImportWizard } from '@/components/import-wizard';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function CardsPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<any[]>('/card-accounts');
  const users = useApi<any[]>(can('settings.users') ? '/settings/users' : null);
  const [creating, setCreating] = useState(false);
  const [importFor, setImportFor] = useState<any>(null);
  const { run, busy } = useAction();

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body: Record<string, unknown> = { ...v };
    for (const k of ['creditLimit', 'statementDay', 'dueDay']) if (v[k]) body[k] = Number(v[k]);
    const ok = await run(() => api('/card-accounts', { body }), 'Kart eklendi');
    if (ok) {
      setCreating(false);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Şirket Kartları"
        description="Kart hareketleri, ekstre dönemleri ve ödeme vadeleri. Provizyon ve kesinleşmiş harcamalar ayrı izlenir."
        actions={
          can('card.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Kart ekle
            </Button>
          )
        }
      />
      <Card padded={false}>
        {error ? (
          <div className="p-5">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : !data && loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Kart bulunamadı" description={can('card.manage') ? 'Şirket kartlarınızı ekleyip ekstre içe aktarın.' : 'Size tanımlı bir şirket kartı yok.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kart</Th>
                <Th>Kart sahibi</Th>
                <Th align="right">Limit</Th>
                <Th align="right">Ekstresiz (kesin)</Th>
                <Th align="right">Provizyon</Th>
                <Th>Son ekstre</Th>
                <Th>Son aktarım</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/cards/${c.id}`} className="flex items-center gap-2 font-medium text-navy hover:text-brand">
                      <CreditCard className="h-4 w-4 text-muted" />
                      {c.name} •••• {c.last4}
                    </Link>
                    <div className="text-xs text-muted">
                      {c.bankName}
                      {c.branch && ` • ${c.branch.name}`}
                      {!c.isActive && ' • pasif'}
                    </div>
                  </Td>
                  <Td>{c.holder?.name ?? c.holderName}</Td>
                  <Td align="right">{money(c.creditLimit, c.currency)}</Td>
                  <Td align="right">{money(c.unbilledPosted, c.currency)}</Td>
                  <Td align="right" className="text-warning-700">
                    {money(c.unbilledPending, c.currency)}
                  </Td>
                  <Td>
                    {c.lastStatement ? (
                      <div className="flex items-center gap-2">
                        <StatusBadge status={c.lastStatement.status} />
                        <span className="text-xs text-muted">vade {date(c.lastStatement.dueDate)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">Yok</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{c.lastImport ? relative(c.lastImport.createdAt) : 'Yok'}</Td>
                  <Td align="right">
                    {can('import.create') && (
                      <Button size="sm" variant="secondary" onClick={() => setImportFor(c)}>
                        <Upload className="h-3.5 w-3.5" /> İçe aktar
                      </Button>
                    )}
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
        title="Şirket kartı ekle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="card-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="card-form" onSubmit={create} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Notice>Tahsilo tam kart numarası ve CVV saklamaz. Yalnızca kartı ayırt etmek için son 4 hane girilir.</Notice>
          </div>
          <Field label="Kart adı" className="col-span-2">
            <Input name="name" required maxLength={80} placeholder="Örn. Satış ekibi kartı" />
          </Field>
          <Field label="Banka">
            <Input name="bankName" required maxLength={80} />
          </Field>
          <Field label="Son 4 hane">
            <Input name="last4" required pattern="\d{4}" maxLength={4} inputMode="numeric" />
          </Field>
          <Field label="Kart sahibi adı">
            <Input name="holderName" required maxLength={120} />
          </Field>
          <Field label="Kart sahibi kullanıcı" hint="Kullanıcı kendi kart hareketlerini görebilir">
            <Select name="holderUserId" defaultValue="">
              <option value="">— Seçilmedi —</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Limit">
            <Input name="creditLimit" type="number" step="0.01" min="0" />
          </Field>
          <Field label="Para birimi">
            <Input name="currency" defaultValue="TRY" maxLength={3} minLength={3} />
          </Field>
          <Field label="Hesap kesim günü">
            <Input name="statementDay" type="number" min="1" max="31" />
          </Field>
          <Field label="Son ödeme günü">
            <Input name="dueDay" type="number" min="1" max="31" />
          </Field>
          <div className="col-span-2">
            <BranchField hint="Kart hareketleri bu şubeye yazılır" />
          </div>
        </form>
      </Modal>

      {importFor && (
        <ImportWizard
          open
          onClose={() => setImportFor(null)}
          onDone={reload}
          target={{ cardAccountId: importFor.id, label: `${importFor.name} •••• ${importFor.last4}` }}
          currency={importFor.currency}
        />
      )}
    </>
  );
}
