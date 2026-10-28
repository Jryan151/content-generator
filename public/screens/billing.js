// public/screens/billing.js — Billing.
// Split out of app.js by screen (v15). It uses the portal's shared parts from app.js (which loads it),
// and app.js and the other screens use what it exports. The code is as it was in app.js.
import { S, api, can, copy, day, esc, later, main, refreshMe, status, toast } from '../app.js';
import { seg } from './brand.js';

/* ================= Billing ================= */
async function viewBilling(ctx) {
  S.billing = await api('/api/billing');
  // Back from checkout: Stripe confirms the plan a few seconds later, so this checks a few times.
  if (ctx.q?.get('done')) {
    S.billWaiting = !['active', 'trialing'].includes(S.billing.billing?.status);
    const check = n => later(async () => {
      if (S.view !== 'billing') return;
      try { S.billing = await api('/api/billing'); } catch { /* try again below */ }
      const ok = ['active', 'trialing'].includes(S.billing.billing?.status);
      S.billWaiting = !ok && n < 5;
      if (!ok && n >= 5) toast('Stripe hasn’t confirmed your plan yet. It can take a few minutes; check back soon.');
      drawBilling(); if (ok) { await refreshMe(); toast('Your plan is active.'); } else if (n < 5) check(n + 1);
    }, 4000);
    if (S.billWaiting) check(1);
  }
  drawBilling();
}
function drawBilling() {
  const b = S.billing, bill = b.billing || {}, a = b.access;
  const money = p => (p.amount != null ? `${(p.amount / 100).toLocaleString([], { style: 'currency', currency: (p.currency || 'usd').toUpperCase() })}${p.interval ? ' / ' + p.interval : ''}` : '');
  const active = ['active', 'trialing', 'past_due'].includes(bill.status);
  const statusText = { active: 'Active', trialing: 'Free trial', past_due: 'Payment failed', canceled: 'Ended', unpaid: 'Unpaid', incomplete: 'Waiting for payment', incomplete_expired: 'Payment expired' }[bill.status] || 'No plan yet';
  main.innerHTML = `<div class="head"><h1>Billing</h1><p class="lede">${b.comped ? 'Your workspace is included at no charge.' : 'Your plan and payment details.'}</p></div>
    ${S.billWaiting ? '<div class="note"><span class="spin"></span> Waiting for Stripe to confirm your plan…</div>' : ''}
    ${!b.enabled ? `<div class="note">Billing isn’t set up on this server. Your workspace includes ${a.limit} videos a month.</div>` : b.comped ? `<div class="note ok">Included at no charge: ${a.limit} videos a month.</div>` : `
    <section class="panel"><div class="row between"><h2>${esc(statusText)}</h2>${bill.plan ? `<span class="pill ok">${esc(b.plans.find(p => p.id === bill.plan)?.name || bill.plan)}</span>` : ''}</div>
      ${a.allowed ? `<p class="muted small" style="margin:0">${a.limit} videos a month.${bill.periodEnd ? ` ${bill.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${esc(day(bill.periodEnd))}.` : ''}</p>` : `<p class="muted small" style="margin:0">${esc(a.reason)}</p>`}
      ${a.warning ? `<div class="note warn">${esc(a.warning)}</div>` : ''}
      ${bill.customerId ? '<div class="row"><button class="btn" data-act="portal">Manage billing</button><span class="small muted">Change plan, update your card, see invoices or cancel.</span></div>' : ''}</section>
    ${active ? '' : `<section class="stack"><h2>Choose a plan</h2>${b.trialDays && !b.trialUsed ? `<p class="small muted" style="margin:0">Starts with a ${b.trialDays}-day free trial. Cancel any time before it ends and you won’t be charged.</p>` : ''}
      ${b.plans.some(p => p.yearly) ? `<div class="seg" style="align-self:start"><button data-act="bill-every" data-v="month" aria-pressed="${S.billEvery !== 'year'}">Monthly</button><button data-act="bill-every" data-v="year" aria-pressed="${S.billEvery === 'year'}">Yearly</button></div>` : ''}
      <div class="cards">${b.plans.map(p => { const y = S.billEvery === 'year' && p.yearly; return `<div class="pick"><b>${esc(p.name)}</b><span class="mono">${esc(money(y ? p.yearly : p))}</span>${y && p.yearly.saves ? `<span class="pill ok">Save ${esc(money({ amount: p.yearly.saves, currency: p.yearly.currency }))} a year</span>` : ''}<span>${p.videos} videos a month.${p.about ? ' ' + esc(p.about) : ' Overnight videos, scene fixes and approval records.'}</span><button class="btn primary" data-act="checkout" data-id="${p.id}" data-every="${y ? 'year' : 'month'}">Choose ${esc(p.name)}${y ? ' yearly' : ''}</button></div>`; }).join('') || `<p class="empty">No plans are set up yet. ${S.me.support ? `Email <a href="mailto:${esc(S.me.support)}">${esc(S.me.support)}</a> to get started.` : 'Ask the person who set up your account.'}</p>`}</div></section>`}`}
    ${can('people') ? '<section class="panel"><div class="row between"><div class="head"><h2>Assistant seats</h2><p>Add someone to prepare videos, draft replies and keep your follow-ups moving. Each assistant is a seat on your plan.</p></div><a class="btn" href="#/team">Manage in Setup → Team</a></div></section>' : ''}
    ${b.referral && !b.comped ? `<section class="panel"><h2>Refer an agent, get a free month</h2><p class="small" style="margin:0">Share your link. When an agent you refer starts a paid plan, you get one month free, taken off your next bill. No limit.</p>
      <div class="row"><input class="ctl" readonly value="${esc(b.referral.link)}" style="flex:1 1 260px" aria-label="Your referral link"><button class="btn" data-act="copy-ref">Copy link</button></div>
      <span class="small muted">Your code: <b class="mono">${esc(b.referral.code)}</b>${b.referral.credits.length ? ` · ${b.referral.credits.length} free month${b.referral.credits.length === 1 ? '' : 's'} earned` : ''}</span></section>` : ''}
    <div class="status" data-st="billing"></div>`;
}

export { drawBilling, viewBilling };
