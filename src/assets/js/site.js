(() => {
  'use strict';
  const MAX_QTY = 5;
  const META_ID = '%%META_PIXEL_ID%%';
  const TIKTOK_ID = '%%TIKTOK_PIXEL_ID%%';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const fmt = n => 'R' + n.toLocaleString('en-ZA');

  /* ---------- consent + pixels (POPIA: nothing loads before opt-in) ---------- */
  const consent = () => store.get('cc_consent', null);
  function loadPixels() {
    if (consent() !== 'yes') return;
    if (META_ID && !window.fbq) {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', META_ID); fbq('track', 'PageView');
    }
    if (TIKTOK_ID && !window.ttq) {
      !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._u=i;var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load(TIKTOK_ID);ttq.page()}(window,document,'ttq');
    }
  }
  function track(evt, data) {
    if (consent() !== 'yes') return;
    if (window.fbq) fbq('track', evt, data);
    if (window.ttq) ttq.track(evt === 'Purchase' ? 'CompletePayment' : evt, data);
  }
  function initConsent() {
    const box = $('#consent');
    if (!box) return;
    if (!(META_ID || TIKTOK_ID)) { box.remove(); return; } // no pixels configured: nothing to consent to
    if (consent() === null) box.hidden = false;
    $$('[data-consent]', box).forEach(b => b.addEventListener('click', () => {
      store.set('cc_consent', b.dataset.consent); box.hidden = true; loadPixels();
    }));
    $$('[data-open-consent]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); box.hidden = false; }));
    loadPixels();
  }

  /* ---------- bag ---------- */
  const CATALOG = (() => { try { return JSON.parse($('#catalog').textContent); } catch { return {}; } })();
  const KEY = 'de_cart';
  const getBag = () => {
    const raw = store.get(KEY, {}), bag = {};
    for (const [sku, q] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      const n = Math.min(MAX_QTY, parseInt(q, 10) || 0);
      if (CATALOG[sku] && n > 0) bag[sku] = n;
    }
    return bag;
  };
  const setBag = bag => { store.set(KEY, bag); render(); };
  const setQty = (sku, q) => { const b = getBag(); if (q > 0) b[sku] = Math.min(MAX_QTY, q); else delete b[sku]; setBag(b); };
  const count = b => Object.values(b).reduce((t, q) => t + q, 0);
  const total = b => Object.entries(b).reduce((t, [s, q]) => t + CATALOG[s].price * q, 0);
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  function lineEl(sku, q) {
    const p = CATALOG[sku];
    const minus = el('button', { type: 'button', textContent: '\u2212', disabled: q <= 1 }); minus.setAttribute('aria-label', `One fewer ${p.name}`);
    const plus = el('button', { type: 'button', textContent: '+', disabled: q >= MAX_QTY }); plus.setAttribute('aria-label', `One more ${p.name}`);
    minus.addEventListener('click', () => setQty(sku, q - 1));
    plus.addEventListener('click', () => setQty(sku, q + 1));
    const rm = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
    rm.setAttribute('aria-label', `Remove ${p.name}`);
    rm.addEventListener('click', () => { setQty(sku, 0); $('.drawer-panel').focus(); });
    const img = el('img', { src: p.image, alt: '', width: 64, height: 64, loading: 'lazy' });
    return el('li', { className: 'line' }, [img,
      el('div', {}, [el('a', { className: 'line-name', href: p.url, textContent: p.name }),
        el('div', { className: 'line-meta' }, [el('span', { className: 'qty' }, [minus, el('output', { textContent: q }), plus]), rm])]),
      el('span', { className: 'line-price', textContent: fmt(p.price * q) })]);
  }
  function render() {
    const b = getBag(), n = count(b);
    $$('.bag-count').forEach(e => { e.textContent = n; });
    $$('.bag-btn').forEach(e => e.setAttribute('aria-label', `Bag, ${n} item${n === 1 ? '' : 's'}`));
    const lines = $('#cart-lines'); if (!lines) return;
    $('#cart-empty').hidden = n > 0;
    for (const id of ['#cart-lines', '#cart-totals', '#checkout-form']) $(id).hidden = n === 0;
    lines.replaceChildren(...Object.entries(b).map(([s, q]) => lineEl(s, q)));
    $('#cart-total').textContent = fmt(total(b));
  }

  /* ---------- drawer ---------- */
  let lastFocus = null;
  function openDrawer() {
    const d = $('#cart'); if (!d) return;
    lastFocus = document.activeElement;
    d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    $('.drawer-panel', d).focus();
  }
  function closeDrawer() {
    const d = $('#cart'); if (!d) return;
    d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  function initDrawer() {
    const d = $('#cart');
    if (!d) return;
    if (new URLSearchParams(location.search).get('cart') === '1') setTimeout(openDrawer, 0);
    $$('[data-add]').forEach(b => b.addEventListener('click', () => {
      const sku = b.dataset.add; if (!CATALOG[sku]) return;
      if (!getBag()[sku]) setQty(sku, 1);
      track('AddToCart', { content_ids: [sku], content_type: 'product', value: CATALOG[sku].price, currency: 'ZAR' });
      openDrawer();
    }));
    $$('[data-open-cart]').forEach(b => b.addEventListener('click', openDrawer));
    $$('[data-close-cart]').forEach(b => b.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', e => {
      if (!d.classList.contains('open')) return;
      if (e.key === 'Escape') closeDrawer();
      if (e.key === 'Tab') { // keep focus inside the drawer
        const f = $$('button,input,select,a[href],[tabindex="0"]', $('.drawer-panel', d)).filter(x => !x.closest('[hidden]') && !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
  }

  /* ---------- checkout ---------- */
  function initCheckout() {
    const form = $('#checkout-form'); if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#checkout-error'); err.textContent = '';
      if (!form.reportValidity()) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true; btn.textContent = 'Taking you to secure payment…';
      const data = Object.fromEntries(new FormData(form));
      data.marketing = form.marketing.checked; data.terms = form.terms.checked;
      const bag = getBag();
      data.items = Object.entries(bag).map(([sku, qty]) => ({ sku, qty }));
      track('InitiateCheckout', { value: total(bag), currency: 'ZAR', content_ids: Object.keys(bag) });
      try {
        const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json();
        if (!r.ok || !(j.url || j.form)) throw new Error(j.error || 'Checkout is unavailable right now.');
        if (j.form) { // PayFast: hosted page needs a form POST
          const f = document.createElement('form'); f.method = 'POST'; f.action = j.form.action;
          for (const [k, v] of j.form.fields) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
          document.body.appendChild(f); f.submit(); return;
        }
        window.location.assign(j.url);
      } catch (ex) {
        err.textContent = ex.message + ' Nothing was charged. Please try again or contact us.';
        btn.disabled = false; btn.textContent = 'Pay securely';
      }
    });
  }

  /* ---------- newsletter ---------- */
  function initSignup() {
    $$('form[data-signup]').forEach(form => form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('[role=status]', form);
      if (!form.reportValidity()) return;
      msg.textContent = 'Signing you up…';
      try {
        const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: form.email.value }) });
        msg.textContent = r.ok ? 'You’re in. Check your inbox for a welcome email.' : 'That didn’t work. Please try again later.';
        if (r.ok) form.reset();
      } catch { msg.textContent = 'That didn’t work. Please try again later.'; }
    }));
  }

  /* ---------- sticky buy (mobile) ---------- */
  function initSticky() {
    const bar = $('.sticky-buy'), anchor = $('#pd-add');
    if (!bar || !anchor || !('IntersectionObserver' in window)) return;
    document.body.classList.add('has-sticky');
    new IntersectionObserver(([en]) => bar.classList.toggle('show', !en.isIntersecting)).observe(anchor);
  }

  /* ---------- order confirmation ---------- */
  async function initConfirm() {
    const box = $('#confirm'); if (!box) return;
    const ref = new URLSearchParams(location.search).get('reference');
    const show = id => { $$('[data-state]', box).forEach(el => { el.hidden = el.dataset.state !== id; }); };
    if (!ref) { show('missing'); return; }
    try {
      let j;
      for (let i = 0; i < 10; i++) { // PayFast confirms in the background: wait for it briefly
        j = await (await fetch('/api/verify?reference=' + encodeURIComponent(ref))).json();
        if (j.status !== 'pending') break;
        await new Promise(r => setTimeout(r, 3000));
      }
      if (j.status === 'pending') { show('pending'); return; }
      if (j.status === 'success') {
        $('#order-ref').textContent = j.reference;
        $('#order-total').textContent = fmt(j.amount / 100);
        $('#order-email').textContent = j.email;
        show('success');
        setBag({});
        if (!store.get('cc_tracked_' + j.reference, false)) {
          track('Purchase', { value: j.amount / 100, currency: 'ZAR', content_type: 'product' });
          store.set('cc_tracked_' + j.reference, true);
        }
      } else show('failed');
    } catch { show('failed'); }
  }

  render(); initConsent(); initDrawer(); initCheckout(); initSignup(); initSticky(); initConfirm();
  window.addEventListener('storage', render);
})();
