import { CATALOG, PAYMENT_PROVIDER } from '../_lib/catalog.js';
import { json, paystack, brevo, EMAIL_RE } from '../_lib/util.js';
import { payfastConfig, payfastForm } from '../_lib/payfast.js';

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function onRequestPost({ request, env, waitUntil }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const c = {
    name: str(b.name, 80), email: str(b.email, 120).toLowerCase(), phone: str(b.phone, 20),
    street: str(b.street, 120), suburb: str(b.suburb, 80), city: str(b.city, 60), postal: str(b.postal, 4), province: str(b.province, 30),
  };
  const missing = Object.entries(c).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json({ error: `Please fill in: ${missing.join(', ')}.` }, 400);
  if (!EMAIL_RE.test(c.email)) return json({ error: 'Please check your email address.' }, 400);
  if (!/^(\+27|0)[0-9 ]{9,12}$/.test(c.phone)) return json({ error: 'Please enter a South African mobile number.' }, 400);
  if (!/^[0-9]{4}$/.test(c.postal)) return json({ error: 'Postal code must be 4 digits.' }, 400);
  if (!PROVINCES.includes(c.province)) return json({ error: 'Please choose a province.' }, 400);
  if (b.terms !== true) return json({ error: 'Please accept the Terms.' }, 400);

  // Price is computed here from the catalogue: whatever the browser sends is ignored.
  const items = (Array.isArray(b.items) ? b.items : [])
    .filter(i => CATALOG[i?.sku])
    .map(i => ({ sku: i.sku, qty: Math.max(1, Math.min(5, parseInt(i.qty, 10) || 0)) }));
  if (!items.length) return json({ error: 'Your cart is empty.' }, 400);
  const amount = items.reduce((t, i) => t + CATALOG[i.sku].priceCents * i.qty, 0);

  const origin = new URL(request.url).origin;
  const provider = (env.PAYMENT_PROVIDER || PAYMENT_PROVIDER).toLowerCase();
  try {
    let out;
    if (provider === 'payfast') {
      if (!env.ORDERS) throw new Error('ORDERS KV binding is required for PayFast');
      const cfg = payfastConfig(env);
      const ref = 'cc' + Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
      // PayFast only echoes a few fields back, so the full order waits in KV until the ITN confirms payment.
      await env.ORDERS.put(`pending:${ref}`, JSON.stringify({ reference: ref, amount, customer: c, items, marketing: b.marketing === true }), { expirationTtl: 60 * 60 * 24 * 7 });
      const [first, ...rest] = c.name.split(/\s+/);
      const cell = c.phone.replace(/\s+/g, '').replace(/^\+27/, '0');
      const form = await payfastForm(cfg, {
        merchant_id: cfg.id, merchant_key: cfg.key,
        return_url: `${origin}/order-confirmed?reference=${ref}`, cancel_url: `${origin}/?cart=1`, notify_url: `${origin}/api/payfast-itn`,
        name_first: first, name_last: rest.join(' '), email_address: c.email, cell_number: /^0[0-9]{9}$/.test(cell) ? cell : '',
        m_payment_id: ref, amount: (amount / 100).toFixed(2),
        item_name: items.map(i => `${i.qty} x ${CATALOG[i.sku].name}`).join(', ').slice(0, 100),
      });
      out = { form, reference: ref };
    } else {
      const tx = await paystack(env, '/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify({
          email: c.email, amount, currency: 'ZAR', callback_url: `${origin}/order-confirmed`,
          metadata: {
            customer: c, items, marketing: b.marketing === true,
            custom_fields: [
              { display_name: 'Ship to', variable_name: 'ship_to', value: `${c.name}, ${c.street}, ${c.suburb}, ${c.city} ${c.postal}, ${c.province}` },
              { display_name: 'Phone', variable_name: 'phone', value: c.phone },
              { display_name: 'Items', variable_name: 'items', value: items.map(i => `${i.qty}x ${i.sku}`).join(', ') },
            ],
          },
        }),
      });
      out = { url: tx.authorization_url, reference: tx.reference };
    }
    // Abandoned-cart reminders only for people who opted in (POPIA).
    if (b.marketing === true && env.BREVO_LIST_CHECKOUT)
      waitUntil(brevo(env, '/contacts', { email: c.email, listIds: [Number(env.BREVO_LIST_CHECKOUT)], updateEnabled: true, attributes: { FIRSTNAME: c.name.split(' ')[0] } }));
    return json(out);
  } catch (e) {
    console.error(e.message);
    return json({ error: 'Payment could not be started.' }, 502);
  }
}
