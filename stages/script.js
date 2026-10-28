// stages/script.js — Stage 1: write the script.
// Builds the prompt from the config, writes 1-3 drafts, checks each in code
// (hard problems get two fix attempts), and if several pass, a critic call picks the best.
// Then writes the Instagram post text, checked with the same rules.
import { chatJSON } from '../lib/ai.js';
import { roll, validateScript, validatePost, validateHook, LIMITS, withAiVoiceNote, beatPlan, factsOf } from '../mixer-core.js';
import { buildPrompt, buildCriticPrompt, buildPostPrompt, buildHookPrompt, buildHookCriticPrompt, scriptSchema, hookSchema, hookCriticSchema, criticSchema, postSchema } from '../lib/prompts.js';

async function writeDraft(n, cfg, picks, prompt, ask, log) {
  const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
  const opts = { job: 'writer', schema: scriptSchema(cfg) };
  let reply = await ask(messages, 0.8, opts);
  let check = validateScript(reply, cfg, picks);
  // Hard problems get two fix attempts; soft ones (similar bridge/CTA wording) get one, then are let go.
  for (let attempt = 1; attempt <= 2 && (!check.ok || (attempt === 1 && check.soft?.length)); attempt++) {
    log(`Draft ${n}: fixing ${check.problems.length} problem(s), attempt ${attempt}: ${check.problems.join(' | ')}`);
    messages.push(
      { role: 'assistant', content: reply },
      { role: 'user', content: 'Fix only these problems, keep everything else, and return the full JSON again:\n- ' + check.problems.join('\n- ') },
    );
    reply = await ask(messages, 0.8, opts);
    check = validateScript(reply, cfg, picks);
  }
  log(`Draft ${n}: ${check.ok ? 'passed all checks' + (check.soft?.length ? ` (noted: ${check.soft.join(' | ')})` : '') : 'failed: ' + check.problems.filter(p => !check.soft?.includes(p)).join(' | ')}`);
  if (check.ok) check.problems = [];
  return { n, ok: check.ok, problems: check.problems, scenes: check.data?.scenes || null };
}

// Post text for under the Reel (one retry). Blank if it can't pass the checks.
export async function writePost(cfg, picks, scenes, ask, log) {
  try {
    const pp = buildPostPrompt(cfg, picks, scenes);
    const msgs = [{ role: 'system', content: pp.system }, { role: 'user', content: pp.user }];
    const opts = { job: 'writer', schema: postSchema() };
    let reply = await ask(msgs, 0.7, opts), pc = validatePost(reply, cfg, picks);
    if (!pc.ok) {
      msgs.push({ role: 'assistant', content: reply }, { role: 'user', content: 'Fix these problems and return the JSON again:\n- ' + pc.problems.join('\n- ') });
      reply = await ask(msgs, 0.7, opts); pc = validatePost(reply, cfg, picks);
    }
    if (pc.ok) {
      // Voiceover posts say the voice is AI (Brand setting). The note passes the same checks.
      const text = withAiVoiceNote(pc.text, cfg);
      if (text === pc.text || validatePost(JSON.stringify({ caption: text }), cfg, picks).ok) return text;
      log('The AI voice note failed the post checks, so it was left off.');
      return pc.text;
    }
    log('Post text failed checks, leaving it blank: ' + pc.problems.join(' | '));
  } catch (e) { log('Post text failed: ' + e.message); }
  return '';
}

// Hook-first: write several openings, drop any that break a rule, have a critic rank the rest.
// Returns the best few (one per draft), or [] so the drafts write their own opening.
export async function writeHooks(cfg, picks, ask, log, want = 2) {
  try {
    const hp = buildHookPrompt(cfg, picks, 8);
    const out = JSON.parse(await ask([{ role: 'system', content: hp.system }, { role: 'user', content: hp.user }], 0.9, { job: 'hooks', schema: hookSchema(cfg) }));
    const seen = new Set();
    const hooks = (out.hooks || []).map(h => ({ text: String(h.text || '').replace(/\s+/g, ' ').trim(), ...(h.say ? { say: String(h.say).replace(/\s+/g, ' ').trim() } : {}) }))
      .filter(h => { const k = h.text.toLowerCase(); if (!h.text || seen.has(k)) return false; seen.add(k); return true; })
      .filter(h => !(picks.turnedDown || []).some(x => String(x).toLowerCase() === h.text.toLowerCase()));   // never an opening they turned down
    const valid = hooks.filter(h => !validateHook(h, cfg, picks).length);
    log(`Hooks: ${hooks.length} written, ${valid.length} passed the rules.`);
    if (valid.length <= 1) return valid;
    const cp = buildHookCriticPrompt(cfg, picks, valid);
    const r = JSON.parse(await ask([{ role: 'system', content: cp.system }, { role: 'user', content: cp.user }], 0.2, { job: 'critic', schema: hookCriticSchema() }));
    const ranked = (r.ranked || []).map(x => ({ h: valid[Number(x.n) - 1], score: Number(x.score) || 0, why: String(x.why || '') })).filter(x => x.h);
    const order = [...ranked, ...valid.filter(h => !ranked.some(x => x.h === h)).map(h => ({ h, score: 0, why: '' }))];
    order.slice(0, want).forEach((x, i) => log(`Hook ${i + 1}${x.score ? ` (${x.score}/10)` : ''}: "${x.h.text}"${x.why ? ` — ${x.why}` : ''}`));
    return order.slice(0, want).map(x => ({ ...x.h, score: x.score, why: x.why }));
  } catch (e) {
    log('Hook step skipped: ' + e.message);
    return [];
  }
}

// ask(messages, temperature, { job, schema }): job picks the model (lib/openai.js modelFor).
export const makeAsk = meter => (messages, temperature = 0.8, { job = 'writer', schema = null } = {}) => chatJSON({ messages, temperature, meter, job, schema });

// `recent`: the workspace's recent scripts. `examples`: scripts the agent approved.
// `winners`: openings of posted videos that brought messages. `withPost`: also write the post text.
// `force`: { painId, insightId, format, perf } for a chosen topic or format, and results boosts.
export async function generateScript({ cfg, recent = [], examples = [], winners = [], turnedDown = [], force = {}, meter = null, ask = makeAsk(meter), log = console.log, picks = roll(cfg, Math.random, recent, force), withPost = true }) {
  if (!picks.insight) throw Object.assign(new Error(picks.breaks[0] || 'No confirmed facts to make a video from.'), { permanent: true });
  log(`Format: ${picks.format}${picks.structure && picks.structure !== 'classic' ? ` · Structure: ${picks.structure}` : ''} · Topic: ${picks.painPoint?.text || '-'}`);
  picks.breaks.forEach(b => log('[route] ' + b));
  // Style references: approved scripts in this format first.
  picks.winners = winners.slice(0, 4);
  // Openings the agent rejected as weak (memory): not already in the recent list, newest first.
  const inRecent = new Set(recent.map(r => String(r.hook || '').toLowerCase()));
  picks.turnedDown = [...turnedDown].reverse().filter(h => !inRecent.has(String(h).toLowerCase())).slice(0, 8);
  picks.examples = [...examples.filter(e => e.format === picks.format), ...examples.filter(e => e.format !== picks.format)].slice(0, 2);
  const count = Math.min(LIMITS.drafts[1], Math.max(1, cfg.output.drafts || 1));
  // An opening the agent already chose (Studio) is kept: no hook step.
  const hooks = picks.hook ? [] : await writeHooks(cfg, picks, ask, log, count);

  // Each draft gets its own top hook, so the critic compares different openings.
  const drafts = await Promise.all(Array.from({ length: count }, (_, i) => {
    const p = hooks.length ? { ...picks, hook: hooks[i % hooks.length] } : picks;
    return writeDraft(i + 1, cfg, p, buildPrompt(cfg, p), ask, log).then(d => ({ ...d, hook: p.hook || null }));
  }));
  const valid = drafts.filter(d => d.ok);
  if (!valid.length) throw new Error('No draft passed the checks. ' + drafts.map(d => `Draft ${d.n}: ${d.problems.join(' | ')}`).join(' / '));

  let chosen = valid[0], scores = null;
  if (valid.length > 1) {
    try {
      const cp = buildCriticPrompt(cfg, picks, valid);
      const r = JSON.parse(await ask([{ role: 'system', content: cp.system }, { role: 'user', content: cp.user }], 0.2, { job: 'critic', schema: criticSchema(picks) }));
      scores = (r.scores || []).map(s => ({ ...s, draft: valid[s.draft - 1]?.n ?? s.draft }));
      chosen = valid[(r.best || 1) - 1] || valid[0];
      log(`Critic picked draft ${chosen.n}.`);
    } catch (e) {
      log('Critic failed, using the first passing draft: ' + e.message);
    }
  }

  picks.hook = chosen.hook || null;
  const post = withPost ? await writePost(cfg, picks, chosen.scenes, ask, log) : '';
  return packScript(cfg, picks, chosen.scenes, { post, chosen: chosen.n, drafts, scores, hooks });
}

// The result every script writer returns (generateScript, and Studio's own scripts): the scenes and
// post text, what the next scripts should avoid repeating, and what the video was made from.
export function packScript(cfg, picks, scenes, { post = '', chosen = 1, drafts = [], scores = null, hooks = [], source = '' } = {}) {
  const prompt = buildPrompt(cfg, picks);
  const sc = scenes, n = sc.length;
  const line = x => (x ? String(x.say || x.text || '') : '');
  // The bridge scene, if this structure has one ("Straight to you" doesn't).
  const bridgeAt = beatPlan(n, picks.format, Math.max(1, factsOf(picks).length), picks.structure || 'classic').find(b => b.beat === 'Bridge')?.from;
  return {
    scenes,
    post,
    chosen,
    drafts,
    scores,
    picks,
    prompt: { system: prompt.system, user: prompt.user },
    // What the next scripts should avoid repeating.
    remember: { shots: picks.shots || null, format: picks.format, structure: picks.structure || 'classic', bridgeStyle: picks.bridgeStyle || '', ctaStyle: picks.ctaStyle || '', insightId: picks.insight?.id, painId: picks.painPoint?.id, audienceId: picks.audience?.id, storyId: picks.story?.id, questionId: picks.askQuestion?.id, hook: line(sc[0]), bridge: bridgeAt ? line(sc[bridgeAt - 1]) : '', cta: line(sc[n - 1]) },
    hooks,
    meta: {
      audience: picks.audience?.text, audienceId: picks.audience?.id,
      visual: picks.audience?.visual,
      painPoint: picks.painPoint?.text, painId: picks.painPoint?.id,
      insight: picks.insight?.text, insightId: picks.insight?.id,
      ...(picks.noFact ? { noFact: true } : {}),   // a Studio video that teaches no specific fact (v15)
      facts: (picks.insights || []).map(i => ({ id: i.id, text: i.text, source: i.source || '', confirmedAt: i.confirmedAt || '' })),
      storyId: picks.story?.id || '', questionId: picks.askQuestion?.id || '',
      insightSource: picks.insight?.source || '', insightConfirmedAt: picks.insight?.confirmedAt || '',
      solution: picks.solution?.text, solutionId: picks.solution?.id,
      question: picks.question,
      mode: cfg.output.mode, format: picks.format, structure: picks.structure || 'classic', ...(picks.shots ? { shots: picks.shots } : {}),
      energy: cfg.voice.energy, tone: cfg.voice.tone,
      ...(source ? { madeIn: source } : {}),
      ...(picks.series ? { series: picks.series } : {}),
    },
  };
}
