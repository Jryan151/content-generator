// lib/billing.js — plans, Stripe Checkout, the billing portal and Stripe webhooks.
// Uses Stripe's REST API directly (no SDK). With no STRIPE_SECRET_KEY, billing is off and
// every workspace can make videos up to COMP_VIDEOS a month (handy for a single agency).
import crypto from 'crypto';
import path from 'path';
import { DIRS, readJSON, updateJSON } from './paths.js';
import { getWorkspace, listWorkspaces, updateWorkspace, validWs } from './store.js';
import { notify } from './alerts.js';
import * as breaker from './breaker.js';
import { emailWorkspace, paymentFailedEmail, sendTrialEnding } from './email.js';

const env = process.env;
const API = () => (env.STRIPE_API_BASE || 'https://api.stripe.com/v1').replace(/\/$/, '');
const EVENTS = path.join(DIRS.data, 'stripe-events.json');
const STATUS = path.join(DIRS.data, 'stripe-status.json');
export const webhookStatus = () => readJSON(STATUS, {});
export const billingOn = () => !!env.STRIPE_SECRET_KEY;
export const TRIAL_DAYS = () => Math.max(0, Number(env.TRIAL_DAYS || 0));
const COMP_VIDEOS = () => Number(env.COMP_VIDEOS || 30);
const OK_STATUS = ['active', 'trialing', 'past_due'];

// Videos a month by default match what's sold (SETUP.md D, .env.example): Starter 30, Pro 60.
export const PLAN_DEFAULT_VIDEOS = { starter: 30, pro: 60 };
export function planList() {
  return [
    { id: 'starter', name: env.PLAN_STARTER_NAME || 'Starter', priceId: env.STRIPE_PRICE_STARTER, yearlyPriceId: env.STRIPE_PRICE_STARTER_YEARLY || '', videos: Number(env.PLAN_STARTER_VIDEOS || PLAN_DEFAULT_VIDEOS.starter), about: env.PLAN_STARTER_ABOUT || '' },
    { id: 'pro', name: env.PLAN_PRO_NAME || 'Pro', priceId: env.STRIPE_PRICE_PRO, yearlyPriceId: env.STRIPE_PRICE_PRO_YEARLY || '', videos: Number(env.PLAN_PRO_VIDEOS || PLAN_DEFAULT_VIDEOS.pro), about: env.PLAN_PRO_ABOUT || '' },
  ].filter(p => p.priceId);
}
// Done for you: a workspace you manage yourself (you write and tune their prompts). Either ticked
// in Admin, or on the plan named in MANAGED_PLAN (e.g. MANAGED_PLAN=pro).
export const isManaged = ws => !!ws && (!!ws.managed || (!!env.MANAGED_PLAN && ws.billing?.plan === env.MANAGED_PLAN && ['active', 'trialing', 'past_due'].includes(ws.billing?.status)));

// Can this workspace make videos, and how many a month?
export function access(ws) {
  if (!ws) return { allowed: false, reason: 'Workspace not found.', limit: 0 };
  const override = Number(ws.limits?.videosPerMonth) || 0;
  if (ws.suspended) return { allowed: false, reason: 'This workspace is paused. Contact your admin.', limit: 0 };
  if (!billingOn() || ws.comped) return { allowed: true, plan: ws.comped ? 'comped' : 'included', limit: override || COMP_VIDEOS(), status: ws.comped ? 'comped' : '' };
  const status = ws.billing?.status || '';
  const plan = planList().find(p => p.id === ws.billing?.plan);
  if (OK_STATUS.includes(status)) return { allowed: true, plan: plan?.id || ws.billing.plan, limit: override || plan?.videos || COMP_VIDEOS(), status, warning: status === 'past_due' ? 'Your last payment didn’t go through. Update your card in Billing to keep making videos.' : '' };
  return { allowed: false, reason: status === 'canceled' ? 'Your plan has ended. Choose a plan to keep making videos.' : 'Choose a plan to start making videos.', limit: 0, status };
}

/* ---------------- Stripe API ---------------- */
function encode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out); else out.append(key, String(v));
  }
  return out;
}
// Every change sent to Stripe carries a one-time key (Stripe's Idempotency-Key): when the answer is lost
// (a dropped connection), it's sent once more with the same key, and Stripe does it only once.
// Stripe has a breaker (lib/breaker.js): while it isn't answering, payment pages say so at once.
async function stripe(method, route, params = null, { idempotencyKey = '' } = {}) {
  // GET and DELETE take their parameters in the query string, the rest as a form.
  const inQuery = params && (method === 'GET' || method === 'DELETE');
  const key = idempotencyKey || (method === 'POST' ? `ar-${crypto.randomUUID()}` : '');
  return breaker.guard('stripe', async () => {
    for (let i = 0; ; i++) {
      let res;
      try {
        res = await fetch(API() + route + (inQuery ? `?${encode(params)}` : ''), {
          method,
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params && !inQuery ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
          body: params && !inQuery ? encode(params).toString() : undefined,
          signal: AbortSignal.timeout(20000),
        });
      } catch (e) {
        if (i < 1 && (key || method === 'GET')) continue;   // safe to send again: same key
        throw Object.assign(new Error('Payments aren’t answering right now. Try again in a few minutes.'), { unknown: true, retry: true });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error('Stripe: ' + (data.error?.message || res.status)), { status: res.status, retry: res.status >= 500 || res.status === 429 });
      return data;
    }
  });
}

let priceCache = { at: 0, plans: null };
export async function plansWithPrices() {
  if (priceCache.plans && Date.now() - priceCache.at < 3600000) return priceCache.plans;
  const plans = await Promise.all(planList().map(async p => {
    let out = { ...p };
    try {
      const pr = await stripe('GET', `/prices/${encodeURIComponent(p.priceId)}`);
      out = { ...out, amount: pr.unit_amount, currency: pr.currency, interval: pr.recurring?.interval || '' };
    } catch { /* shown without a price */ }
    // Yearly option (e.g. two months free): its own Stripe price.
    if (p.yearlyPriceId) {
      try {
        const y = await stripe('GET', `/prices/${encodeURIComponent(p.yearlyPriceId)}`);
        out.yearly = { amount: y.unit_amount, currency: y.currency, interval: y.recurring?.interval || 'year', saves: out.amount != null && out.interval === 'month' ? Math.max(0, out.amount * 12 - y.unit_amount) : null };
      } catch { /* no yearly option shown */ }
    }
    return out;
  }));
  priceCache = { at: Date.now(), plans };
  return plans;
}

export async function checkout(ws, planId, email, baseUrl, interval = 'month') {
  const plan = planList().find(p => p.id === planId);
  if (!plan) throw new Error('Unknown plan.');
  if (interval === 'year' && !plan.yearlyPriceId) throw new Error('That plan has no yearly option.');
  const params = {
    mode: 'subscription',
    line_items: { 0: { price: interval === 'year' ? plan.yearlyPriceId : plan.priceId, quantity: 1 } },
    client_reference_id: ws.id,
    // Plain query strings (no #) for Stripe's redirects; the portal turns them into the Billing page.
    success_url: `${baseUrl}/?billing=done`,
    cancel_url: `${baseUrl}/?billing=back`,
    allow_promotion_codes: 'true',
    metadata: { workspace: ws.id },
    subscription_data: { metadata: { workspace: ws.id }, ...(TRIAL_DAYS() && !ws.billing?.trialUsed ? { trial_period_days: TRIAL_DAYS() } : {}) },
  };
  if (ws.billing?.customerId) params.customer = ws.billing.customerId; else params.customer_email = email;
  const s = await stripe('POST', '/checkout/sessions', params);
  return s.url;
}

export async function portal(ws, baseUrl) {
  if (!ws.billing?.customerId) throw new Error('No billing account yet. Choose a plan first.');
  const s = await stripe('POST', '/billing_portal/sessions', { customer: ws.billing.customerId, return_url: `${baseUrl}/?billing=back` });
  return s.url;
}

/* ---------------- Assistant seats (a paid add-on) ---------------- */
// Each assistant needs a seat. With billing on, seats are a quantity on the workspace's subscription
// (STRIPE_PRICE_SEAT, charged per seat, prorated). Without billing, or for a comped workspace, you set
// them in Admin (limits.assistantSeats); that number also adds to paid seats.
// A yearly plan needs a yearly seat price (Stripe bills every item on a subscription on one schedule).
export const SEAT_PRICE = (interval = 'month') => (interval === 'year' ? env.STRIPE_PRICE_SEAT_YEARLY || '' : env.STRIPE_PRICE_SEAT || '');
const seatPrices = () => [env.STRIPE_PRICE_SEAT, env.STRIPE_PRICE_SEAT_YEARLY].filter(Boolean);
export const MAX_SEATS = 10;
export function seatsFor(ws) {
  if (!ws) return 0;
  const extra = Math.max(0, Number(ws.limits?.assistantSeats) || 0);
  if (!billingOn() || ws.comped) return Math.min(MAX_SEATS, extra);
  return Math.min(MAX_SEATS, (OK_STATUS.includes(ws.billing?.status) ? Number(ws.billing?.seats) || 0 : 0) + extra);
}
export const canBuySeats = ws => billingOn() && !ws?.comped && !!SEAT_PRICE(ws?.billing?.interval) && !!ws?.billing?.subscriptionId && OK_STATUS.includes(ws.billing?.status);
const seatPriceCache = new Map();
export async function seatPrice(ws = null) {
  const id = SEAT_PRICE(ws?.billing?.interval);
  if (!billingOn() || !id) return null;
  const hit = seatPriceCache.get(id);
  if (hit && Date.now() - hit.at < 3600000) return hit.price;
  try { const p = await stripe('GET', `/prices/${encodeURIComponent(id)}`); const price = { amount: p.unit_amount, currency: p.currency, interval: p.recurring?.interval || 'month' }; seatPriceCache.set(id, { at: Date.now(), price }); return price; } catch { return null; }
}
// Sets how many paid seats the workspace has (Stripe prorates the change).
export async function setSeats(ws, n) {
  n = Math.max(0, Math.min(MAX_SEATS, Math.round(Number(n) || 0)));
  if (!billingOn() || ws.comped) throw Object.assign(new Error('Seats for this workspace are set by your admin.'), { status: 409 });
  const price = SEAT_PRICE(ws.billing?.interval);
  if (!price) throw Object.assign(new Error(ws.billing?.interval === 'year' ? 'Assistant seats aren’t available on yearly plans yet. Ask your admin.' : 'Assistant seats aren’t set up on this server yet.'), { status: 409 });
  if (!canBuySeats(ws)) throw Object.assign(new Error('Choose a plan first, then add seats.'), { status: 409 });
  const sub = await stripe('GET', `/subscriptions/${encodeURIComponent(ws.billing.subscriptionId)}`);
  const item = (sub.items?.data || []).find(i => seatPrices().includes(i?.price?.id));
  if (item && n === 0) await stripe('DELETE', `/subscription_items/${encodeURIComponent(item.id)}`, { proration_behavior: 'create_prorations' });
  else if (item) await stripe('POST', `/subscription_items/${encodeURIComponent(item.id)}`, { quantity: n, proration_behavior: 'create_prorations' });
  else if (n > 0) await stripe('POST', '/subscription_items', { subscription: sub.id, price, quantity: n, proration_behavior: 'create_prorations' });
  const fresh = await latest(sub.id);
  if (fresh) applySubscription(ws.id, fresh);
  return seatsFor(getWorkspace(ws.id));
}

/* ---------------- Webhooks ---------------- */
// Stripe signs each webhook: header "t=<time>,v1=<hmac>". Reject anything unsigned, wrong or old.
export function verifySignature(raw, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  const parts = String(header || '').split(',').map(x => x.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new Error('Missing signature.');
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new Error('Signature is too old.');
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  const ok = sigs.some(s => { const got = Buffer.from(s, 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
  if (!ok) throw new Error('Signature doesn’t match.');
  return true;
}

function findWorkspace(obj) {
  const meta = obj?.metadata?.workspace || obj?.client_reference_id;
  if (validWs(meta) && getWorkspace(meta)) return meta;
  const cust = obj?.object === 'customer' ? obj.id : obj?.customer, sub = obj?.object === 'subscription' ? obj.id : obj?.subscription;
  const ws = listWorkspaces().find(w => (cust && w.billing?.customerId === cust) || (sub && w.billing?.subscriptionId === sub));
  return ws?.id || null;
}

function applySubscription(wsId, sub) {
  // The plan is the item whose price is a plan; assistant seats are their own item (a quantity).
  const items = sub.items?.data || [];
  const isPlan = i => planList().some(p => p.priceId === i?.price?.id || (p.yearlyPriceId && p.yearlyPriceId === i?.price?.id));
  const item = items.find(isPlan) || items.find(i => !seatPrices().includes(i?.price?.id)) || items[0];
  const seatItem = items.find(i => seatPrices().includes(i?.price?.id)) || null;
  const priceId = item?.price?.id;
  const match = planList().find(p => p.priceId === priceId || (p.yearlyPriceId && p.yearlyPriceId === priceId));
  const plan = match?.id, interval = match ? (match.yearlyPriceId === priceId ? 'year' : 'month') : '';
  const end = sub.current_period_end ?? item?.current_period_end;   // moved to items in newer Stripe API versions
  updateWorkspace(wsId, ws => ({
    billing: {
      ...ws.billing,
      status: sub.status, plan: plan || ws.billing?.plan || '', interval: interval || ws.billing?.interval || '', subscriptionId: sub.id, customerId: sub.customer || ws.billing?.customerId,
      periodEnd: end ? new Date(end * 1000).toISOString() : '', cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      trialUsed: ws.billing?.trialUsed || !!sub.trial_end, trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : '', updatedAt: new Date().toISOString(),
      seats: sub.status === 'canceled' ? 0 : Math.max(0, Number(seatItem?.quantity) || 0),
    },
  }));
}

// Always re-read the subscription from Stripe, so events arriving out of order can't leave an old status.
// The card on file (brand, last 4, expiry month) for the expiry calendar: from the customer's default
// payment method, or the subscription's. Saved on the workspace as billing.card. Returns it, or null.
export async function refreshCard(wsId) {
  const ws = getWorkspace(wsId), b = ws?.billing || {};
  if (!billingOn() || !b.customerId) return null;
  let pm = null;
  try {
    const cust = await stripe('GET', `/customers/${encodeURIComponent(b.customerId)}`, { 'expand[]': 'invoice_settings.default_payment_method' });
    pm = cust?.invoice_settings?.default_payment_method;
    if (!pm?.card && b.subscriptionId) pm = (await stripe('GET', `/subscriptions/${encodeURIComponent(b.subscriptionId)}`, { 'expand[]': 'default_payment_method' }))?.default_payment_method;
  } catch (e) { console.error('[billing] card:', e.message); return null; }
  const c = pm?.card;
  if (!c?.exp_month || !c?.exp_year) return null;
  const card = { brand: String(c.brand || ''), last4: String(c.last4 || ''), exp: `${c.exp_year}-${String(c.exp_month).padStart(2, '0')}`, at: new Date().toISOString() };
  updateWorkspace(wsId, w => ({ billing: { ...w.billing, card } }));
  return card;
}
// Daily: the card of each paying workspace whose card isn't known yet, or ends within 60 days (it may
// have been replaced since), at most once a week each.
export async function refreshCards(now = Date.now()) {
  if (!billingOn()) return 0;
  let n = 0;
  for (const w of listWorkspaces()) {
    const b = w.billing || {}, c = b.card;
    if (!b.customerId || !['active', 'trialing', 'past_due'].includes(b.status)) continue;
    const soon = c?.exp && Date.parse(`${c.exp}-01T00:00:00Z`) - now < 60 * 86400000;
    if (c && (!soon || now - Date.parse(c.at || 0) < 7 * 86400000)) continue;
    if (await refreshCard(w.id)) n++;
  }
  return n;
}
// The day a card stops working: the last day of its expiry month.
export const cardEnds = exp => { const [y, m] = String(exp || '').split('-').map(Number); return y && m ? new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) : ''; };

async function latest(sub) {
  try { return await stripe('GET', `/subscriptions/${encodeURIComponent(sub.id || sub)}`); } catch { return typeof sub === 'object' ? sub : null; }
}

export async function handleWebhook(raw, header) {
  verifySignature(raw, header, env.STRIPE_WEBHOOK_SECRET);
  const event = JSON.parse(raw);
  const seen = readJSON(EVENTS, []);
  if (seen.includes(event.id)) return { duplicate: true, type: event.type };
  const obj = event.data?.object || {};
  let wsId = null;
  switch (event.type) {
    case 'checkout.session.completed': {
      wsId = findWorkspace(obj);
      if (!wsId) break;
      updateWorkspace(wsId, ws => ({ billing: { ...ws.billing, customerId: obj.customer || ws.billing?.customerId, subscriptionId: obj.subscription || ws.billing?.subscriptionId } }));
      if (obj.subscription) { const sub = await latest(obj.subscription); if (sub) applySubscription(wsId, sub); }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      wsId = findWorkspace(obj);
      if (!wsId) break;
      const sub = event.type.endsWith('deleted') ? obj : await latest(obj);
      applySubscription(wsId, sub || obj);
      break;
    }
    case 'customer.subscription.trial_will_end': {
      // Stripe sends this three days before a trial ends: tell the agent (once per subscription).
      wsId = findWorkspace(obj);
      if (!wsId) break;
      const sub = await latest(obj);
      if (sub) applySubscription(wsId, sub);
      await sendTrialEnding(wsId);
      break;
    }
    case 'invoice.paid': {
      // A referred agent's first real payment: their referrer gets a month's credit (once).
      wsId = findWorkspace(obj);
      if (wsId && Number(obj.amount_paid) > 0) await creditReferrer(wsId);
      if (wsId) await refreshCard(wsId);   // the card on file, for the expiry calendar
      break;
    }
    case 'customer.updated':
    case 'payment_method.attached': {
      // A new card: its expiry, for the calendar.
      wsId = findWorkspace(obj);
      if (wsId) await refreshCard(wsId);
      break;
    }
    case 'invoice.payment_failed': {
      wsId = findWorkspace(obj);
      if (wsId) {
        updateWorkspace(wsId, ws => ({ billing: { ...ws.billing, paymentFailedAt: new Date().toISOString() } }));
        notify({ level: 'warning', kind: 'billing', title: 'A payment failed', text: 'Stripe couldn’t charge this workspace’s card.', did: 'Nothing changes yet: Stripe retries the card on its own schedule, and the agent sees a note in Billing.', run: 'If it keeps failing, ask the agent to update their card in Billing.', ws: wsId, workspaceName: getWorkspace(wsId)?.name });
        await emailWorkspace(wsId, paymentFailedEmail());
      }
      break;
    }
    default: break;
  }
  updateJSON(EVENTS, [], list => [...list, event.id].slice(-1000));
  updateJSON(STATUS, {}, () => ({ lastAt: new Date().toISOString(), lastType: event.type }));
  return { type: event.type, workspace: wsId };
}

/* ---------------- Referrals ---------------- */
// Each workspace has a code (shown in Billing). Someone who asks for access with it, and is invited,
// is "referred" by that workspace. When they first pay, the referrer's Stripe balance gets a credit
// worth one month of the referrer's plan, which Stripe takes off their next invoice. Credits stack,
// so three referrals are three free months. Each referred workspace credits once.
const CODE_RE = /^[A-Z]{2,6}-[2-9A-HJ-NP-Z]{4}$/;
export function referralCode(wsId) {
  const ws = getWorkspace(wsId);
  if (!ws) return '';
  if (ws.referralCode) return ws.referralCode;
  const letters = String(ws.name || 'AGENT').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6).padEnd(2, 'X');
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const code = `${letters}-${Array.from(crypto.randomBytes(4), b => alphabet[b % alphabet.length]).join('')}`;
  updateWorkspace(wsId, { referralCode: code });
  return code;
}
export function workspaceForCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) return null;
  return listWorkspaces().find(w => w.referralCode === c) || null;
}
// One month of the referrer's plan, in cents (a yearly plan: a twelfth of the year).
async function monthOf(ws) {
  const plans = await plansWithPrices();
  const p = plans.find(x => x.id === ws.billing?.plan);
  if (!p) return null;
  if (ws.billing?.interval === 'year' && p.yearly?.amount != null) return { amount: Math.round(p.yearly.amount / 12), currency: p.yearly.currency };
  return p.amount != null ? { amount: p.interval === 'year' ? Math.round(p.amount / 12) : p.amount, currency: p.currency } : null;
}
export async function creditReferrer(referredId) {
  const w = getWorkspace(referredId);
  if (!w?.referredBy || w.referral?.creditedAt || w.referral?.skipped) return null;
  const ref = getWorkspace(w.referredBy);
  const skip = why => { updateWorkspace(referredId, { referral: { skipped: why, at: new Date().toISOString() } }); notify({ level: 'info', kind: 'billing', title: 'Referral not credited', text: `${w.name} was referred by ${ref?.name || 'a workspace'}, but no credit was given: ${why}`, ws: referredId, workspaceName: w.name }); return null; };
  if (!ref) return skip('the referring workspace no longer exists.');
  if (ref.comped || !ref.billing?.customerId || !['active', 'trialing', 'past_due'].includes(ref.billing?.status)) return skip('the referring workspace has no paid plan to credit.');
  const m = await monthOf(ref);
  if (!m?.amount) return skip('couldn’t read the referrer’s plan price from Stripe.');
  await stripe('POST', `/customers/${encodeURIComponent(ref.billing.customerId)}/balance_transactions`, { amount: -m.amount, currency: m.currency || 'usd', description: `Referral credit: ${w.name}`, metadata: { referred_workspace: referredId } }, { idempotencyKey: `referral-credit-${referredId}` });
  updateWorkspace(referredId, { referral: { creditedAt: new Date().toISOString(), referrer: ref.id, amount: m.amount, currency: m.currency || 'usd' } });
  updateWorkspace(ref.id, w2 => ({ referralCredits: [...(w2.referralCredits || []), { at: new Date().toISOString(), from: w.name, amount: m.amount, currency: m.currency || 'usd' }].slice(-50) }));
  notify({ level: 'info', kind: 'billing', title: 'Referral credited', text: `${ref.name} got a free month (${(m.amount / 100).toFixed(2)} ${String(m.currency || 'usd').toUpperCase()} credit) for referring ${w.name}.`, ws: ref.id, workspaceName: ref.name });
  return { referrer: ref.id, amount: m.amount };
}
