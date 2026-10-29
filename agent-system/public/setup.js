// Leader Setup page script (served at /agent-system/setup.js). Mirrors agent-system/src/setup.js.
(() => {
  // Mirrors src/setup.js: same shape, same starters, same math.
  const RATES = { avgPremium: 600, closeRate: 0.5, bookingRate: 0.25, contactRate: 0.25 };
  const WORKDAYS = 21, WEEKS = 52 / 12, STARTER_INCOME = 76800, CONTRACT = 80;
  const premiumFor = (income) => Math.ceil(income / (CONTRACT / 100));
  const usd = (n) => '$' + n.toLocaleString('en-US');
  const PATHS = {
    producer: ['Producer', 'I sell, and I get ready to build. Production first, then one names-list conversation a day.'],
    coach: ['Coach', 'I sell and I train. Mornings produce plus one recruiting step, afternoons coach.'],
  };
  const KEY = 'leader-setup-v4';
  const $ = (id) => document.getElementById(id);
  let S = { version: 4, name: '', hasAgents: null, start: null, yearlyIncome: null };
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.version === 4) S = { ...S, ...d }; } catch (e) {}

  const path = () => (S.hasAgents === false ? 'producer' : 'coach');
  function plan(goal) {
    const apps = Math.ceil(goal / 12 / RATES.avgPremium), appts = Math.ceil(apps / RATES.closeRate);
    const convos = Math.ceil(appts / RATES.bookingRate), dials = Math.ceil(convos / RATES.contactRate);
    return { dials: Math.ceil(dials / WORKDAYS), convos: Math.ceil(convos / WORKDAYS), weeklyAppts: Math.ceil(appts / WEEKS) };
  }
  const missing = () => [S.hasAgents === null && 'question 1',
    !S.start && 'start of day', !(S.yearlyIncome > 0) && 'earnings goal'].filter(Boolean);

  function render() {
    document.querySelectorAll('.opt').forEach((b) => {
      const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
      b.setAttribute('aria-pressed', String(S[b.dataset.k] === v));
    });
    const p = path();
    $('rp').textContent = PATHS[p][0]; $('motto').textContent = PATHS[p][1];
    const income = S.yearlyIncome > 0 ? S.yearlyIncome : STARTER_INCOME;
    const n = plan(premiumFor(income));
    $('premium').textContent = `To earn ${usd(income)}, you write about ${usd(premiumFor(income))} in premium`;
    $('dials').textContent = n.dials; $('convos').textContent = n.convos; $('appts').textContent = n.weeklyAppts;
    const left = missing();
    $('send').disabled = left.length > 0;
    $('saveFile').disabled = left.length > 0;
    $('status').textContent = left.length ? `Still to answer: ${left.join(', ')}.` : 'Done. Send your answers to set up your system.';
    $('out').textContent = JSON.stringify(out(), null, 2);
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }
  const out = () => ({ ...S });

  document.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
    S[b.dataset.k] = S[b.dataset.k] === v ? null : v;
    render();
  }));
  $('goal').value = S.yearlyIncome || '';
  $('goal').addEventListener('input', (e) => {
    const v = e.target.value.trim();
    S.yearlyIncome = v === '' ? null : Number(v);
    $('goal-err').textContent = v !== '' && !(S.yearlyIncome > 0) ? 'Enter a dollar amount above 0.' : '';
    render();
  });

  const text = () => JSON.stringify(out(), null, 2) + '\n';
  $('send').addEventListener('click', () => {
    const done = () => { $('status').textContent = 'Copied. Paste it into a text or email to send it over.'; };
    const fallback = () => {
      $('out').hidden = false;
      const r = document.createRange(); r.selectNodeContents($('out')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      $('status').textContent = 'Copying is blocked here. Your answers are selected below: copy and send them.';
    };
    try { navigator.clipboard.writeText(text()).then(done, fallback); } catch (e) { fallback(); }
  });

  render();

  Promise.resolve(window.claude?.use?.('downloads')).then((dl) => {
    if (!dl) return;
    $('saveFile').hidden = false;
    $('saveFile').addEventListener('click', async () => {
      try { await dl.save({ filename: 'leader-setup.json', data: text() }); $('status').textContent = 'Saved. Send the file over when you’re ready.'; }
      catch (e) { $('status').textContent = 'The file wasn’t saved. Use Copy my answers instead.'; }
    });
  }).catch(() => {});
})();
