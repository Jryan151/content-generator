// lib/allowance.js — can this workspace make videos, and how many a month?
// There are no plans or payments: a workspace makes videos unless it's paused. Admin can set a monthly
// cap per workspace (videosPerMonth); otherwise MONTHLY_VIDEOS (default 200) keeps a runaway loop from
// making hundreds. The AI spend cap (lib/usage.js) still applies on top.
const DEFAULT_LIMIT = () => Math.max(1, Number(process.env.MONTHLY_VIDEOS || 200));

export function access(ws) {
  if (!ws) return { allowed: false, reason: 'Workspace not found.', limit: 0 };
  if (ws.suspended) return { allowed: false, reason: 'This workspace is paused. Contact your admin.', limit: 0 };
  return { allowed: true, limit: Number(ws.limits?.videosPerMonth) || DEFAULT_LIMIT() };
}
