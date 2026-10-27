import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { MOCKBANK_ACCOUNTS, MockBankProvider } from './mockbank.provider';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Dönüş adresi yalnızca Tahsilo web uygulaması olabilir (açık yönlendirme engeli). */
function safeRedirect(uri: string) {
  const web = new URL(process.env.WEB_URL ?? 'http://localhost:3000');
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    throw new BadRequestException('Geçersiz dönüş adresi');
  }
  if (u.origin !== web.origin) throw new BadRequestException('Dönüş adresine izin verilmiyor');
  return u;
}

/** "Örnek Bankası" açık bankacılık izin ekranı (sandbox). */
@Public()
@SkipThrottle()
@Controller('mock-provider/bank')
export class MockBankController {
  constructor(private readonly bank: MockBankProvider) {}

  @Get('authorize')
  authorize(@Query('state') state: string, @Query('redirect_uri') redirectUri: string, @Res() res: Response) {
    const target = safeRedirect(redirectUri);
    const accounts = MOCKBANK_ACCOUNTS.map(
      (a) => `<label class="acc"><input type="checkbox" name="accounts" value="${a.externalId}" checked>
<span><b>${esc(a.name)}</b><br><small>${esc(a.iban ?? '')} • ${a.currency}</small></span></label>`,
    ).join('');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${target.origin}`);
    res.type('html').send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Örnek Bankası — Erişim izni</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f0f4f8;color:#1f2937}
.wrap{max-width:460px;margin:40px auto;padding:0 16px}.card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.brand{font-weight:800;color:#b91c1c;font-size:18px;margin-bottom:4px}.badge{font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-weight:600;margin-left:6px}
h1{font-size:17px;margin:16px 0 8px}ul{padding-left:18px;font-size:14px;color:#374151}.acc{display:flex;gap:10px;align-items:flex-start;border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-top:8px;font-size:14px}
small{color:#6b7280}.row{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:12px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;border:0}
.ok{background:#b91c1c;color:#fff}.no{background:#fff;border:1px solid #d1d5db;color:#374151}.muted{color:#6b7280;font-size:12px;text-align:center;margin-top:14px}</style></head>
<body><div class="wrap"><div class="card"><div class="brand">Örnek Bankası<span class="badge">SANDBOX</span></div>
<h1>Tahsilo hesap bilgilerinize erişmek istiyor</h1>
<ul><li>Hesap listesi ve bakiyeler</li><li>Hesap hareketleri (son 90 gün ve sonrası)</li><li>Süre: 90 gün • Yalnızca okuma — para transferi yapılamaz</li></ul>
<form method="post" action="/api/v1/mock-provider/bank/authorize">
<input type="hidden" name="state" value="${esc(state ?? '')}"><input type="hidden" name="redirect_uri" value="${esc(target.toString())}">
<div style="margin-top:12px;font-size:13px;font-weight:600">Paylaşılacak hesaplar</div>${accounts}
<div class="row"><button class="no" name="decision" value="deny">Reddet</button><button class="ok" name="decision" value="allow">İzin ver</button></div></form>
<p class="muted">Bu bir test bankasıdır; gerçek hesap bilgisi kullanılmaz.</p></div></div></body></html>`);
  }

  @Post('authorize')
  async decide(@Body() body: { state?: string; redirect_uri?: string; decision?: string; accounts?: string | string[] }, @Res() res: Response) {
    const target = safeRedirect(body.redirect_uri ?? '');
    target.searchParams.set('state', body.state ?? '');
    const accounts = Array.isArray(body.accounts) ? body.accounts : body.accounts ? [body.accounts] : [];
    if (body.decision !== 'allow' || !accounts.length) {
      target.searchParams.set('error', 'access_denied');
    } else {
      target.searchParams.set('code', await this.bank.issueCode(accounts));
    }
    res.redirect(303, target.toString());
  }
}
