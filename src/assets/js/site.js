(() => {
  'use strict';
  const PRICE = %%PRICE_ZAR%%;
  const SKU = 'curl-set';
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

  /* ---------- cart ---------- */
  const getQty = () => Math.max(0, Math.min(MAX_QTY, parseInt(store.get('cc_cart', { qty: 0 }).qty, 10) || 0));
  const setQty = q => { store.set('cc_cart', { qty: Math.max(0, Math.min(MAX_QTY, q)) }); render(); };
  function render() {
    const q = getQty();
    $$('.cart-count').forEach(el => { el.textContent = q; });
    const cartBtn = $('.cart-btn');
    if (cartBtn) cartBtn.setAttribute('aria-label', `Cart, ${q} item${q === 1 ? '' : 's'}`);
    const items = $('#cart-items'), form = $('#checkout-form'), empty = $('#cart-empty');
    if (!items) return;
    empty.hidden = q > 0; items.hidden = q === 0; form.hidden = q === 0;
    $('#qty-out').textContent = q;
    $('#line-total').textContent = fmt(q * PRICE);
    $('#cart-total').textContent = fmt(q * PRICE);
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
    if (!d) { $$('[data-open-cart]').forEach(b => b.addEventListener('click', () => location.assign('/?cart=1'))); return; }
    if (new URLSearchParams(location.search).get('cart') === '1') setTimeout(openDrawer, 0);
    $$('[data-add]').forEach(b => b.addEventListener('click', () => {
      setQty(Math.max(1, getQty() + (getQty() ? 0 : 1)));
      track('AddToCart', { content_ids: [SKU], content_type: 'product', value: PRICE, currency: 'ZAR' });
      openDrawer();
    }));
    $$('[data-open-cart]').forEach(b => b.addEventListener('click', openDrawer));
    $$('[data-close-cart]').forEach(b => b.addEventListener('click', closeDrawer));
    $('#qty-minus').addEventListener('click', () => setQty(getQty() - 1));
    $('#qty-plus').addEventListener('click', () => setQty(getQty() + 1));
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
      data.items = [{ sku: SKU, qty: getQty() }];
      track('InitiateCheckout', { value: getQty() * PRICE, currency: 'ZAR' });
      try {
        const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error(j.error || 'Checkout is unavailable right now.');
        window.location.assign(j.url);
      } catch (ex) {
        err.textContent = ex.message + ' Nothing was charged. Please try again or contact us.';
        btn.disabled = false; btn.textContent = 'Pay securely with Paystack';
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
    const bar = $('.sticky-buy'), anchor = $('#hero-buy');
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
      const r = await fetch('/api/verify?reference=' + encodeURIComponent(ref));
      const j = await r.json();
      if (j.status === 'success') {
        $('#order-ref').textContent = j.reference;
        $('#order-total').textContent = fmt(j.amount / 100);
        $('#order-email').textContent = j.email;
        show('success');
        setQty(0);
        if (!store.get('cc_tracked_' + j.reference, false)) {
          track('Purchase', { value: j.amount / 100, currency: 'ZAR', content_ids: [SKU], content_type: 'product' });
          store.set('cc_tracked_' + j.reference, true);
        }
      } else show('failed');
    } catch { show('failed'); }
  }

  render(); initConsent(); initDrawer(); initCheckout(); initSignup(); initSticky(); initConfirm();
  window.addEventListener('storage', render);
})();
