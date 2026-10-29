// lib/roles.js — who can do what in a workspace.
//
// Every login belongs to one or more workspaces (memberships). In each it has a role, and the role
// gives a set of capabilities:
//
//   owner      the agent whose workspace it is: everything but signing off.
//   reviewer   a compliance reviewer (lib/signoff.js): signs off approved videos before they post, or
//              sends them back with a note. Sees only the Sign-off page.
//   teammate   an agent or recruit on the owner's team in Agent Reels (lib/reels.js): their own calls,
//              pipeline and ladder there, and nothing else in the workspace (no videos, no settings).
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
  replies: 'Keyword replies and drafting replies to messages',
  results: 'Add views and messages to posted videos',
  mindset: 'The Mindset tab (personal)',
  people: 'Invite and remove the compliance reviewer',
  data: 'Download the workspace’s data, or ask for it to be deleted',
  signoff: 'Sign off approved videos before they post (the compliance reviewer)',
  team: 'Use Agent Reels: your own calls, pipeline and ladder',
  teamlead: 'See your team in Agent Reels, invite agents and take them off',
};
const ALL = Object.keys(CAPS).filter(c => c !== 'signoff');
export const ROLES = {
  owner: { label: 'Agent (owner)', caps: ALL },
  reviewer: { label: 'Compliance reviewer', caps: ['signoff'] },
  teammate: { label: 'Agent on the team (Agent Reels)', caps: ['team'] },
};

// An account's memberships: [{ ws, role }].
export function membershipsOf(account) {
  if (!account || account.role === 'admin') return [];
  const list = Array.isArray(account.memberships) ? account.memberships.filter(m => m && m.ws && ROLES[m.role]) : [];
  if (account.workspaceId && !list.some(m => m.ws === account.workspaceId)) list.unshift({ ws: account.workspaceId, role: 'owner' });
  return list;
}
export const membership = (account, wsId) => membershipsOf(account).find(m => m.ws === wsId) || null;
export const isMember = (account, wsId) => !!membership(account, wsId);

// The capabilities of an account in a workspace (a workspace record).
export function capsFor(account, ws) {
  if (!account || !ws) return [];
  if (account.role === 'admin') return ALL.filter(c => c !== 'setup' || !ws.onboarded);
  const m = membership(account, ws.id);
  if (!m) return [];
  return ROLES[m.role].caps.filter(c => c !== 'setup' || !ws.onboarded);   // setup happens once
}
export const can = (caps, cap) => caps.includes(cap);

// Which portal someone sees: the platform owner's (Admin), a reviewer's, or the agent's.
export function portalFor(account, ws) {
  if (account?.role === 'admin') return ws ? 'owner-acting' : 'owner';
  const m = ws && membership(account, ws.id);
  if (m?.role === 'reviewer') return 'reviewer';
  if (m?.role === 'teammate') return 'teammate';
  return 'solo';
}
