import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { MOCKPOS_TEST_CARDS, MockPosProvider, MockSession } from './mockpos.provider';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#eef0f4;color:#1f2937}
.wrap{max-width:420px;margin:40px auto;padding:0 16px}.card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:#6d28d9;margin-bottom:16px}.badge{font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-weight:600}
.amount{font-size:28px;font-weight:700;margin:4px 0 2px}.muted{color:#6b7280;font-size:13px}label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px}.row{display:flex;gap:12px}.row>div{flex:1}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:#6d28d9;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fee2e2;color:#991b1b;padding:10px;border-radius:8px;font-size:13px;margin-top:12px}table{width:100%;font-size:12px;margin-top:16px;border-collapse:collapse}
td{padding:4px 0;border-top:1px solid #f3f4f6}code{font-size:12px}</style></head><body><div class="wrap">${body}
<p class="muted" style="text-align:center;margin-top:16px">MockPOS sandbox • Gerçek para çekilmez</p></div></body></html>`;
}

function header(s: MockSession) {
  return `<div class="brand">◆ MockPOS Güvenli Ödeme <span class="badge">SANDBOX</span></div>
<div class="muted">${esc(s.description)}</div><div class="amount">${esc(Number(s.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 }))} ${esc(s.currency)}</div>`;
}

/** Sağlayıcının barındırdığı ödeme sayfası (sandbox). */
@Public()
@SkipThrottle()
@Controller('mock-provider/pos')
export class MockPosController {
  constructor(private readonly pos: MockPosProvider) {}

  private send(res: Response, s: MockSession, html: string) {
    const callbackOrigin = new URL(s.callbackUrl).origin;
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}`);
    res.type('html').send(html);
  }

  @Get('checkout/:id')
  async checkout(@Param('id') id: string, @Res() res: Response) {
    const s = await this.pos.get(id);
    if (s.status === 'AWAITING_3DS') return this.send(res, s, this.threeDs(s));
    if (s.status !== 'PENDING') return res.redirect(303, s.callbackUrl);
    this.send(res, s, this.form(s));
  }

  @HttpCode(200)
  @Post('checkout/:id')
  async submit(@Param('id') id: string, @Body() body: Record<string, string>, @Res() res: Response) {
    const result = await this.pos.submitCard(id, body);
    const s = await this.pos.get(id);
    if (typeof result === 'object') return this.send(res, s, this.form(s, result.error));
    if (result === '3ds') return this.send(res, s, this.threeDs(s));
    res.redirect(303, s.callbackUrl);
  }

  @Post('checkout/:id/3ds')
  async threeDsSubmit(@Param('id') id: string, @Body('code') code: string, @Res() res: Response) {
    await this.pos.submit3ds(id, code ?? '');
    const s = await this.pos.get(id);
    res.redirect(303, s.callbackUrl);
  }

  private form(s: MockSession, error?: string) {
    const cards = MOCKPOS_TEST_CARDS.map((c) => `<tr><td><code>${c.number}</code></td><td>${esc(c.result)}</td></tr>`).join('');
    return page(
      'MockPOS Ödeme',
      `<div class="card">${header(s)}
<form method="post" action="/api/v1/mock-provider/pos/checkout/${s.id}" autocomplete="off">
<label>Kart üzerindeki isim</label><input name="holder" required maxlength="60">
<label>Kart numarası</label><input name="cardNumber" required inputmode="numeric" maxlength="23" placeholder="4111 1111 1111 1111">
<div class="row"><div><label>Son kullanma (AA/YY)</label><input name="expiry" required placeholder="12/29" maxlength="5"></div>
<div><label>CVC</label><input name="cvc" required inputmode="numeric" maxlength="4" placeholder="123"></div></div>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<button type="submit">Öde</button></form>
<table><tr><td colspan="2" class="muted"><b>Test kartları</b> (herhangi bir ileri tarih ve CVC)</td></tr>${cards}</table></div>`,
    );
  }

  private threeDs(s: MockSession) {
    return page(
      '3D Secure',
      `<div class="card">${header(s)}
<p>Bankanız •••• ${esc(s.cardLast4 ?? '')} kartı için doğrulama kodu gönderdi.</p>
<form method="post" action="/api/v1/mock-provider/pos/checkout/${s.id}/3ds">
<label>SMS doğrulama kodu</label><input name="code" required inputmode="numeric" maxlength="6" placeholder="123456">
<button type="submit">Doğrula</button></form><p class="muted">Sandbox kodu: 123456</p></div>`,
    );
  }
}
