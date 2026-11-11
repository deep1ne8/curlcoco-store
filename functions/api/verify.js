import { json, paystack, processPaidOrder } from '../_lib/util.js';

export async function onRequestGet({ request, env, waitUntil }) {
  const ref = new URL(request.url).searchParams.get('reference') || '';
  if (!/^[A-Za-z0-9_.=-]{6,100}$/.test(ref)) return json({ status: 'invalid' }, 400);
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
