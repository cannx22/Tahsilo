'use client';

import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/badges';
import { Button, Card, Field, Input, Notice, PageHeader, formValues, useAction } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { ROLE_LABEL, useSession } from '@/lib/session';

export default function AccountPage() {
  const { me } = useSession();
  const status = useApi<{ mfaEnabled: boolean; emailNotifications: boolean }>('/auth/me');
  const mfaEnabled = status.data?.mfaEnabled ?? false;
  const emailOn = status.data?.emailNotifications ?? me.emailNotifications;
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const { run, busy } = useAction();

  return (
    <>
      <PageHeader title="Hesabım" description={`${me.name} • ${me.email} • ${ROLE_LABEL[me.role]}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Bildirimler" className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-navy">E-posta bildirimleri</div>
              <p className="text-sm text-muted">
                Onay bekleyen giderler, yaklaşan ödemeler, bütçe ve bağlantı uyarıları {me.email} adresine de gönderilir. Uygulama içi bildirimler her zaman açıktır.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emailOn}
                disabled={busy || !status.data}
                onChange={(ev) =>
                  run(() => api('/auth/preferences', { method: 'PATCH', body: { emailNotifications: ev.target.checked } }), 'Bildirim tercihi kaydedildi').then(() => status.reload())
                }
              />
              {emailOn ? 'Açık' : 'Kapalı'}
            </label>
          </div>
        </Card>
        <Card title="İki adımlı doğrulama (MFA)" actions={mfaEnabled ? <Badge tone="success" icon={ShieldCheck}>Açık</Badge> : <Badge tone="warning">Kapalı</Badge>}>
          {!mfaEnabled && !setup && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Finansal verilere erişen hesaplar için önerilir. Google Authenticator, Microsoft Authenticator gibi bir uygulama kullanabilirsiniz.
              </p>
              <Button loading={busy} onClick={() => run(async () => setSetup(await api('/auth/mfa/setup', { method: 'POST' })))}>
                Kurulumu başlat
              </Button>
            </div>
          )}
          {!mfaEnabled && setup && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run(() => api('/auth/mfa/enable', { body: formValues(e.currentTarget) }), 'İki adımlı doğrulama açıldı');
                if (ok) {
                  setSetup(null);
                  status.reload();
                }
              }}
            >
              <Notice>
                Uygulamanızda “anahtar gir” seçeneğiyle aşağıdaki gizli anahtarı ekleyin. Bu anahtar yalnızca bir kez gösterilir.
              </Notice>
              <div className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm tracking-wider text-navy">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
              <a href={setup.otpauthUrl} className="block text-xs text-brand">
                Mobil cihazdaysanız doğrudan uygulamada aç
              </a>
              <Field label="Uygulamadaki 6 haneli kod">
                <Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
              </Field>
              <Button type="submit" loading={busy}>
                Doğrula ve aç
              </Button>
            </form>
          )}
          {mfaEnabled && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const ok = await run(() => api('/auth/mfa/disable', { body: formValues(form) }), 'İki adımlı doğrulama kapatıldı');
                if (ok) status.reload();
              }}
            >
              <p className="text-sm text-muted">Girişte parolanızın yanında doğrulama kodu istenir. Kapatmak için parolanızı ve güncel kodu girin.</p>
              <Field label="Parola">
                <Input name="password" type="password" required autoComplete="current-password" />
              </Field>
              <Field label="Doğrulama kodu">
                <Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" />
              </Field>
              <Button type="submit" variant="danger" loading={busy}>
                Kapat
              </Button>
            </form>
          )}
        </Card>

        <Card title="Parola değiştir">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const v = formValues(form);
              if (v.newPassword !== v.confirm) {
                await run(async () => {
                  throw new Error('Yeni parolalar eşleşmiyor');
                });
                return;
              }
              const ok = await run(() => api('/auth/password', { body: { currentPassword: v.currentPassword, newPassword: v.newPassword } }), 'Parola güncellendi');
              if (ok) form.reset();
            }}
          >
            <Field label="Mevcut parola">
              <Input name="currentPassword" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="Yeni parola" hint="En az 10 karakter">
              <Input name="newPassword" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <Field label="Yeni parola (tekrar)">
              <Input name="confirm" type="password" required minLength={10} autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={busy}>
              Güncelle
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
