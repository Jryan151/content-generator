// routes/replies.js — keyword replies on Instagram (v15 Phase 9, lib/replies.js): the rules, the agent's
// approval, turning them on, a dry run, and what was sent. The webhook Instagram calls is in server.js
// (/hooks/instagram).
import * as store from '../lib/store.js';
import * as roles from '../lib/roles.js';
import * as ig from '../lib/instagram.js';
import * as replies from '../lib/replies.js';

export default function mount(ctx) {
const { bad, clip, route } = ctx;
const view = wsId => {
  const s = replies.state(wsId), acc = ig.account(wsId);
  return { on: !!s.on, rules: s.rules || [], places: replies.PLACES, max: replies.MAX_RULES, perDay: replies.MAX_PER_DAY,
    ready: { server: replies.serverReady(), connected: !!acc.connected && !acc.problem, allowed: ig.canReply(wsId), username: acc.username || '' },
    log: replies.log(wsId).slice(0, 40).map(({ from, commentId, ...x }) => x) };
};
const wrap = fn => { try { return fn(); } catch (e) { bad(e.status || 400, e.message); } };
const isAgent = (me, wsId) => me.account.role === 'admin' || roles.membership(me.account, wsId)?.role === 'owner';

route('GET', '/api/replies', 'ws', ({ wsId }) => view(wsId));
// Written by the agent: approved as written. By an assistant: a draft for the agent to approve.
route('POST', '/api/replies/rules', 'ws', ({ wsId, body, me }) => {
  wrap(() => replies.saveRule(wsId, { id: clip(body.id, 20) || undefined, keyword: clip(body.keyword, 40), where: clip(body.where, 10), text: String(body.text || '').slice(0, 2000) }, { by: me.account.id, byName: me.account.name || me.account.email, approve: isAgent(me, wsId) }));
  return view(wsId);
});
route('POST', '/api/replies/rules/:id/approve', 'ws', ({ wsId, params, me }) => { wrap(() => replies.approveRule(wsId, params.id, { by: me.account.id, byName: me.account.name || me.account.email })); return view(wsId); });
// An assistant can take back their own drafts; the agent can remove any.
route('DELETE', '/api/replies/rules/:id', 'ws', ({ wsId, params, me }) => (replies.removeRule(wsId, params.id, { draftsOnly: !isAgent(me, wsId) }) ? view(wsId) : bad(404, 'Reply not found (only the agent can remove an approved one).')));
route('POST', '/api/replies/on', 'ws', ({ wsId, body }) => {
  if (body.on && !(replies.state(wsId).rules || []).some(r => r.status === 'approved')) bad(409, 'Approve a reply first.');
  replies.setOn(wsId, !!body.on);
  if (body.on && ig.canReply(wsId)) ig.subscribeReplies(wsId).catch(e => console.error('[instagram] replies subscription:', e.message));
  return view(wsId);
});
// A dry run: which reply a comment or message would get, filled in, without sending anything.
route('POST', '/api/replies/try', 'ws', ({ wsId, body }) => {
  const where = body.where === 'dm' ? 'dm' : 'comment', rule = replies.match(wsId, clip(body.text, 300), where);
  if (!rule) return { rule: null };
  const cfg = store.loadConfig(wsId);
  return { rule: { id: rule.id, keyword: rule.keyword }, text: replies.fill(rule.text, { name: 'Maria Garcia', link: where === 'comment' ? `${String(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/r/…` : cfg.look?.bookingUrl || '' }) };
});
}
