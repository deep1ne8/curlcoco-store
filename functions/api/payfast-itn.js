import { payfastConfig, verifyItn } from '../_lib/payfast.js';
import { processPaidOrder } from '../_lib/util.js';

// PayFast Instant Transaction Notification. Always answer 200 quickly once handled,
// otherwise PayFast retries.
export async function onRequestPost({ request, env }) {
  let cfg; try { cfg = payfastConfig(env); } catch { return new Response('not configured', { status: 503 }); }
  const raw = await request.text();
  let d;
  try { d = await verifyItn(cfg, raw); } catch (e) { console.error(e.message); return new Response('invalid', { status: 400 }); }

  const pending = env.ORDERS && await env.ORDERS.get(`pending:${d.m_payment_id}`, 'json');
  if (!pending) { console.error('ITN for unknown order', d.m_payment_id); return new Response('ok'); }
  // The amount paid must equal what our server priced, to the cent.
  if (Math.round(parseFloat(d.amount_gross) * 100) !== pending.amount) { console.error('ITN amount mismatch', d.m_payment_id); return new Response('ok'); }

  if (d.payment_status === 'COMPLETE') {
    await processPaidOrder(env, {
      status: 'success', currency: 'ZAR', reference: pending.reference, amount: pending.amount, channel: `PayFast (${d.pf_payment_id})`,
      customer: { email: pending.customer.email }, metadata: { customer: pending.customer, items: pending.items, marketing: pending.marketing },
    });
  } else {
    await env.ORDERS.put(`status:${pending.reference}`, d.payment_status, { expirationTtl: 60 * 60 * 24 * 30 });
  }
  return new Response('ok');
}
