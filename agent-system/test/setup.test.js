import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyLeaderSetup, emptyAgencyKit, validateLeaderSetup, validateAgencyKit,
  buildSystem, trainingFromPlaybook, LEARN_AFTER_DAYS, premiumForIncome,
} from '../src/setup.js';
import { todoFor, ratesFrom } from '../src/routines.js';
import { actionsFor } from '../src/paths.js';
import { levelProgress } from '../src/ladder.js';
import { buildActivities, TZ, LEADER, MARCUS, TEAM_IDS } from '../seed/sample.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../templates/${f}`, import.meta.url)));

test('her whole setup is three answers', () => {
  const fields = Object.keys(emptyLeaderSetup()).filter((k) => !['version', 'name'].includes(k));
  assert.deepEqual(fields, ['hasAgents', 'start', 'yearlyIncome']);
});

test('nothing filled in still runs, shows no numbers, and says who it is waiting on', () => {
  const s = buildSystem();
  assert.equal(s.path, 'coach');
  assert.equal(s.targetsReady, false, 'no data means the baseline: no guessed targets');
  assert.equal(s.plan, null);
  assert.equal(s.rates, null);
  assert.equal(s.waitingOn.her.length, 3);
  assert.ok(s.waitingOn.you.includes('Playbook: Opening the call'));
  assert.ok(s.waitingOn.you.some((w) => /contract level/.test(w)));
  assert.match(s.waitingOn.learning.at(0), /0 so far/);
  const list = todoFor('2026-10-28', { role: 'builder', path: s.path, plan: s.plan, times: s.times });
  assert.ok(list.length > 0, 'the routine still runs');
  assert.equal(list.find((t) => t.id === 'c-dials').title, 'Your dial block: calls from your list', 'no number is shown, and none is made up');
  assert.ok(list.every((t) => !/\{|\}/.test(t.title)));
});

test('she answers in earnings; her real contract level and her own activity give the numbers', () => {
  const acts = buildActivities();
  const noLevel = buildSystem({ leader: { ...emptyLeaderSetup(), yearlyIncome: 120_000 }, activities: acts, agentIds: [LEADER], tz: TZ });
  assert.equal(noLevel.plan, null, 'without her contract level, no premium and no targets');
  assert.equal(noLevel.yearlyPremium, null);
  const s = buildSystem({ leader: { ...emptyLeaderSetup(), yearlyIncome: 120_000 }, contractPercent: 80, activities: acts, agentIds: [LEADER], tz: TZ });
  assert.equal(s.yearlyPremium, 150_000);
  assert.equal(s.targetsReady, true);
  // Exactly the cascade, by hand, from her own measured rates.
  const r = ratesFrom(acts, { agentIds: [LEADER], strict: true });
  const apps = Math.ceil(150_000 / 12 / r.avgPremium), appts = Math.ceil(apps / r.closeRate);
  const convos = Math.ceil(appts / r.bookingRate), dials = Math.ceil(convos / r.contactRate);
  assert.equal(s.plan.daily.dials, Math.ceil(dials / 21));
  assert.equal(s.plan.daily.conversations, Math.ceil(convos / 21));
  assert.equal(s.rates.contactRate, r.basedOn.conversations / r.basedOn.dials, 'unrounded: her actual ratio');
  assert.equal(premiumForIncome(50_000, 125), 40_000);
  assert.throws(() => premiumForIncome(50_000), /contractPercent/);
  assert.throws(() => buildSystem({ contractPercent: -1 }), /contractPercent/);
});

test('a start preset moves her whole day together', () => {
  const early = buildSystem({ leader: { ...emptyLeaderSetup(), start: 'early' } });
  const late = buildSystem({ leader: { ...emptyLeaderSetup(), start: 'late' } });
  assert.equal(early.times['a-dials'], '08:00');
  assert.equal(late.times['a-dials'], '10:00');
  assert.equal(late.times['c-coach'], '16:00');
  const list = todoFor('2026-10-28', { role: 'agent', plan: early.plan, times: early.times });
  assert.equal(early.plan, null);
  assert.equal(list.at(0).at, '08:00');
});

test('rates are learned from her own logging, never typed and never a starter', () => {
  const acts = buildActivities();
  const s = buildSystem({ leader: { ...emptyLeaderSetup(), yearlyIncome: 96_000 }, contractPercent: 80, activities: acts, agentIds: TEAM_IDS, tz: TZ });
  assert.equal(s.ratesSource, 'learned');
  assert.equal(s.waitingOn.learning.length, 0);
  const few = acts.filter((a) => a.occurred_at < '2026-09-05');
  const t = buildSystem({ leader: { ...emptyLeaderSetup(), yearlyIncome: 96_000 }, contractPercent: 80, activities: few, agentIds: TEAM_IDS, tz: TZ });
  assert.equal(t.ratesSource, 'not yet');
  assert.equal(t.plan, null, 'too little data: no plan rather than a guessed one');
  assert.match(t.waitingOn.learning.at(0), new RegExp(`${LEARN_AFTER_DAYS} days of logged activity`));
  const strict = ratesFrom([{ agent_id: 'x', type: 'dial', occurred_at: '2026-10-01T16:00:00Z' }], { strict: true });
  assert.equal(strict.contactRate, null);
});

test('rules are the standard: the leader setup has no way to change them', () => {
  const s = buildSystem({ leader: { ...emptyLeaderSetup(), redBelow: 0.2, noonCheck: '15:00' } });
  assert.equal(s.thresholds.redBelow, 0.7);
  assert.equal(s.thresholds.noonCheck, '12:00');
});

test('the agency kit (filled by you) supplies playbook, training and promotion rules', () => {
  const kit = read('agency-kit.example.json');
  const s = buildSystem({ leader: { ...emptyLeaderSetup(), hasAgents: true, start: 'standard', yearlyIncome: 120_000 }, kit, contractPercent: 90 });
  assert.deepEqual(s.waitingOn.her, []);
  assert.deepEqual(s.waitingOn.you, []);
  assert.equal(s.playbook.every((p) => !p.isStarter), true);
  assert.match(s.training.at(0).tasks.at(0), /Opening the call/);
  assert.equal(s.playbookReady, true);
  const p = levelProgress({ path: 'coach', metrics: { agentsSelling: 3, agentsDeveloped: 1 }, ladder: s.ladder });
  assert.equal(p.ready, false, 'kit says 4 agents selling, not the starter 3');
});

test('only the kit can reword a message, and it must keep {name}', () => {
  const kit = { ...emptyAgencyKit(), messages: { noon: 'Yo {name}, dials?' } };
  const s = buildSystem({ kit });
  const out = actionsFor({ path: 'coach', dayKey: '2026-10-14', now: '12:05', selfId: LEADER,
    team: [{ id: MARCUS, name: 'Marcus', startedOn: '2026-09-01' }], plan: s.plan, activities: buildActivities(), tz: TZ, messages: s.messages });
  assert.equal(out.find((a) => a.rule === 'noon-zero').message, 'Yo Marcus, dials?');
  assert.equal(validateAgencyKit({ ...emptyAgencyKit(), messages: { noon: 'no name here' } }).ok, false);
});

test('training builds itself from the playbook', () => {
  const t = trainingFromPlaybook([{ title: 'Hello' }, { title: 'Ask' }, { title: 'Show' }, { title: 'Handle' }, { title: 'Close' }]);
  assert.equal(t.length, 4);
  assert.match(t.at(2).tasks.join(' '), /Handle/);
});

test('wrong answers are caught in plain words', () => {
  const bad = validateLeaderSetup({ ...emptyLeaderSetup(), hasAgents: 'yes', start: 'noon', yearlyIncome: -5 });
  assert.equal(bad.errors.length, 3, bad.errors.join('\n'));
  assert.throws(() => buildSystem({ leader: { ...emptyLeaderSetup(), start: 'noon' } }), /start/);
});

test('saved templates match the blank setups', () => {
  assert.deepEqual(read('leader-setup.template.json'), emptyLeaderSetup());
  assert.deepEqual(read('agency-kit.template.json'), emptyAgencyKit());
});
