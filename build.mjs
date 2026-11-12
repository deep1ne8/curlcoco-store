// Build: src/ -> dist/. Fills %%KEY%% placeholders from site.config.json and generates
// product pages, the product grid and the server price list from products.json.
// Usage: node build.mjs            (warns about TODO values)
//        node build.mjs --strict   (fails on TODO values; use for production deploys)
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const cfg = JSON.parse(readFileSync('site.config.json', 'utf8'));
const products = JSON.parse(readFileSync('products.json', 'utf8'));
const live = products.filter(p => p.status === 'live');
const strict = process.argv.includes('--strict');

const todos = [...Object.entries(cfg), ...products.flatMap(p => Object.entries(p).map(([k, v]) => [`${p.sku}.${k}`, JSON.stringify(v)]))]
  .filter(([, v]) => String(v).includes('TODO'));
if (todos.length) {
  const msg = `TODO value(s) left: ${todos.map(([k]) => k).join(', ')}`;
  if (strict) { console.error(`✖ ${msg}`); process.exit(1); }
  console.warn(`⚠ ${msg}`);
}
for (const p of products) for (const k of ['sku', 'slug', 'name', 'price', 'image', 'imageAlt', 'delivery', 'summary'])
  if (!p[k]) { console.error(`✖ products.json: ${p.sku || '?'} is missing "${k}"`); process.exit(1); }

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rand = n => `R${Number(n).toLocaleString('en-ZA')}`;
const url = p => `/products/${p.slug}`;
const pic = (p, cls = '', attrs = '') => p.image.endsWith('.webp') && p.imageFallback
  ? `<picture><source srcset="${p.image}" type="image/webp"><img class="${cls}" src="${p.imageFallback}" alt="${esc(p.imageAlt)}" ${attrs}></picture>`
  : `<img class="${cls}" src="${p.image}" alt="${esc(p.imageAlt)}" ${attrs}>`;

const card = p => `<li class="card"><a href="${url(p)}"><div class="card-img">${pic(p, '', 'width="1040" height="1120" loading="lazy"')}</div>
  <div class="card-body"><span class="card-cat">${esc(p.category || '')}</span><h3>${esc(p.name)}</h3><p class="card-price">${rand(p.price)}</p></div></a></li>`;

const section = (title, body, cls = '') => body ? `<section class="pd-section ${cls}"><h2>${title}</h2>${body}</section>` : '';
function productPage(p) {
  const features = (p.features || []).map(([t, d]) => `<div><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('');
  const steps = (p.steps || []).map(([t, d]) => `<li><h3>${esc(t)}</h3><p>${esc(d)}</p></li>`).join('');
  const fit = p.fit ? `<div class="fit"><div><h3>Works best when</h3><ul>${p.fit.yes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div><h3>Probably not for you if</h3><ul class="no">${p.fit.no.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>${p.fit.note ? `<p class="muted small">${esc(p.fit.note)}</p>` : ''}` : '';
  const specs = [...(p.specs || []), ['Delivery', `Free, ${p.delivery}. Ships from %%DISPATCH_FROM%% in the supplier's packaging.`]]
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${k === 'Delivery' ? v : esc(v)}</td></tr>`).join('');
  const gallery = (p.gallery || []).map(g => `<img src="${g.src}" alt="${esc(g.alt)}" loading="lazy">`).join('');
  const faq = [...(p.faq || []),
    ['How long does delivery take?', `Estimated ${esc(p.delivery)}. We don't hold stock: your order ships from %%DISPATCH_FROM%%, and we email your tracking number as soon as we have it. See <a href="/shipping">Shipping</a>.`],
    ['Can I return it?', 'Yes. You have 7 days after delivery to cancel for any reason, and faulty items are covered for 6 months under the Consumer Protection Act. See <a href="/returns">Returns &amp; refunds</a>.'],
  ].map(([q, a], i) => `<details><summary>${esc(q)}</summary><div><p>${i < (p.faq || []).length ? esc(a) : a}</p></div></details>`).join('');
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.summary, image: cfg.SITE_URL + (p.imageFallback || p.image), sku: p.sku, brand: { '@type': 'Brand', name: cfg.BRAND },
    offers: { '@type': 'Offer', url: cfg.SITE_URL + url(p), priceCurrency: 'ZAR', price: String(p.price), availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition',
      shippingDetails: { '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: '0', currency: 'ZAR' }, shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'ZA' } },
      hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'ZA', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: 7, returnMethod: 'https://schema.org/ReturnByMail' } } }).replace(/</g, '\\u003c');
  return readFileSync('src/_templates/product.html', 'utf8')
    .replaceAll('%%P_NAME%%', esc(p.name)).replaceAll('%%P_SLUG%%', p.slug).replaceAll('%%P_SKU%%', p.sku)
    .replaceAll('%%P_PRICE%%', rand(p.price)).replaceAll('%%P_PRICE_NUM%%', String(p.price))
    .replaceAll('%%P_TAGLINE%%', esc(p.tagline || '')).replaceAll('%%P_SUMMARY%%', esc(p.summary)).replaceAll('%%P_CATEGORY%%', esc(p.category || ''))
    .replaceAll('%%P_DELIVERY%%', esc(p.delivery)).replaceAll('%%P_OG_IMAGE%%', cfg.SITE_URL + (p.imageFallback || p.image))
    .replaceAll('%%P_IMAGE%%', pic(p, 'pd-main', 'width="1040" height="1120" fetchpriority="high"'))
    .replaceAll('%%P_GALLERY%%', gallery ? `<div class="pd-thumbs">${gallery}</div>` : '')
    .replaceAll('%%P_FEATURES%%', features ? `<div class="features">${features}</div>` : '')
    .replaceAll('%%P_STEPS%%', section('How it works', steps && `<ol class="steps">${steps}</ol>`))
    .replaceAll('%%P_FIT%%', section('Is it right for you?', fit))
    .replaceAll('%%P_SPECS%%', section('Details', `<table class="specs"><tbody>${specs}</tbody></table><p class="muted small">Photos: supplier product photos.</p>`))
    .replaceAll('%%P_FAQ%%', section('Questions', `<div class="faq">${faq}</div>`))
    .replaceAll('%%P_JSONLD%%', ld);
}

const catalogJson = JSON.stringify(Object.fromEntries(live.map(p => [p.sku, { name: p.name, price: p.price, image: p.imageFallback || p.image, url: url(p) }]))).replace(/</g, '\\u003c');
const vars = {
  ...Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, esc(v)])),
  YEAR: String(new Date().getFullYear()),
  BUILD_DATE: new Date().toISOString().slice(0, 10),
  PRODUCT_GRID: `<ul class="grid-products">${live.map(card).join('')}</ul>`,
  PRODUCT_COUNT: `${live.length} product${live.length === 1 ? '' : 's'}`,
  CATALOG_JSON: catalogJson,
  SITEMAP_PRODUCTS: live.map(p => `  <url><loc>${cfg.SITE_URL}${url(p)}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`).join('\n'),
};

rmSync('dist', { recursive: true, force: true });
cpSync('src', 'dist', { recursive: true });
rmSync('dist/_partials', { recursive: true, force: true });
rmSync('dist/_templates', { recursive: true, force: true });
mkdirSync('dist/products', { recursive: true });
for (const p of live) writeFileSync(`dist/products/${p.slug}.html`, productPage(p));
mkdirSync('dist/assets/fonts', { recursive: true });
for (const w of [400, 500, 600]) cpSync(`node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`, `dist/assets/fonts/inter-latin-${w}-normal.woff2`);

const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const partials = Object.fromEntries(readdirSync('src/_partials').map(f => [f.replace('.html', ''), readFileSync(join('src/_partials', f), 'utf8')]));
const missing = new Set();
for (const file of walk('dist').filter(p => ['.html', '.xml', '.txt', '.js', '.json', '.webmanifest'].includes(extname(p)))) {
  const out = readFileSync(file, 'utf8')
    .replace(/<!-- @include (\w+) -->/g, (m, n) => partials[n] ?? (missing.add('partial:' + n), m))
    .replace(/%%([A-Z_]+)%%/g, (m, k) => (k in vars ? vars[k] : (missing.add(k), m)));
  writeFileSync(file, out);
}
if (missing.size) { console.error(`✖ Unknown placeholders: ${[...missing].join(', ')}`); process.exit(1); }

// Server-side price authority for Pages Functions (never trust the browser's price).
writeFileSync('functions/_lib/catalog.js',
  `// Generated by build.mjs from products.json and site.config.json — do not edit by hand.\n` +
  `export const CATALOG = ${JSON.stringify(Object.fromEntries(live.map(p => [p.sku, { name: p.name, priceCents: Math.round(p.price * 100), delivery: p.delivery }])), null, 2)};\n` +
  `export const SITE_URL = ${JSON.stringify(cfg.SITE_URL)};\nexport const BRAND = ${JSON.stringify(cfg.BRAND)};\n` +
  `export const DELIVERY_ESTIMATE = ${JSON.stringify(live.length === 1 ? live[0].delivery : cfg.DELIVERY_ESTIMATE)};\n` +
  `export const PAYMENT_PROVIDER = ${JSON.stringify(cfg.PAYMENT_PROVIDER || 'paystack')};\n`);

// Cache-bust CSS/JS: /assets/* is served "immutable", so every change needs a new URL.
const ver = f => createHash('sha256').update(readFileSync(join('dist', f))).digest('hex').slice(0, 10);
const map = { '/assets/css/site.css': ver('assets/css/site.css'), '/assets/js/site.js': ver('assets/js/site.js') };
for (const file of walk('dist').filter(p => p.endsWith('.html'))) {
  let h = readFileSync(file, 'utf8');
  for (const [u, v] of Object.entries(map)) h = h.split(`"${u}"`).join(`"${u}?v=${v}"`);
  writeFileSync(file, h);
}
console.log(`✔ Built dist/ (${walk('dist').length} files, ${live.length} live product${live.length === 1 ? '' : 's'})`);
