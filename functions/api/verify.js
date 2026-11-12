import { PAYMENT_PROVIDER } from '../_lib/catalog.js';
import { json, paystack, processPaidOrder } from '../_lib/util.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const ref = new URL(request.url).searchParams.get('reference') || '';
  if (!/^[A-Za-z0-9_.=-]{6,100}$/.test(ref)) return json({ status: 'invalid' }, 400);
  if ((env.PAYMENT_PROVIDER || PAYMENT_PROVIDER).toLowerCase() === 'payfast') {
    if (!env.ORDERS) return json({ status: 'error' }, 502);
    const paid = await env.ORDERS.get(`order:${ref}`, 'json');
    if (paid) return json({ status: 'success', reference: ref, amount: paid.amount, email: paid.email });
    const st = await env.ORDERS.get(`status:${ref}`);
    if (st) return json({ status: st === 'CANCELLED' ? 'abandoned' : 'failed', reference: ref });
    return json({ status: (await env.ORDERS.get(`pending:${ref}`)) ? 'pending' : 'invalid', reference: ref });
  }
  try {
    const tx = await paystack(env, `/transaction/verify/${encodeURIComponent(ref)}`);
    // Fallback in case the webhook is late or not configured; deduplicated when the ORDERS KV is bound.
    if (tx.status === 'success' && env.ORDERS) waitUntil(processPaidOrder(env, tx));
    return json({ status: tx.status, reference: tx.reference, amount: tx.amount, email: tx.customer?.email });
  } catch (e) {
    console.error(e.message);
    return json({ status: 'error' }, 502);
  }
}
