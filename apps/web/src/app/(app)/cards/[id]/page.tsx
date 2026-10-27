'use client';

import { ArrowLeft, Pencil, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { SourceBadge, StatusBadge } from '@/components/badges';
import { BranchField } from '@/components/branch-select';
import { ImportWizard } from '@/components/import-wizard';
import { AccountTransactions, ImportHistory } from '@/components/txn-table';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Td, Th, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function CardPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useSession();
  const { data: c, error, reload } = useApi<any>(`/card-accounts/${id}`);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const { run, busy } = useAction();

  async function createStatement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body = {
      ...v,
      totalAmount: Number(v.totalAmount),
      ...(v.minimumPayment ? { minimumPayment: Number(v.minimumPayment) } : {}),
    };
    const r = await run(() => api<any>(`/card-accounts/${id}/statements`, { body }), 'Ekstre dönemi oluşturuldu');
    if (r) {
      setCreating(false);
      reload();
      setVersion((x) => x + 1);
    }
  }

  async function updateCard(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body = {
      name: v.name,
      holderName: v.holderName,
      creditLimit: v.creditLimit ? Number(v.creditLimit) : undefined,
      isActive: v.isActive === 'true',
      ...(me.branches.length || c.branchId ? { branchId: v.branchId ?? null } : {}),
    };
    const r = await run(() => api(`/card-accounts/${id}`, { method: 'PATCH', body }), 'Kart güncellendi');
    if (r) {
      setEditing(false);
      reload();
    }
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!c) return <Loading />;
  const branchName = c.branch?.name ?? me.branches.find((b) => b.id === c.branchId)?.name;

  return (
    <>
      <Link href="/cards" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-navy">
        <ArrowLeft className="h-4 w-4" /> Şirket kartları
      </Link>
      <PageHeader
        title={`${c.name} •••• ${c.last4}`}
        description={`${c.bankName} • ${c.holder?.name ?? c.holderName} • ${c.currency}${branchName ? ` • ${branchName}` : ''}${c.isActive ? '' : ' • pasif'}`}
        actions={
          <>
            {can('card.manage') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Düzenle
              </Button>
            )}
            {can('card.manage') && (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Ekstre dönemi
              </Button>
            )}
            {can('import.create') && (
              <Button onClick={() => setImporting(true)}>
                <Upload className="h-4 w-4" /> Ekstre içe aktar
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Limit" value={money(c.creditLimit, c.currency)} hint="Limit banka tarafından yönetilir; Tahsilo yalnızca görüntüler" />
        <Stat label="Hesap kesim / son ödeme günü" value={`${c.statementDay ?? '—'} / ${c.dueDay ?? '—'}`} />
        <Stat
          label="Son ekstre"
          value={c.statements[0] ? money(c.statements[0].totalAmount, c.currency) : '—'}
          hint={c.statements[0] ? `Son ödeme ${date(c.statements[0].dueDate)}` : 'Ekstre dönemi tanımlanmamış'}
        />
      </div>

      <Card title="Ekstreler" padded={false} className="mt-6">
        {!c.statements.length ? (
          <EmptyState title="Ekstre dönemi yok" description="Ekstre dönemi oluşturulduğunda dönem içindeki harcamalar o ekstreye bağlanır." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dönem</Th>
                <Th>Son ödeme</Th>
                <Th align="right">Toplam</Th>
                <Th align="right">Asgari</Th>
                <Th align="right">Ödenen</Th>
                <Th>Durum</Th>
                <Th>Kaynak</Th>
              </tr>
            </thead>
            <tbody>
              {c.statements.map((s: any) => (
                <tr key={s.id}>
                  <Td>
                    {date(s.periodStart)} – {date(s.periodEnd)}
                  </Td>
                  <Td>{date(s.dueDate)}</Td>
                  <Td align="right">{money(s.totalAmount, s.currency)}</Td>
                  <Td align="right">{money(s.minimumPayment, s.currency)}</Td>
                  <Td align="right">{money(s.paidAmount, s.currency)}</Td>
                  <Td>
                    <StatusBadge status={s.status} />
                  </Td>
                  <Td>
                    <SourceBadge source={s.source} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Kart hareketleri" padded={false} className="mt-6">
        <AccountTransactions key={version} filter={{ cardAccountId: id }} />
      </Card>
      {can('import.create') && (
        <Card title="İçe aktarma geçmişi" padded={false} className="mt-6">
          <ImportHistory imports={c.imports} />
        </Card>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Ekstre dönemi oluştur"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="st-form" loading={busy}>
              Oluştur
            </Button>
          </>
        }
      >
        <form id="st-form" onSubmit={createStatement} className="grid grid-cols-2 gap-3">
          <Field label="Dönem başlangıcı">
            <Input name="periodStart" type="date" required />
          </Field>
          <Field label="Dönem sonu (hesap kesim)">
            <Input name="periodEnd" type="date" required />
          </Field>
          <Field label="Son ödeme tarihi">
            <Input name="dueDate" type="date" required />
          </Field>
          <Field label="Ekstre toplamı">
            <Input name="totalAmount" type="number" step="0.01" min="0" required />
          </Field>
          <Field label="Asgari ödeme" className="col-span-2">
            <Input name="minimumPayment" type="number" step="0.01" min="0" />
          </Field>
          <p className="col-span-2 text-xs text-muted">Dönem içindeki ekstreye bağlanmamış kart hareketleri bu ekstreye bağlanır.</p>
        </form>
      </Modal>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Kartı düzenle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="card-edit" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="card-edit" onSubmit={updateCard} className="space-y-3">
          <Field label="Kart adı">
            <Input name="name" defaultValue={c.name} required maxLength={80} />
          </Field>
          <Field label="Kart sahibi adı">
            <Input name="holderName" defaultValue={c.holderName} required maxLength={120} />
          </Field>
          <Field label="Limit">
            <Input name="creditLimit" type="number" step="0.01" min="0" defaultValue={c.creditLimit ?? ''} />
          </Field>
          <BranchField defaultValue={c.branchId} currentName={c.branch?.name} hint="Değişirse kartın geçmiş hareketleri de yeni şubeye taşınır" />
          <Field label="Durum">
            <Select name="isActive" defaultValue={String(c.isActive)}>
              <option value="true">Aktif</option>
              <option value="false">Pasif</option>
            </Select>
          </Field>
        </form>
      </Modal>

      {importing && (
        <ImportWizard
          open
          onClose={() => setImporting(false)}
          onDone={() => {
            reload();
            setVersion((x) => x + 1);
          }}
          target={{ cardAccountId: id, label: `${c.name} •••• ${c.last4}` }}
          currency={c.currency}
        />
      )}
    </>
  );
}
