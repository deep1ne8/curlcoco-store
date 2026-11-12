// PayFast flow with mocked network. Node's WebCrypto lacks MD5 (Workers has it), so polyfill it here.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const realDigest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = async (alg, data) => (String(alg?.name ?? alg).toUpperCase() === 'MD5'
  ? new Uint8Array(createHash('md5').update(Buffer.from(data)).digest()).buffer : realDigest(alg, data));

const { onRequestPost: checkout } = await import('../functions/api/checkout.js');
const { onRequestPost: itn } = await import('../functions/api/payfast-itn.js');
const { onRequestGet: verify } = await import('../functions/api/verify.js');
const { pfEncode, pfSignature } = await import('../functions/_lib/payfast.js');

const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k) ?? null; return v && t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); } }; };
const env = () => ({ PAYMENT_PROVIDER: 'payfast', PAYFAST_SANDBOX: 'true', ORDERS: kv(), BREVO_API_KEY: 'b', BREVO_SENDER_EMAIL: 's@x.co', OWNER_EMAIL: 'o@x.co' });
const ctx = (request, e) => ({ request, env: e, waitUntil: p => p });
const good = { name: 'Thandi M Nkosi', email: 'buyer@example.com', phone: '+27 82 123 4567', street: '1 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postal: '8005', province: 'Western Cape', terms: true, items: [{ sku: 'curl-set', qty: 2 }] };
const post = (path, body, type = 'application/json') => new Request(`https://shop.test${path}`, { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const md5 = s => createHash('md5').update(s).digest('hex');
let calls, validateAnswer;
beforeEach(() => {
  calls = []; validateAnswer = 'VALID';
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), body: init.body }); return String(url).includes('/eng/query/validate') ? new Response(validateAnswer) : new Response('{}', { status: 201 }); };
});

test('pfEncode matches PHP urlencode (spaces as +, uppercase hex)', () => {
  assert.equal(pfEncode(" a b/c@d.co!*'()~ "), 'a+b%2Fc%40d.co%21%2A%27%28%29%7E');
});

test('signature: documented field order, empty fields skipped, passphrase appended', async () => {
  const sig = await pfSignature([['merchant_id', '10000100'], ['merchant_key', '46f0cd694581a'], ['name_last', ''], ['amount', '100.00'], ['item_name', 'Test Item']], 'jt7NOE43FZPn');
  assert.equal(sig, md5('merchant_id=10000100&merchant_key=46f0cd694581a&amount=100.00&item_name=Test+Item&passphrase=jt7NOE43FZPn'));
});

test('checkout returns a signed sandbox form, server-priced, and stores the pending order', async () => {
  const e = env();
  const j = await (await checkout(ctx(post('/api/checkout', { ...good, items: [{ sku: 'curl-set', qty: 2, price: 1 }] }), e))).json();
  assert.equal(j.form.action, 'https://sandbox.payfast.co.za/eng/process');
  const f = Object.fromEntries(j.form.fields);
  assert.equal(f.amount, '498.00');
  assert.equal(f.merchant_id, '10000100');
  assert.equal(f.cell_number, '0821234567');
  assert.equal(f.name_first, 'Thandi'); assert.equal(f.name_last, 'M Nkosi');
  assert.equal(f.notify_url, 'https://shop.test/api/payfast-itn');
  const unsigned = j.form.fields.filter(([k]) => k !== 'signature');
  assert.equal(f.signature, await pfSignature(unsigned, 'jt7NOE43FZPn'));
  assert.equal(JSON.parse(e.ORDERS.m.get(`pending:${j.reference}`)).amount, 49800);
});

async function itnBody(e, ref, over = {}) {
  const pairs = [['m_payment_id', ref], ['pf_payment_id', '1234567'], ['payment_status', 'COMPLETE'], ['item_name', '2 x Heatless Curling Set'],
    ['amount_gross', '498.00'], ['amount_fee', '-11.47'], ['amount_net', '486.53'], ['name_first', 'Thandi'], ['email_address', 'buyer@example.com'], ['merchant_id', '10000100'],
    ...Object.entries(over)].reduce((a, [k, v]) => { const i = a.findIndex(([x]) => x === k); i >= 0 ? (a[i] = [k, v]) : a.push([k, v]); return a; }, []);
  const sig = await pfSignature(pairs, 'jt7NOE43FZPn');
  return [...pairs, ['signature', sig]].map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
}
const startOrder = async e => (await (await checkout(ctx(post('/api/checkout', good), e))).json()).reference;

test('ITN: valid + confirmed + right amount → order processed once, verify says success', async () => {
  const e = env(); const ref = await startOrder(e); calls = [];
  const body = await itnBody(e, ref);
  assert.equal((await itn(ctx(post('/api/payfast-itn', body, 'application/x-www-form-urlencoded'), e))).status, 200);
  assert.ok(calls.some(c => c.url === 'https://sandbox.payfast.co.za/eng/query/validate'), 'server confirmation called');
  const mails = calls.filter(c => c.url.endsWith('/smtp/email')).map(c => JSON.parse(c.body));
  assert.deepEqual(mails.map(m => m.to[0].email).sort(), ['buyer@example.com', 'o@x.co']);
  assert.match(mails.find(m => m.to[0].email === 'o@x.co').htmlContent, /Sea Point/);
  calls = [];
  await itn(ctx(post('/api/payfast-itn', body, 'application/x-www-form-urlencoded'), e));
  assert.equal(calls.filter(c => c.url.endsWith('/smtp/email')).length, 0, 'retries do not re-send');
  const v = await (await verify(ctx(new Request(`https://shop.test/api/verify?reference=${ref}`), e))).json();
  assert.deepEqual(v, { status: 'success', reference: ref, amount: 49800, email: 'buyer@example.com' });
});

test('ITN: tampered signature, wrong amount, or PayFast says INVALID → nothing processed', async () => {
  const e = env(); const ref = await startOrder(e);
  const bad = (await itnBody(e, ref)).replace(/signature=[0-9a-f]+/, 'signature=deadbeef');
  assert.equal((await itn(ctx(post('/api/payfast-itn', bad, 'application/x-www-form-urlencoded'), e))).status, 400);
  calls = [];
  await itn(ctx(post('/api/payfast-itn', await itnBody(e, ref, { amount_gross: '1.00' }), 'application/x-www-form-urlencoded'), e));
  assert.equal(calls.filter(c => c.url.endsWith('/smtp/email')).length, 0, 'amount mismatch ignored');
  validateAnswer = 'INVALID';
  assert.equal((await itn(ctx(post('/api/payfast-itn', await itnBody(e, ref), 'application/x-www-form-urlencoded'), e))).status, 400);
  const v = await (await verify(ctx(new Request(`https://shop.test/api/verify?reference=${ref}`), e))).json();
  assert.equal(v.status, 'pending');
});

test('ITN: cancelled payment → verify reports abandoned', async () => {
  const e = env(); const ref = await startOrder(e);
  await itn(ctx(post('/api/payfast-itn', await itnBody(e, ref, { payment_status: 'CANCELLED' }), 'application/x-www-form-urlencoded'), e));
  assert.equal((await (await verify(ctx(new Request(`https://shop.test/api/verify?reference=${ref}`), e))).json()).status, 'abandoned');
});
