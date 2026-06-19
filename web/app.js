'use strict';

const PROVIDER_ORDER = ['FOI', 'Primaya', 'BRILife'];
const PROVIDER_COLOR = { FOI: '#3b82f6', Primaya: '#8b5cf6', BRILife: '#ec4899' };

// minimal line icons (monochrome, inherit currentColor)
const ICON = {
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 4 14a4.95 4.95 0 0 1 7-7l6.5 6.5a4.95 4.95 0 0 1-7 7Z"/><path d="m8 8 8 8"/></svg>',
  mfr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V9l5 3V9l5 3V9l4 2.5V21"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v5l8 8 6-6-8-8H4Z"/><circle cx="7" cy="11" r="1.3"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/></svg>',
};

let DATA = { items: [], providers: {}, ingredients: [] };
let activeProviders = new Set(PROVIDER_ORDER);

const $ = (id) => document.getElementById(id);
const qEl = $('q'), clearEl = $('clear'), resultsEl = $('results'),
      hintEl = $('hint'), filtersEl = $('filters');

function norm(s) {
  return (s || '').toString().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

// ----- theme toggle -----
(function () {
  const btn = $('themebtn');
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0a0f1a' : '#ffffff');
  };
  apply(localStorage.getItem('theme') || 'light');
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch (e) {}
    apply(next);
  };
})();

// ----- encrypted data: decrypt in-browser with the access password -----
// Small fields (salt/iv): a tiny sync loop is fine.
function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// Large ciphertext: decode via the browser's native base64 decoder instead of a
// multi-million-iteration JS loop, so the main thread never blocks on mobile.
// (data: URLs are not intercepted by the service worker.)
async function b64ToBytesFast(b64) {
  const res = await fetch(`data:application/octet-stream;base64,${b64}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function decryptData(password, setStatus) {
  const note = (t) => { if (setStatus) setStatus(t); };
  let p;
  try {
    note('Mengunduh data…');
    // Abort a stalled download instead of hanging forever on spotty mobile signal.
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
      res = await fetch('data.enc.json', { cache: 'no-store', signal: ctrl.signal });
    } finally { clearTimeout(to); }
    if (!res.ok) throw 0;
    p = await res.json();
  } catch (e) {
    const err = new Error('network'); err.kind = 'net'; throw err;
  }
  note('Mendekripsi…');
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(p.salt), iterations: p.iter, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const ct = await b64ToBytesFast(p.ct);
  // AES-GCM decrypt throws if the password is wrong (auth tag mismatch).
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(p.iv) }, key, ct);
  note('Menyiapkan…');
  return JSON.parse(new TextDecoder().decode(plain));
}

function initApp(d) {
  DATA = d;
  $('ings').innerHTML = d.ingredients.map((i) => `<option value="${escapeAttr(i)}">`).join('');
  buildFilters();
  buildSuggestions();
  $('count').textContent = `${d.items.length.toLocaleString('id')} produk`;
  $('footer').textContent = d.generatedAt ? `diperbarui ${d.generatedAt.slice(0, 10)}` : '';
  const last = sessionStorage.getItem('q');
  if (last) { qEl.value = last; clearEl.style.display = 'flex'; run(); }
}

// ----- password gate -----
(function () {
  const gate = $('gate'), form = $('gateForm'), pw = $('pw'),
        btn = $('gateBtn'), err = $('gateErr'), remember = $('remember');

  async function tryOpen(password, silent) {
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Membuka…';
    const setStatus = (t) => { btn.textContent = t; };  // doubles as a stall indicator
    try {
      const d = await decryptData(password, setStatus);
      try { remember.checked ? localStorage.setItem('pw', password) : localStorage.removeItem('pw'); } catch (e) {}
      initApp(d);
      gate.classList.add('hidden');
      qEl.focus();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Buka';
      if (e && e.kind === 'net') {        // keep saved password; just a connection issue
        err.textContent = 'Gagal memuat data — cek koneksi, lalu coba lagi.';
        return;
      }
      try { localStorage.removeItem('pw'); } catch (_) {}  // wrong password
      if (!silent) { err.textContent = 'Kata sandi salah.'; pw.select(); }
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); if (pw.value) tryOpen(pw.value, false); });

  let saved = null;
  try { saved = localStorage.getItem('pw'); } catch (e) {}
  if (saved) { pw.value = saved; tryOpen(saved, true); } else { pw.focus(); }
})();

// ----- provider filter chips -----
function buildFilters() {
  filtersEl.innerHTML = '';
  PROVIDER_ORDER.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="dot" style="background:${PROVIDER_COLOR[p]}"></span>${DATA.providers[p] || p}`;
    b.onclick = () => {
      if (activeProviders.has(p)) activeProviders.delete(p); else activeProviders.add(p);
      if (activeProviders.size === 0) activeProviders.add(p);
      b.setAttribute('aria-pressed', activeProviders.has(p) ? 'true' : 'false');
      run();
    };
    filtersEl.appendChild(b);
  });
}

function buildSuggestions() {
  const picks = ['Amlodipine', 'Cetirizine', 'Paracetamol', 'Omeprazole', 'Metformin', 'Amoxicillin'];
  $('sugg').innerHTML = picks.map((p) => `<button>${p}</button>`).join('');
  $('sugg').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { qEl.value = b.textContent; clearEl.style.display = 'flex'; run(); };
  });
}

// ----- search -----
let timer = null;
qEl.addEventListener('input', () => {
  clearEl.style.display = qEl.value ? 'flex' : 'none';
  clearTimeout(timer);
  timer = setTimeout(run, 110);
});
clearEl.onclick = () => { qEl.value = ''; clearEl.style.display = 'none'; run(); qEl.focus(); };

function score(item, q) {
  const ing = item.ingredient, brand = norm(item.brand), raw = norm(item.raw);
  if (ing && ing.startsWith(q)) return 100;
  if (raw.startsWith(q) || brand.startsWith(q)) return 80;
  if (ing && ing.includes(q)) return 60;
  if (brand.includes(q)) return 40;
  if (raw.includes(q)) return 20;
  return -1;
}

function run() {
  const raw = qEl.value.trim();
  sessionStorage.setItem('q', raw);
  const q = norm(raw);
  if (q.length < 2) { resultsEl.innerHTML = ''; hintEl.style.display = ''; return; }
  hintEl.style.display = 'none';

  const scored = [];
  for (const it of DATA.items) {
    if (!activeProviders.has(it.provider)) continue;
    const s = score(it, q);
    if (s >= 0) scored.push([s, it]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].brand.localeCompare(b[1].brand));

  if (scored.length === 0) {
    resultsEl.innerHTML = `<div class="hint"><div class="big">Tidak ada hasil</div>` +
      `<div class="small">untuk “${escapeHtml(raw)}”</div></div>`;
    return;
  }

  const groups = {};
  for (const [, it] of scored) (groups[it.provider] ||= []).push(it);

  let html = `<div class="meta"><b>${scored.length}</b> hasil untuk “${escapeHtml(raw)}”</div>`;
  for (const p of PROVIDER_ORDER) {
    const arr = groups[p];
    if (!arr) continue;
    html += `<div class="grouphead">
        <span class="gdot" style="background:${PROVIDER_COLOR[p]}"></span>
        ${escapeHtml(DATA.providers[p] || p)}
        <span class="cnt">${arr.length}</span>
      </div>
      ${arr.slice(0, 200).map((it) => card(it, q)).join('')}
      ${arr.length > 200 ? `<div class="meta">…${arr.length - 200} lagi — persempit pencarian</div>` : ''}`;
  }
  resultsEl.innerHTML = html;
  window.scrollTo({ top: 0 });
}

function card(it, q) {
  const name = it.brand || it.raw || '(tanpa nama)';
  const sub = [];
  if (it.form) sub.push(`<span>${ICON.form}${escapeHtml(it.form)}</span>`);
  if (it.manufacturer) sub.push(`<span>${ICON.mfr}${escapeHtml(it.manufacturer)}</span>`);
  if (it.class) sub.push(`<span>${ICON.tag}${escapeHtml(it.class)}</span>`);
  const ref = it.ingredientSource === 'crossref'
    ? `<span class="ref" title="Komposisi disimpulkan dari merek di formularium lain">≈ ref</span>` : '';
  const ingLine = it.ingredientDisplay
    ? `<div class="ing"><span class="lbl">Komposisi</span><span class="val">${hl(it.ingredientDisplay, q)}</span>${ref}</div>`
    : `<div class="ing"><span class="lbl">Produk</span><span class="val">${hl(it.raw, q)}</span></div>`;
  return `<div class="card">
    <div class="top">
      <span class="name">${hl(name, q)}</span>
      ${it.strength ? `<span class="pill">${escapeHtml(it.strength)}</span>` : ''}
    </div>
    ${ingLine}
    ${sub.length ? `<div class="sub">${sub.join('')}</div>` : ''}
    ${it.note ? `<div class="note">${ICON.warn}<span>${escapeHtml(it.note)}</span></div>` : ''}
  </div>`;
}

// ----- helpers -----
function hl(text, q) {
  text = text || '';
  const i = norm(text).indexOf(q);
  if (i < 0 || !q) return escapeHtml(text);
  return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) +
    '</mark>' + escapeHtml(text.slice(i + q.length));
}
function escapeHtml(s) {
  return (s || '').toString().replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ----- PWA -----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
