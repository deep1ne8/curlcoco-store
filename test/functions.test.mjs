// Run: node --test test/   (mocks Paystack + Brevo; no network)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestGet as verify } from '../functions/api/verify.js';
import { onRequestPost as webhook } from '../functions/api/paystack-webhook.js';
import { onRequestPost as subscribe } from '../functions/api/subscribe.js';

let calls;
const kv = () => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const env = () => ({ PAYSTACK_SECRET_KEY: 'sk_test_x', BREVO_API_KEY: 'b', BREVO_SENDER_EMAIL: 's@x.co', OWNER_EMAIL: 'o@x.co', BREVO_LIST_NEWSLETTER: '2', BREVO_LIST_CHECKOUT: '3', BREVO_LIST_CUSTOMERS: '4', ORDERS: kv() });
const ctx = (request, e = env()) => ({ request, env: e, waitUntil: p => p });
const tx = { status: 'success', currency: 'ZAR', reference: 'ref_123456', amount: 49800, channel: 'card', customer: { email: 'buyer@example.com' },
  metadata: { customer: { name: 'Thandi M', street: '1 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postal: '8005', province: 'Western Cape', phone: '0821234567' }, items: [{ sku: 'curl-set', qty: 2 }], marketing: true } };

beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('/transaction/initialize')) return Response.json({ status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'ref_123456' } });
    if (String(url).includes('/transaction/verify/')) return Response.json({ status: true, data: tx });
    if (String(url).includes('api.brevo.com')) return new Response('{}', { status: 201 });
    return new Response('not mocked', { status: 500 });
  };
});

const good = { name: 'Thandi M', email: 'Buyer@Example.com', phone: '082 123 4567', street: '1 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postal: '8005', province: 'Western Cape', terms: true, marketing: false, items: [{ sku: 'curl-set', qty: 2, price: 1 }] };
const post = (path, body, headers = {}) => new Request(`https://shop.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('checkout: server sets the price, ignoring any price from the browser', async () => {
  const r = await checkout(ctx(post('/api/checkout', good)));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, 'https://checkout.paystack.com/abc');
  const init = calls.find(c => c.url.includes('initialize')).body;
  assert.equal(init.amount, 49800); // 2 × R249 in cents
  assert.equal(init.currency, 'ZAR');
  assert.equal(init.email, 'buyer@example.com');
  assert.equal(init.callback_url, 'https://shop.test/order-confirmed');
  assert.equal(calls.filter(c => c.url.includes('brevo')).length, 0, 'no marketing list without opt-in');
});

test('checkout: quantity is clamped to 5 and unknown SKUs are dropped', async () => {
  await checkout(ctx(post('/api/checkout', { ...good, items: [{ sku: 'curl-set', qty: 99 }, { sku: 'free-iphone', qty: 1 }] })));
  assert.equal(calls.find(c => c.url.includes('initialize')).body.amount, 5 * 24900);
});

test('checkout: rejects bad input and missing terms', async () => {
  for (const bad of [{ ...good, email: 'nope' }, { ...good, postal: '12' }, { ...good, province: 'Narnia' }, { ...good, terms: false }, { ...good, items: [] }, { ...good, phone: '123' }]) {
    const r = await checkout(ctx(post('/api/checkout', bad)));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
  assert.equal((await checkout(ctx(post('/api/checkout', '{not json')))).status, 400);
});

test('checkout: opted-in shoppers go on the abandoned-cart list', async () => {
  await checkout(ctx(post('/api/checkout', { ...good, marketing: true })));
  const add = calls.find(c => c.url.endsWith('/v3/contacts'));
  assert.deepEqual(add.body.listIds, [3]);
});

test('webhook: rejects a bad signature', async () => {
  const r = await webhook(ctx(post('/api/paystack-webhook', { event: 'charge.success', data: { reference: 'ref_123456' } }, { 'x-paystack-signature': 'deadbeef' })));
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test('webhook: a valid signature re-verifies, emails owner + customer once, and ignores duplicates', async () => {
  const e = env();
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_123456' } });
  const sig = createHmac('sha512', e.PAYSTACK_SECRET_KEY).update(body).digest('hex');
  assert.equal((await webhook(ctx(post('/api/paystack-webhook', body, { 'x-paystack-signature': sig }), e))).status, 200);
  const mails = calls.filter(c => c.url.endsWith('/smtp/email'));
  assert.deepEqual(mails.map(m => m.body.to[0].email).sort(), ['buyer@example.com', 'o@x.co']);
  assert.match(mails.find(m => m.body.to[0].email === 'o@x.co').body.htmlContent, /Sea Point/);
  assert.ok(calls.some(c => c.url.includes('/lists/3/contacts/remove')), 'removed from abandoned list');
  calls = [];
  await webhook(ctx(post('/api/paystack-webhook', body, { 'x-paystack-signature': sig }), e));
  assert.equal(calls.filter(c => c.url.endsWith('/smtp/email')).length, 0, 'no duplicate emails');
});

test('emails escape customer-supplied HTML', async () => {
  const e = env();
  const evil = structuredClone(tx); evil.metadata.customer.name = '<img src=x onerror=alert(1)>';
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null }); return String(url).includes('verify') ? Response.json({ status: true, data: evil }) : new Response('{}', { status: 201 }); };
  const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_123456' } });
  await webhook(ctx(post('/api/paystack-webhook', body, { 'x-paystack-signature': createHmac('sha512', e.PAYSTACK_SECRET_KEY).update(body).digest('hex') }), e));
  for (const m of calls.filter(c => c.url.endsWith('/smtp/email'))) assert.doesNotMatch(m.body.htmlContent, /<img/);
});

test('verify: returns only safe fields and rejects bad references', async () => {
  const j = await (await verify(ctx(new Request('https://shop.test/api/verify?reference=ref_123456')))).json();
  assert.deepEqual(j, { status: 'success', reference: 'ref_123456', amount: 49800, email: 'buyer@example.com' });
  assert.equal((await verify(ctx(new Request('https://shop.test/api/verify?reference=../../x')))).status, 400);
});

test('subscribe: validates email and adds to the newsletter list', async () => {
  assert.equal((await subscribe(ctx(post('/api/subscribe', { email: 'bad' })))).status, 400);
  assert.equal((await subscribe(ctx(post('/api/subscribe', { email: 'a@b.co' })))).status, 200);
  assert.deepEqual(calls.at(-1).body.listIds, [2]);
});
