// routes/setup.js — Config and setup; The full prompt (admins only).
// Split out of server.js by area (v15). server.js mounts it, passing in the helpers these routes share
// with the rest of the server; the capability each route needs is still listed in one place
// (server.js ROUTE_CAPS). The code below is as it was in server.js (not re-indented, so its text and
// templates are unchanged).
import * as store from '../lib/store.js';
import * as usage from '../lib/usage.js';
import * as audit from '../lib/audit.js';
import { answersFrom, draftConfig, personalize, stampFacts, confirmedCount } from '../lib/onboarding.js';
import { buildPrompt } from '../lib/prompts.js';
import { migrate, DEFAULT_CONFIG, roll } from '../mixer-core.js';

export default function mount(ctx) {
const { TERMS_TEXT, api, bad, clip, draftLimit, mindset, needsTerms, nowIso, overCap, route, termsStamp, who, wsSummary } = ctx;
/* ----- Config and setup ----- */
// The agent's Mindset profile (their why, objections) is theirs: others get the config without it.
const forViewer = (cfg, caps) => (caps.includes('mindset') ? cfg : { ...cfg, mindset: { ...DEFAULT_CONFIG.mindset } });
route('GET', '/api/config', 'ws', ({ wsId, caps }) => ({ config: forViewer(store.loadConfig(wsId), caps), versions: store.listHistory(wsId) }));
route('PUT', '/api/config', 'ws', ({ wsId, body, me, caps }) => {
  if (!body.config || typeof body.config !== 'object') bad(400, 'Send { config }.');
  const prev = store.loadConfig(wsId);
  const next = stampFacts(prev, migrate(body.config), me.account.id);
  // The Mindset tab saves its own part straight away; a config save never overwrites it.
  next.mindset = prev.mindset;
  // Someone who can't post (an assistant allowed to edit content) can't change the posting plan either.
  if (!caps.includes('post')) next.schedule = { ...next.schedule, autopost: prev.schedule.autopost };
  return { config: store.saveConfig(wsId, next), versions: store.listHistory(wsId) };
});
route('GET', '/api/history/:name', 'ws', ({ wsId, params, caps }) => {
  try { return { config: forViewer(store.readHistory(wsId, params.name), caps) }; } catch { bad(404, 'Version not found'); }
});

route('GET', '/api/setup', 'ws', ({ wsId, ws }) => {
  const cfg = store.loadConfig(wsId);
  return { answers: answersFrom(cfg), hasContent: cfg.topics.length > 0, onboarded: ws.onboarded };
});
route('POST', '/api/setup/draft', 'ws', async ({ wsId, ws, body }) => {
  if (ws.onboarded) bad(409, 'Setup is already finished.');
  if (draftLimit.blocked(wsId)) bad(429, 'That’s a lot of drafts this hour. Try again later.');
  draftLimit.fail(wsId);
  const keep = !!body.keepContent;
  let cfg = draftConfig(store.loadConfig(wsId), body.answers || {}, { keepContent: keep });
  let note = '';
  if (!keep && process.env.OPENAI_API_KEY && overCap(store.getWorkspace(wsId))) note = 'AI tailoring is paused this month, so this is the starter content. You can edit it any time.';
  else if (!keep && process.env.OPENAI_API_KEY) {
    try { cfg = await personalize(cfg, { meter: usage.meter(wsId) }); }
    catch { note = 'AI couldn’t tailor the wording this time, so this is the starter content. You can edit it any time.'; }
  }
  return { config: cfg, note };
});
route('POST', '/api/setup/finish', 'ws', ({ wsId, ws, body, me }) => {
  if (ws.onboarded) bad(409, 'Setup is already finished. Change things in Setup’s steps.');
  if (body.accept !== true) bad(400, 'Please confirm you’ll review every video before posting.');
  const askTerms = needsTerms(me.account);
  if (askTerms && body.acceptTerms !== true) bad(400, TERMS_TEXT);
  const prev = store.loadConfig(wsId);
  const next = stampFacts(prev, migrate(body.config || prev), me.account.id);
  next.mindset = prev.mindset;
  if (!next.look.name) bad(400, 'Add your name.');
  if (!confirmedCount(next)) bad(400, 'Check at least one topic’s fact to finish.');
  const saved = store.saveConfig(wsId, next);
  if (askTerms) store.updateAccount(me.account.id, termsStamp());
  store.updateWorkspace(wsId, { onboarded: true, acceptedAt: nowIso(), acceptedBy: me.account.id, ...(/@|^New workspace$/.test(ws.name) ? { name: next.look.name } : {}) });
  return { config: saved, workspace: wsSummary(wsId) };
});

/* ----- The full prompt (admins only) ----- */
// Agents see what goes into a video (Settings), not the prompt text: how prompts are written is
// the product's own work and stays on the server (lib/prompts.js).
route('POST', '/api/prompt-preview', 'ws', ({ wsId, body, me }) => {
  if (me.account.role !== 'admin') bad(403, 'Admins only.');
  const cfg = body.config ? migrate(body.config) : store.loadConfig(wsId);
  const p = body.picks && typeof body.picks === 'object' ? body.picks : roll(cfg, Math.random, store.readRecent(wsId));
  const b = buildPrompt(cfg, { ...p, recent: store.readRecent(wsId) });
  return { system: b.system, sections: b.sections.map(s => ({ bus: s.bus, title: s.title, lines: s.lines })) };
});
}
