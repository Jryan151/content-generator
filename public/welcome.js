// public/welcome.js — the landing page's only script: fills in plans and links from /api/public/info
// and sends the request-access form. No tracking, no cookies.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shownAt = Date.now();

const money = (cents, cur = 'usd') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
  catch { return `$${(cents / 100).toFixed(0)}`; }
};

async function info() {
  let d;
  try { d = await (await fetch('/api/public/info', { credentials: 'omit' })).json(); } catch { return; }
  const plans = (d.plans || []).filter(p => p.name);
  if (plans.length) {
    $('#plans').innerHTML = plans.map(p => `<div class="card"><h3>${esc(p.name)}</h3>
      ${p.amount != null ? `<div class="price">${esc(money(p.amount, p.currency))}<small>${p.interval ? ' / ' + esc(p.interval) : ''}</small></div>` : ''}
      <p>${esc(p.videos)} videos a month${p.about ? '. ' + esc(p.about) : ''}</p></div>`).join('');
  }
  if (d.trialDays) $('#trial').textContent = `Every plan starts with a ${d.trialDays}-day free trial.`;
  const links = [d.termsUrl && `<a href="${esc(d.termsUrl)}">Terms of Service</a>`, d.privacyUrl && `<a href="${esc(d.privacyUrl)}">Privacy Policy</a>`].filter(Boolean);
  $('#legal').innerHTML = links.join(' · ');
  if (d.privacyUrl) $('#privacyLink').innerHTML = `See our <a href="${esc(d.privacyUrl)}">Privacy Policy</a>.`;
  if (d.contact) $('#contact').innerHTML = `<a href="mailto:${esc(d.contact)}">${esc(d.contact)}</a>`;
}

$('#accessForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, st = $('#status'), btn = f.querySelector('button');
  const fd = new FormData(f);
  const body = Object.fromEntries([...fd.entries()].filter(([k]) => k !== 'products'));
  body.products = fd.getAll('products');
  body.consent = !!fd.get('consent');
  body.elapsed = Date.now() - shownAt;
  body.ref = new URLSearchParams(location.search).get('ref') || '';   // a referral link from another agent
  const show = (msg, cls) => { st.textContent = msg; st.className = 'status ' + cls; };
  if (!String(body.name || '').trim()) return show('Add your name.', 'err');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email || '').trim())) return show('That email address doesn’t look right.', 'err');
  if (!body.consent) return show('Tick the box so we can contact you about access.', 'err');
  btn.disabled = true; show('Sending…', '');
  try {
    const res = await fetch('/api/access-request', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'That didn’t send. Try again in a minute.');
    f.reset();
    show('Thanks! We got your request and will be in touch soon.', 'ok');
  } catch (err) { show(err.message, 'err'); btn.disabled = false; }
});

info();
