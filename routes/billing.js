// routes/billing.js — Billing.
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as billing from '../lib/billing.js';
import * as access from '../lib/access.js';

export default function mount(ctx) {
const { api, bad, baseUrl, route, start } = ctx;
/* ----- Billing ----- */
route('GET', '/api/billing', 'ws', async ({ req, ws }) => {
  const code = billing.billingOn() ? billing.referralCode(ws.id) : '';
  return {
    enabled: billing.billingOn(), comped: ws.comped, trialDays: billing.TRIAL_DAYS(), trialUsed: !!ws.billing?.trialUsed,
    plans: billing.billingOn() ? await billing.plansWithPrices() : [], billing: ws.billing, access: billing.access(ws),
    // Refer an agent: share the link; a free month when they start paying (lib/billing.js).
    referral: code ? { code, link: `${baseUrl(req)}/welcome?ref=${code}#request`, credits: store.getWorkspace(ws.id)?.referralCredits || [] } : null,
  };
});
route('POST', '/api/billing/checkout', 'ws', async ({ req, ws, body, me }) => {
  if (!billing.billingOn()) bad(400, 'Billing isn’t set up on this server.');
  if (ws.comped) bad(400, 'Your workspace is included at no charge.');
  if (['active', 'trialing', 'past_due'].includes(ws.billing?.status)) bad(409, 'You already have a plan. Use Manage billing to change it.');
  return { url: await billing.checkout(ws, body.plan, me.account.email, baseUrl(req), body.interval === 'year' ? 'year' : 'month') };
});
route('POST', '/api/billing/portal', 'ws', async ({ req, ws }) => ({ url: await billing.portal(ws, baseUrl(req)) }));
}
