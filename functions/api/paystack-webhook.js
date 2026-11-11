import { paystack, processPaidOrder } from '../_lib/util.js';

async function hmacSha512Hex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const safeEqual = (a, b) => a.length === b.length && [...a].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const sig = request.headers.get('x-paystack-signature') || '';
  if (!env.PAYSTACK_SECRET_KEY || !safeEqual(await hmacSha512Hex(env.PAYSTACK_SECRET_KEY, raw), sig)) return new Response('bad signature', { status: 401 });
  let evt; try { evt = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  if (evt.event === 'charge.success' && evt.data?.reference) {
    // Never trust the payload alone: re-check with Paystack before acting.
    const tx = await paystack(env, `/transaction/verify/${encodeURIComponent(evt.data.reference)}`);
    await processPaidOrder(env, tx);
  }
  return new Response('ok');
}
