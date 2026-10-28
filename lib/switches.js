// lib/switches.js — the switchboard: turn a part of the app off without an update, for everyone or for
// one workspace, so one misbehaving part can be isolated while the rest keeps running. Set in Admin.
//
//   videos     making new videos (the line keeps them; they start again when it's back on)
//   overnight  overnight top-ups, the Monday plan and posting-plan refills
//   autopost   posting to Instagram and Facebook (scheduled posts wait)
//   coach      the coach and the AI helpers in Studio and Content
//   emails     emails (held up to 3 days, then sent when it's back on)
//   push       phone notifications (skipped while off)
//   replies    keyword replies on Instagram (v15: comments and messages that come in meanwhile get none)
//
// Global switches are in data/switches.json; a workspace's own are on its record (switches: {...}).
// Off anywhere means off. Each switch keeps who turned it off, when and why (shown in Admin).
import path from 'path';
import { DIRS, readJSON, updateJSON, docVersion } from './paths.js';

export const SWITCHES = {
  videos: { label: 'Making videos', off: 'Making videos is paused for maintenance. Your videos in line will start by themselves when it’s back.' },
  overnight: { label: 'Overnight videos and plans', off: 'Overnight videos are paused for maintenance.' },
  autopost: { label: 'Posting to Instagram and Facebook', off: 'Posting is paused for maintenance. Scheduled posts go out by themselves when it’s back.' },
  coach: { label: 'The coach and AI helpers', off: 'The coach is paused for maintenance. It’s back soon.' },
  emails: { label: 'Emails', off: 'Emails are paused; they’ll be sent when it’s back on.' },
  push: { label: 'Phone notifications', off: 'Notifications are paused.' },
  replies: { label: 'Keyword replies on Instagram', off: 'Automatic replies are paused for maintenance.' },
};
const FILE = path.join(DIRS.data, 'switches.json');
let cache = { ver: undefined, data: {} };
export function globalSwitches() {
  const ver = docVersion(FILE);
  if (ver !== null && ver === cache.ver) return cache.data;
  let data = {};
  try { data = readJSON(FILE, {}) || {}; } catch { data = {}; }
  cache = { ver, data };
  return data;
}
// Is this part on (for this workspace, if given)? `ws`: a workspace record, or null for the whole app.
export function isOn(name, ws = null) {
  if (globalSwitches()[name]?.off) return false;
  return !ws?.switches?.[name]?.off;
}
// Why it's off, in words for an agent (or '' when it's on).
export const offText = (name, ws = null) => (isOn(name, ws) ? '' : SWITCHES[name]?.off || 'This is paused for maintenance.');
export function setGlobal(name, off, { by = '', why = '' } = {}) {
  if (!SWITCHES[name]) throw Object.assign(new Error('Unknown switch.'), { status: 400 });
  updateJSON(FILE, {}, all => ({ ...all, [name]: off ? { off: true, at: new Date().toISOString(), by, why: String(why || '').slice(0, 200) } : { off: false, at: new Date().toISOString(), by } }));
  cache.ver = undefined;
  return globalSwitches()[name];
}
// For one workspace (the caller saves it on the workspace record: store.updateWorkspace).
export function workspacePatch(ws, name, off, { by = '', why = '' } = {}) {
  if (!SWITCHES[name]) throw Object.assign(new Error('Unknown switch.'), { status: 400 });
  return { switches: { ...(ws?.switches || {}), [name]: off ? { off: true, at: new Date().toISOString(), by, why: String(why || '').slice(0, 200) } : { off: false, at: new Date().toISOString(), by } } };
}
// Every switch with its global state (Admin).
export const board = () => Object.entries(SWITCHES).map(([id, s]) => ({ id, label: s.label, ...(globalSwitches()[id] || { off: false }) }));
