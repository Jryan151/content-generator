// lib/roles.js — who can do what in a workspace.
//
// Every login belongs to one or more workspaces (memberships). In each it has a role, and the role
// plus the kind of workspace give a set of capabilities:
//
//   owner      the agent whose workspace it is. In a solo workspace they can do everything. In a
//              managed (done-for-you) workspace the team runs the content, brand and settings, so
//              the agent reviews, posts, makes videos, coaches and asks the team for changes.
//   assistant  someone helping the agent (a paid seat, v14 Phase 7): prepares and fixes videos,
//              replies, client follow-ups. Never approves (the licensed agent does), never sees the
//              agent's Mindset, billing or data. Posts only if the agent allows it (canPost).
//   reviewer   a compliance reviewer (v15 Phase 9, lib/signoff.js): signs off approved videos before
//              they post, or sends them back with a note. Sees only the Sign-off page; no seat needed.
//   admin      the platform owner (you), working in any workspace from Admin: everything but signing
//              off (that's the reviewer's alone).
//
// Older accounts have only `workspaceId`: that's read as being the owner of that one workspace.
// The server checks the capability of every route (server.js ROUTE_CAPS); the portal uses the same
// list to show only what each person can use.
export const CAPS = {
  view: 'See the workspace’s videos and lists',
  approve: 'Approve and reject videos (the licensed agent’s decision)',
  post: 'Post and schedule to Instagram and Facebook, and mark videos posted',
  make: 'Make videos, use Studio, fix scenes and choose covers',
  settings: 'Change content, brand, voice and settings',
  setup: 'Finish the first setup',
  connect: 'Connect Instagram and Facebook',
  coach: 'Use the coach',
  replies: 'Draft replies to messages',
  clients: 'Client list and follow-ups',
  results: 'Add views and messages to posted videos',
  mindset: 'The Mindset tab (personal)',
  billing: 'Plans and payment',
  people: 'Invite and remove people in the workspace',
  data: 'Download the workspace’s data, or ask for it to be deleted',
  requests: 'Ask the team for changes (done-for-you workspaces)',
  signoff: 'Sign off approved videos before they post (the compliance reviewer)',
};
const ALL = Object.keys(CAPS).filter(c => c !== 'signoff');
export const ROLES = {
  owner: { label: 'Agent (owner)', solo: ALL.filter(c => c !== 'requests'), managed: ALL.filter(c => c !== 'settings') },
  assistant: { label: 'Assistant', solo: ['view', 'make', 'coach', 'replies', 'clients', 'results'], managed: ['view', 'make', 'coach', 'replies', 'clients', 'results', 'requests'] },
  reviewer: { label: 'Compliance reviewer', solo: ['signoff'], managed: ['signoff'] },
};

// An account's memberships: [{ ws, role, canPost? }].
export function membershipsOf(account) {
  if (!account || account.role === 'admin') return [];
  const list = Array.isArray(account.memberships) ? account.memberships.filter(m => m && m.ws && ROLES[m.role]) : [];
  if (account.workspaceId && !list.some(m => m.ws === account.workspaceId)) list.unshift({ ws: account.workspaceId, role: 'owner' });
  return list;
}
export const membership = (account, wsId) => membershipsOf(account).find(m => m.ws === wsId) || null;
export const isMember = (account, wsId) => !!membership(account, wsId);

// The capabilities of an account in a workspace (a workspace record, for whether it's managed).
export function capsFor(account, ws, { managed = false } = {}) {
  if (!account || !ws) return [];
  if (account.role === 'admin') return ALL.filter(c => (c !== 'requests' || managed) && (c !== 'setup' || !ws.onboarded));
  const m = membership(account, ws.id);
  if (!m) return [];
  const caps = [...ROLES[m.role][managed ? 'managed' : 'solo']];
  if (m.role === 'assistant' && m.canPost) caps.push('post');
  if (m.role === 'assistant' && m.canEdit && !managed) caps.push('settings');   // the agent can let them edit content too
  if (!ws.onboarded && m.role === 'owner') caps.push('settings');   // setup comes first, solo or managed
  return [...new Set(caps)].filter(c => c !== 'setup' || !ws.onboarded);   // setup happens once
}
export const can = (caps, cap) => caps.includes(cap);

// Which portal someone sees: the platform owner's (Admin), a managed agent's, or a solo agent's.
export function portalFor(account, ws, { managed = false } = {}) {
  if (account?.role === 'admin') return ws ? 'owner-acting' : 'owner';
  const m = ws && membership(account, ws.id);
  if (m?.role === 'assistant') return 'assistant';
  if (m?.role === 'reviewer') return 'reviewer';
  return managed ? 'managed' : 'solo';
}
