'use client';

import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AuditRow } from '@/components/audit-trail';
import { Badge } from '@/components/badges';
import { useReference } from '@/components/expense-form';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Select, Table, Tabs, Td, Th, formValues, useAction } from '@/components/ui';
import { api, qs, useApi } from '@/lib/api';
import { money, relative } from '@/lib/format';
import { ROLE_LABEL, useSession } from '@/lib/session';

type Tab = 'tenant' | 'users' | 'categories' | 'org' | 'branches' | 'approvals' | 'audit';

export default function SettingsPage() {
  const { can } = useSession();
  const tabs: { key: Tab; label: string }[] = [];
  if (can('settings.manage')) tabs.push({ key: 'tenant', label: 'Firma' });
  if (can('settings.users')) tabs.push({ key: 'users', label: 'Kullanıcılar' });
  if (can('settings.manage'))
    tabs.push(
      { key: 'categories', label: 'Kategoriler' },
      { key: 'org', label: 'Departman ve maliyet merkezleri' },
      { key: 'branches', label: 'Şubeler' },
      { key: 'approvals', label: 'Onay kuralları' },
    );
  if (can('audit.view')) tabs.push({ key: 'audit', label: 'Denetim kaydı' });
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'audit');

  return (
    <>
      <PageHeader title="Ayarlar" description="Firma, kullanıcılar, roller, şubeler, onay kuralları, sınıflandırma ve denetim kaydı." />
      {tabs.length === 0 ? (
        <Card>
          <EmptyState title="Ayarlara erişim yetkiniz yok" />
        </Card>
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} items={tabs} />
          {tab === 'tenant' && <TenantTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'categories' && <CategoriesTab />}
          {tab === 'org' && <OrgTab />}
          {tab === 'branches' && <BranchesTab />}
          {tab === 'approvals' && <ApprovalsTab />}
          {tab === 'audit' && <AuditTab />}
        </>
      )}
    </>
  );
}

function TenantTab() {
  const { data, error, reload } = useApi<any>('/settings/tenant');
  const { run, busy } = useAction();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await run(() => api('/settings/tenant', { method: 'PATCH', body: formValues(e.currentTarget) }), 'Firma bilgileri güncellendi');
    if (ok) reload();
  }
  return (
    <Card title="Firma bilgileri" className="max-w-xl">
      <form onSubmit={save} className="space-y-3">
        <Field label="Firma unvanı">
          <Input name="name" defaultValue={data.name} required maxLength={120} />
        </Field>
        <Field label="Vergi numarası">
          <Input name="taxNumber" defaultValue={data.taxNumber ?? ''} maxLength={20} />
        </Field>
        <Field label="Ana para birimi" hint="Genel bakış ve nakit akışı bu para biriminde hesaplanır">
          <Input value={data.baseCurrency} disabled />
        </Field>
        <Field label="Tenant kimliği" hint="Destek taleplerinde kullanılır">
          <Input value={`${data.slug} (${data.id})`} disabled />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Kaydet
          </Button>
        </div>
      </form>
    </Card>
  );
}

function UsersTab() {
  const { me } = useSession();
  const { data, error, reload } = useApi<any[]>('/settings/users');
  const ref = useReference();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const { run, busy } = useAction();

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await run(() => api('/settings/users', { body: formValues(e.currentTarget) }), 'Kullanıcı oluşturuldu');
    if (ok) {
      setCreating(false);
      reload();
    }
  }

  async function update(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body = { name: v.name, role: v.role, departmentId: v.departmentId ?? null, branchId: v.branchId ?? null, isActive: v.isActive === 'true' };
    const ok = await run(() => api(`/settings/users/${editing.id}`, { method: 'PATCH', body }), 'Kullanıcı güncellendi');
    if (ok) {
      setEditing(null);
      reload();
    }
  }

  const roleSelect = (defaultValue?: string) => (
    <Select name="role" defaultValue={defaultValue ?? 'EMPLOYEE'} required>
      {Object.entries(ROLE_LABEL).map(([k, l]) => (
        <option key={k} value={k}>
          {l}
        </option>
      ))}
    </Select>
  );
  const deptSelect = (defaultValue?: string | null) => (
    <Select name="departmentId" defaultValue={defaultValue ?? ''}>
      <option value="">—</option>
      {ref.data?.departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
  const branchSelect = (defaultValue?: string | null) => (
    <Select name="branchId" defaultValue={defaultValue ?? ''}>
      <option value="">—</option>
      {ref.data?.branches.filter((b) => b.isActive || b.id === defaultValue).map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  );

  return (
    <div className="space-y-6">
      <Card
        title="Kullanıcılar"
        padded={false}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Kullanıcı ekle
          </Button>
        }
      >
        {error ? (
          <div className="p-5">
            <ErrorBox error={error} onRetry={reload} />
          </div>
        ) : !data ? (
          <Loading />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ad</Th>
                <Th>Rol</Th>
                <Th>Departman</Th>
                <Th>Şube</Th>
                <Th>Durum</Th>
                <Th>Son giriş</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <div className="font-medium text-navy">
                      {u.name} {u.id === me.id && <span className="text-xs text-muted">(siz)</span>}
                    </div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </Td>
                  <Td>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}</Td>
                  <Td>{u.department?.name ?? '—'}</Td>
                  <Td>{u.branch?.name ?? '—'}</Td>
                  <Td>{u.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Pasif</Badge>}</Td>
                  <Td className="text-xs text-muted">{u.lastLoginAt ? relative(u.lastLoginAt) : 'Hiç'}</Td>
                  <Td align="right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Düzenle
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Roller ve izinler">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ref.data?.roles.map((r) => (
            <div key={r.key} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-navy">{r.label}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.permissions.map((p) => (
                  <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-muted">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Kullanıcı ekle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="user-form" loading={busy}>
              Oluştur
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={create} className="space-y-3">
          <Field label="Ad soyad">
            <Input name="name" required maxLength={120} />
          </Field>
          <Field label="E-posta">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Rol">{roleSelect()}</Field>
          <Field label="Departman" hint="Ekip yöneticileri kendi departmanlarının giderlerini görür">
            {deptSelect()}
          </Field>
          {!!ref.data?.branches.length && (
            <Field label="Şube" hint="Kullanıcının giderleri varsayılan olarak bu şubeye yazılır">
              {branchSelect()}
            </Field>
          )}
          <Field label="Geçici parola" hint="En az 10 karakter; kullanıcıya güvenli kanaldan iletin">
            <Input name="password" type="password" required minLength={10} autoComplete="new-password" />
          </Field>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Kullanıcıyı düzenle • ${editing?.email ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="user-edit-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        {editing && (
          <form id="user-edit-form" onSubmit={update} className="space-y-3">
            <Field label="Ad soyad">
              <Input name="name" defaultValue={editing.name} required maxLength={120} />
            </Field>
            <Field label="Rol">{roleSelect(editing.role)}</Field>
            <Field label="Departman">{deptSelect(editing.department?.id)}</Field>
            {!!ref.data?.branches.length && <Field label="Şube">{branchSelect(editing.branch?.id)}</Field>}
            <Field label="Durum">
              <Select name="isActive" defaultValue={String(editing.isActive)}>
                <option value="true">Aktif</option>
                <option value="false">Pasif (oturum açamaz)</option>
              </Select>
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}

function CategoriesTab() {
  const { data, error, reload } = useReference();
  const [editing, setEditing] = useState<any>(null);
  const { run, busy } = useAction();

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = formValues(e.currentTarget);
    const body = {
      name: v.name,
      code: v.code,
      keywords: (v.keywords ?? '').split(',').map((k) => k.trim()).filter(Boolean),
      ...(editing.id ? { isActive: v.isActive === 'true' } : {}),
    };
    const ok = await run(
      () => (editing.id ? api(`/settings/categories/${editing.id}`, { method: 'PATCH', body }) : api('/settings/categories', { body })),
      'Kategori kaydedildi',
    );
    if (ok) {
      setEditing(null);
      reload();
    }
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <Card
      title="Gider kategorileri"
      padded={false}
      actions={
        <Button size="sm" onClick={() => setEditing({})}>
          <Plus className="h-3.5 w-3.5" /> Kategori ekle
        </Button>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>Kategori</Th>
            <Th>Hesap kodu</Th>
            <Th>Öneri anahtar kelimeleri</Th>
            <Th>Durum</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {data.categories.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium text-navy">{c.name}</Td>
              <Td className="text-xs">{c.code ?? '—'}</Td>
              <Td className="max-w-md text-xs text-muted">{c.keywords.join(', ') || '—'}</Td>
              <Td>{c.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Pasif</Badge>}</Td>
              <Td align="right">
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  Düzenle
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Kategoriyi düzenle' : 'Kategori ekle'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="cat-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        {editing && (
          <form id="cat-form" onSubmit={save} className="space-y-3">
            <Field label="Ad">
              <Input name="name" defaultValue={editing.name ?? ''} required maxLength={120} />
            </Field>
            <Field label="Muhasebe hesap kodu" hint="ERP'ye gider aktarımında kullanılır">
              <Input name="code" defaultValue={editing.code ?? ''} maxLength={30} />
            </Field>
            <Field label="Anahtar kelimeler" hint="Virgülle ayırın. Hareket açıklamasında geçerse bu kategori önerilir.">
              <Input name="keywords" defaultValue={(editing.keywords ?? []).join(', ')} />
            </Field>
            {editing.id && (
              <Field label="Durum">
                <Select name="isActive" defaultValue={String(editing.isActive)}>
                  <option value="true">Aktif</option>
                  <option value="false">Pasif</option>
                </Select>
              </Field>
            )}
          </form>
        )}
      </Modal>
    </Card>
  );
}

function OrgTab() {
  const { data, error, reload } = useReference();
  const { run, busy } = useAction();

  async function add(e: React.FormEvent<HTMLFormElement>, path: string, msg: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const ok = await run(() => api(path, { body: formValues(form) }), msg);
    if (ok) {
      form.reset();
      reload();
    }
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Departmanlar">
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {data.departments.map((d) => (
            <li key={d.id} className="py-2 text-navy">
              {d.name}
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => add(e, '/settings/departments', 'Departman eklendi')} className="flex gap-2">
          <Input name="name" required maxLength={120} placeholder="Yeni departman" />
          <Button type="submit" loading={busy}>
            Ekle
          </Button>
        </form>
      </Card>
      <Card title="Maliyet merkezleri">
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {data.costCenters.map((c) => (
            <li key={c.id} className="flex gap-3 py-2 text-navy">
              <span className="w-20 text-muted">{c.code}</span> {c.name}
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => add(e, '/settings/cost-centers', 'Maliyet merkezi eklendi')} className="flex gap-2">
          <Input name="code" required maxLength={30} placeholder="Kod" className="w-28" />
          <Input name="name" required maxLength={120} placeholder="Ad" />
          <Button type="submit" loading={busy}>
            Ekle
          </Button>
        </form>
      </Card>
    </div>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [debounced, setDebounced] = useState({ action: '', entityType: '' });
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced({ action, entityType });
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [action, entityType]);
  const { data, error, reload } = useApi<any>(`/settings/audit-logs${qs({ page, ...debounced })}`);

  return (
    <Card padded={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-3">
        <Field label="İşlem içerir">
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="ör. expense, import, payment" />
        </Field>
        <Field label="Kayıt türü">
          <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">Tümü</option>
            {['FinancialTransaction', 'ImportBatch', 'Expense', 'Invoice', 'PaymentRequest', 'PaymentAttempt', 'Refund', 'ReconciliationMatch', 'BankAccount', 'CardAccount', 'User', 'Tenant', 'Document', 'ErpConnection', 'SyncJob', 'Report'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end text-xs text-muted">Kayıtlar değiştirilemez ve silinemez; kim, ne zaman, hangi kaydı değiştirdi bilgisini içerir.</div>
      </div>
      {error ? (
        <div className="p-5">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <Loading />
      ) : !data.items.length ? (
        <EmptyState title="Kayıt bulunamadı" />
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {data.items.map((l: any) => (
              <div key={l.id} className="flex items-start">
                <ul className="flex-1">
                  <AuditRow log={l} />
                </ul>
                <div className="hidden px-5 py-2 text-right text-xs text-muted md:block">
                  {l.entityType}
                  <div className="font-mono">{l.entityId?.slice(0, 12)}</div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function BranchesTab() {
  const { data, error, reload } = useReference();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const ok = await run(() => api('/settings/branches', { body: formValues(form) }), 'Şube eklendi');
    if (ok) {
      form.reset();
      reload();
    }
  }

  async function patch(id: string, body: object, msg: string) {
    const ok = await run(() => api(`/settings/branches/${id}`, { method: 'PATCH', body }), msg);
    if (ok) {
      setEditing(null);
      reload();
    }
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <Notice>
        Banka hesapları, kartlar, kullanıcılar ve faturalar bir şubeye atanabilir. Üst bardan şube seçildiğinde listeler, özetler ve raporlar o şubeye daralır. Yeni şube,
        kullanıcıların şube listesinde bir sonraki oturum yenilemesinde görünür.
      </Notice>
      <Card title="Şubeler" padded={false}>
        {data.branches.length === 0 ? (
          <EmptyState title="Henüz şube yok" description="Tek merkezli çalışıyorsanız şube tanımlamanız gerekmez." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kod</Th>
                <Th>Ad</Th>
                <Th>Durum</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.id}>
                  <Td className="font-mono text-xs">{b.code}</Td>
                  <Td className="font-medium text-navy">{b.name}</Td>
                  <Td>{b.isActive ? <Badge tone="success">Aktif</Badge> : <Badge>Pasif</Badge>}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(b)}>
                        Yeniden adlandır
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy} onClick={() => patch(b.id, { isActive: !b.isActive }, b.isActive ? 'Şube pasifleştirildi' : 'Şube etkinleştirildi')}>
                        {b.isActive ? 'Pasifleştir' : 'Etkinleştir'}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
          <Input name="code" required maxLength={20} placeholder="Kod (ör. IST)" className="w-36" />
          <Input name="name" required maxLength={120} placeholder="Şube adı" className="min-w-[200px] flex-1" />
          <Button type="submit" loading={busy}>
            <Plus className="h-4 w-4" /> Ekle
          </Button>
        </form>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Şubeyi yeniden adlandır"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Vazgeç
            </Button>
            <Button type="submit" form="branch-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        {editing && (
          <form
            id="branch-form"
            onSubmit={(e) => {
              e.preventDefault();
              void patch(editing.id, { name: formValues(e.currentTarget).name }, 'Şube güncellendi');
            }}
          >
            <Field label="Ad">
              <Input name="name" defaultValue={editing.name} required maxLength={120} />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}

interface ApprovalRule {
  id: string;
  name: string;
  minAmount: string;
  approverRoles: string[];
}

const APPROVER_ROLES = ['MANAGER', 'ACCOUNTANT', 'OWNER'] as const;

function ApprovalsTab() {
  const { data, error, reload } = useApi<{ items: ApprovalRule[]; autoApproveLimit: string | null }>('/approval-rules');
  const { run, busy } = useAction();
  const [creating, setCreating] = useState(false);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const roles = fd.getAll('approverRoles').map(String);
    const ok = await run(async () => {
      if (!roles.length) throw new Error('En az bir onaylayıcı rol seçin');
      return api('/approval-rules', { body: { name: String(fd.get('name')), minAmount: Number(fd.get('minAmount')), approverRoles: roles } });
    }, 'Onay kuralı eklendi');
    if (ok) {
      setCreating(false);
      reload();
    }
  }

  async function saveLimit(limit: number | null, msg: string) {
    const ok = await run(() => api('/approval-rules/auto-approve', { method: 'PATCH', body: { limit } }), msg);
    if (ok) reload();
  }

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-6">
      <Notice>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Gider tutarına göre <b>en yüksek eşleşen alt sınırın</b> kuralı uygulanır; hiçbir kural eşleşmezse gider onay yetkisi olan herkes onaylayabilir.
          </li>
          <li>Firma sahibi her gideri onaylayabilir. Kimse kendi giderini onaylayamaz (firma sahibi hariç).</li>
          <li>Ekip yöneticileri yalnızca kendi departmanlarının giderlerini onaylar.</li>
          <li>Otomatik onay limiti ve altındaki giderler oluşturulduğu anda onaylanır.</li>
        </ul>
      </Notice>

      <Card title="Otomatik onay limiti" className="max-w-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = formValues(e.currentTarget);
            void saveLimit(v.limit ? Number(v.limit) : null, 'Otomatik onay limiti kaydedildi');
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <Field label="Bu tutar ve altındaki giderler otomatik onaylanır (TRY)" className="min-w-[220px] flex-1">
            <Input name="limit" type="number" step="0.01" min="0" defaultValue={data.autoApproveLimit ?? ''} placeholder="Boş: otomatik onay yok" key={data.autoApproveLimit ?? 'none'} />
          </Field>
          <Button type="submit" loading={busy}>
            Kaydet
          </Button>
          {data.autoApproveLimit && (
            <Button type="button" variant="secondary" loading={busy} onClick={() => saveLimit(null, 'Otomatik onay kapatıldı')}>
              Kapat
            </Button>
          )}
        </form>
      </Card>

      <Card
        title="Tutar bazlı onay kuralları"
        padded={false}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Kural ekle
          </Button>
        }
      >
        {data.items.length === 0 ? (
          <EmptyState title="Kural tanımlı değil" description="Gider onay yetkisi olan tüm roller her tutarı onaylayabilir." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Kural</Th>
                <Th align="right">Alt sınır</Th>
                <Th>Onaylayabilen roller</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-navy">{r.name}</Td>
                  <Td align="right">{money(r.minAmount)} ve üzeri</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.approverRoles.map((role) => (
                        <Badge key={role} tone="info">
                          {ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td align="right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (!confirm(`"${r.name}" kuralı silinsin mi?`)) return;
                        void run(() => api(`/approval-rules/${r.id}`, { method: 'DELETE' }), 'Kural silindi').then(() => reload());
                      }}
                    >
                      Sil
                    </Button>
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
        title="Onay kuralı ekle"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Vazgeç
            </Button>
            <Button type="submit" form="rule-form" loading={busy}>
              Kaydet
            </Button>
          </>
        }
      >
        <form id="rule-form" onSubmit={create} className="space-y-3">
          <Field label="Kural adı">
            <Input name="name" required maxLength={80} placeholder="ör. Yüksek tutar" />
          </Field>
          <Field label="Alt sınır (TRY)" hint="Bu tutar ve üzerindeki giderlere uygulanır">
            <Input name="minAmount" type="number" step="0.01" min="0" required />
          </Field>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-navy">Onaylayabilen roller</legend>
            <div className="space-y-1">
              {APPROVER_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="approverRoles" value={r} defaultChecked={r === 'OWNER'} /> {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}

