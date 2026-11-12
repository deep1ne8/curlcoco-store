// PayFast (Network) hosted-checkout integration. Sandbox needs no account: the public
// test merchant below is used when PAYFAST_SANDBOX=true and no own credentials are set.
const SANDBOX = { id: '10000100', key: '46f0cd694581a', passphrase: 'jt7NOE43FZPn' };

export function payfastConfig(env) {
  const sandbox = String(env.PAYFAST_SANDBOX).toLowerCase() === 'true';
  const id = env.PAYFAST_MERCHANT_ID || (sandbox ? SANDBOX.id : '');
  const key = env.PAYFAST_MERCHANT_KEY || (sandbox ? SANDBOX.key : '');
  const passphrase = env.PAYFAST_PASSPHRASE ?? (sandbox && !env.PAYFAST_MERCHANT_ID ? SANDBOX.passphrase : '');
  if (!id || !key) throw new Error('PayFast is not configured (set PAYFAST_MERCHANT_ID/KEY or PAYFAST_SANDBOX=true)');
  const host = sandbox ? 'https://sandbox.payfast.co.za' : 'https://www.payfast.co.za';
  return { id, key, passphrase, sandbox, processUrl: `${host}/eng/process`, validateUrl: `${host}/eng/query/validate` };
}

// PHP urlencode() semantics, which PayFast's signature uses: spaces as "+", uppercase hex.
export const pfEncode = v => encodeURIComponent(String(v).trim())
  .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%20/g, '+');

const md5 = async s => [...new Uint8Array(await crypto.subtle.digest('MD5', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

/** pairs: [key, value][] in PayFast's documented field order. Empty values are skipped. */
export async function pfSignature(pairs, passphrase) {
  let s = pairs.filter(([k, v]) => k !== 'signature' && v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  if (passphrase) s += `&passphrase=${pfEncode(passphrase)}`;
  return md5(s);
}

// Checkout field order, as documented by PayFast for the custom integration.
const ORDER = ['merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url', 'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description'];

export async function payfastForm(cfg, f) {
  const pairs = ORDER.map(k => [k, f[k]]).filter(([, v]) => v !== undefined && v !== '');
  const signature = await pfSignature(pairs, cfg.passphrase);
  return { action: cfg.processUrl, fields: [...pairs, ['signature', signature]] };
}

/** Verifies an ITN body (raw application/x-www-form-urlencoded string). Returns the fields or throws. */
export async function verifyItn(cfg, raw, fetchImpl = fetch) {
  const pairs = raw.split('&').filter(Boolean).map(p => {
    const i = p.indexOf('=');
    const dec = s => decodeURIComponent(s.replace(/\+/g, ' '));
    return [dec(i < 0 ? p : p.slice(0, i)), dec(i < 0 ? '' : p.slice(i + 1))];
  });
  const data = Object.fromEntries(pairs);
  const expected = await pfSignature(pairs.filter(([k]) => k !== 'signature'), cfg.passphrase);
  if (!data.signature || data.signature !== expected) throw new Error('ITN signature mismatch');
  if (data.merchant_id !== cfg.id) throw new Error('ITN merchant mismatch');
  // Server confirmation: PayFast must answer VALID for the exact data it sent.
  const body = pairs.filter(([k]) => k !== 'signature').map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  const r = await fetchImpl(cfg.validateUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if ((await r.text()).trim() !== 'VALID') throw new Error('ITN not confirmed by PayFast');
  return data;
}
