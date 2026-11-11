import { CATALOG, BRAND, DELIVERY_ESTIMATE } from './catalog.js';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rand = cents => `R${(cents / 100).toFixed(2)}`;
export const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;

export async function paystack(env, path, init = {}) {
  if (!env.PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is not set');
  const r = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new Error(`Paystack ${path}: ${j.message || r.status}`);
  return j.data;
}

export async function brevo(env, path, body, method = 'POST') {
  if (!env.BREVO_API_KEY) return null; // email is optional in development
  const r = await fetch(`https://api.brevo.com/v3${path}`, {
    method, headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 204) console.error(`Brevo ${path} ${r.status}: ${await r.text()}`);
  return r.ok;
}

const sendMail = (env, to, subject, html) => brevo(env, '/smtp/email', {
  sender: { name: BRAND, email: env.BREVO_SENDER_EMAIL }, to: [{ email: to }], subject, htmlContent: html,
});

const wrap = inner => `<div style="font-family:Arial,sans-serif;color:#3B2A20;max-width:560px;line-height:1.5">${inner}<p style="color:#6E5A4E;font-size:13px">${esc(BRAND)}</p></div>`;

/** Runs once per paid order (deduplicated with the ORDERS KV binding when available). */
export async function processPaidOrder(env, tx) {
  if (tx.status !== 'success' || tx.currency !== 'ZAR') return false;
  const ref = tx.reference;
  if (env.ORDERS) {
    if (await env.ORDERS.get(`order:${ref}`)) return false;
    await env.ORDERS.put(`order:${ref}`, JSON.stringify({ at: new Date().toISOString(), amount: tx.amount, email: tx.customer?.email, meta: tx.metadata }));
  }
  const m = tx.metadata || {};
  const c = m.customer || {};
  const items = (m.items || []).map(i => `${i.qty} × ${esc(CATALOG[i.sku]?.name || i.sku)}`).join('<br>');
  const email = tx.customer?.email || c.email;

  await sendMail(env, env.OWNER_EMAIL, `🛒 New order ${ref} — ${rand(tx.amount)}`, wrap(`
    <h2>New paid order</h2>
    <p><b>Reference:</b> ${esc(ref)}<br><b>Paid:</b> ${rand(tx.amount)} via ${esc(tx.channel)}<br><b>Items:</b><br>${items}</p>
    <p><b>Ship to</b><br>${esc(c.name)}<br>${esc(c.street)}<br>${esc(c.suburb)}<br>${esc(c.city)} ${esc(c.postal)}<br>${esc(c.province)}<br>${esc(c.phone)}<br>${esc(email)}</p>
    <ol><li>Place the order with the supplier using this address.</li><li>Reply to the customer with the tracking number when you get it.</li><li>Log the order in the KPI tracker.</li></ol>`));

  if (email) await sendMail(env, email, `Your ${BRAND} order ${ref} is confirmed`, wrap(`
    <h2>Thanks, ${esc((c.name || '').split(' ')[0])}! Your order is confirmed.</h2>
    <p><b>Order:</b> ${esc(ref)}<br><b>Total paid:</b> ${rand(tx.amount)}<br>${items}</p>
    <p><b>Delivering to:</b> ${esc(c.street)}, ${esc(c.suburb)}, ${esc(c.city)} ${esc(c.postal)}</p>
    <p><b>What happens next:</b> we place your order with our supplier within one working day and email your tracking number as soon as it ships. Estimated delivery: ${esc(DELIVERY_ESTIMATE)}.</p>
    <p>You can cancel within 7 days of delivery. Just reply to this email.</p>`));

  if (email && env.BREVO_LIST_CHECKOUT) await brevo(env, `/contacts/lists/${env.BREVO_LIST_CHECKOUT}/contacts/remove`, { emails: [email] });
  if (email && m.marketing && env.BREVO_LIST_CUSTOMERS)
    await brevo(env, '/contacts', { email, listIds: [Number(env.BREVO_LIST_CUSTOMERS)], updateEnabled: true, attributes: { FIRSTNAME: (c.name || '').split(' ')[0] } });
  return true;
}
