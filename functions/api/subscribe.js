import { json, brevo, EMAIL_RE } from '../_lib/util.js';

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ ok: false }, 400); }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Invalid email.' }, 400);
  if (!env.BREVO_API_KEY || !env.BREVO_LIST_NEWSLETTER) return json({ ok: false, error: 'Sign-up is not configured yet.' }, 503);
  const ok = await brevo(env, '/contacts', { email, listIds: [Number(env.BREVO_LIST_NEWSLETTER)], updateEnabled: true });
  return json({ ok: !!ok }, ok ? 200 : 502);
}
