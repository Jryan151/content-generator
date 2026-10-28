// lib/prompts.js — builds every prompt the script writer sends to the AI: the script, the hooks,
// the two critics and the Instagram post text. Server only: this file is never sent to a browser,
// so the way prompts are written stays private. Agents see their settings and the checks
// (mixer-core.js); admins can preview a full prompt in Settings (POST /api/prompt-preview).
// The rules and validators stay in mixer-core.js, so the portal and server check scripts the same way.
import {
  FORMATS, GOV_TERMS, CLICHES, ABSTRACT_KEYWORDS, POST_FIRST_LINE, beatPlan, guardrailsFor, roleText, firstName, cityOf,
  factsOf, solutionsOf, isVoice, accentOn, qualifiersIn, firstWords, SHOT_TYPES,
} from '../mixer-core.js';
import { nicheOf } from '../niches/index.js';
import { normStyle, styleLabel, styleRules, styleGuide } from '../comms-core.js';

// How each format opens. {city}, {first} and {count} are filled in when the prompt is built.
export const FORMAT_HOOKS = {
  question: 'Open with their worry as a direct, everyday question to "you".',
  myth: 'Open with a common belief people in this situation have, clearly framed as what many people think (for example "A lot of people think…"), never stated as fact.',
  didyouknow: 'Open with the most surprising part of the fact as a short statement, not a question, keeping its qualifier.',
  ifyoure: `Open with "If you're…" naming their exact situation in everyday words, then the worry.`,
  asked: 'Open with the question people in this situation ask {first}, in their own words. Never claim a specific client said it.',
  local: 'Open by grounding it locally, like "Here in {city}…" or "A lot of families around {city}…", then the worry. Never invent local facts, places or statistics.',
  list: 'Open by promising exactly {count} things about their worry, like "{count} things to know before…". The number must match the facts given.',
  mistake: 'Open by naming a common, honest mistake people in this situation make, like "One mistake I see a lot…", without blaming or scaring them.',
  compare: 'Open with a simple either-or question about the two options, in everyday words.',
  story: "Open with the first moment of {first}'s true story, in first person, as a short statement. Use only details from the story.",
};
const hookOf = picks => FORMAT_HOOKS[FORMATS[picks?.format] ? picks.format : 'question'];

// How the bridge raises the open question (picks.bridgeStyle) and how the CTA asks (picks.ctaStyle).
// Rotated per video, so the end of every video doesn't sound the same.
export const BRIDGE_LINES = {
  depends: "Say that's the general rule, but their own answer depends on their situation. Raise the open question in their words, without answering it.",
  picture: 'Invite them to picture their own situation for a moment, say their own answer depends on their situation, then raise the open question in their words, without answering it.',
  direct: 'Say their own answer depends on their situation, then ask them the open question directly, in their words, without answering it.',
  decides: "Say their own answer depends on their situation, in general words only (like \"your situation\" or \"your family\"; add no facts and no factors), then raise the open question, without answering it.",
};
export const CTA_LINES = {
  tie: `tie it back to their open question in a few natural words. Vary the wording; don't default to "to find out yours".`,
  easy: 'make reaching out feel small and easy (a quick message, nothing to commit to), tied to their open question.',
  specific: 'say plainly what reaching out gets them: help finding their own answer to the open question (never a promise of coverage, approval or a price).',
  gentle: 'keep it low pressure (whenever they’re ready), tied to their open question.',
};

const fill = (t, cfg, picks = {}) => String(t).replace(/\{city\}/g, cityOf(cfg) || 'your town').replace(/\{first\}/g, firstName(cfg)).replace(/\{count\}/g, String(picks.insights?.length || 2));
const plainOf = sol => (sol ? sol.plain || sol.text : '');

// What the agent's own material adds to a prompt (shared by the hook and script prompts).
function voiceLines(cfg) {
  const samples = (cfg.bank?.samples || []).slice(0, 3);
  if (!samples.length) return [];
  return [[`How ${firstName(cfg)} writes. Match this word choice and rhythm; never copy these lines or their topics:`],
    ...samples.map(t => [`- "${String(t).replace(/\s+/g, ' ').trim().slice(0, 300)}"`])];
}

// Lines are arrays of parts: plain strings, or { pick } for values chosen this run.
export function buildPrompt(cfg, picks) {
  const s = cfg.story, v = cfg.voice, g = guardrailsFor(cfg), o = cfg.output, voice = isVoice(cfg);
  const P = text => ({ pick: text });
  const facts = factsOf(picks), sols = solutionsOf(picks);
  const plan = beatPlan(o.scenes, picks.format, facts.length, picks.structure);
  const at = name => plan.find(b => b.beat === name);
  const guide = styleGuide(picks.audience?.style);
  const lean = text => (guide && text ? ` This audience leans ${guide.label}: ${text}` : '');
  const fmt = FORMATS[picks.format] || FORMATS.question;
  const agent = firstName(cfg);
  const quals = [...new Set(facts.flatMap(f => qualifiersIn(f.text)))];
  const keepQ = quals.length ? ` Keep each fact's qualifier ("${quals.join('", "')}") in the on-screen caption that states it.` : '';
  const musts = sols.map(x => x.mustMention).filter(Boolean);
  const sections = [];

  sections.push({ bus: 'story', title: 'THIS VIDEO', lines: [
    picks.audience && ['Audience: ', P(picks.audience.text)],
    picks.audience && ['People in the footage: ', P(picks.audience.visual || 'people matching this audience')],
    picks.painPoint && ['Their worry: ', P(picks.painPoint.text)],
    picks.productLine && ['The product (stay on it, and on this audience): ', P(picks.productLine)],
    picks.series?.title && ['Series: ', P(`${picks.series.label}, part ${picks.series.part} of ${picks.series.of}: ${picks.series.title}`)],
    ...(facts.length > 1 ? facts.map((f, i) => [`${fmt.body === 'compare' ? `Option ${'AB'[i]} fact` : `Fact ${i + 1}`} to teach: `, P(f.text)]) : facts.map(f => ['The insight to teach: ', P(f.text)])),
    ...sols.map((x, i) => [sols.length > 1 ? `Solution ${i + 1}: ` : 'The solution: ', P(plainOf(x))]),
    picks.story && [`${agent}'s true story (use only these details, in first person): `, P(picks.story.text)],
    picks.askQuestion && [`A real question ${agent} hears (use it as the opening, lightly trimmed if needed): `, P(picks.askQuestion.text)],
    ['The open question: ', P(picks.question)],
  ].filter(Boolean) });

  if (picks.hook) sections.push({ bus: 'story', title: 'OPENING (ALREADY CHOSEN)', lines: [
    [`Scene 1 is fixed. Its "text" must be exactly: `, P(`"${picks.hook.text}"`)],
    ...(voice && picks.hook.say ? [[`Its "say" must be exactly: `, P(`"${picks.hook.say}"`)]] : []),
    ['Write every other scene so it pays off this opening.'],
  ] });

  const body = at({ teach: 'Insight', myth: 'The truth', mistake: 'Why + what to do', compare: 'Option A, then B', story: 'Story + lesson', list: 'Items' }[fmt.body || 'teach']);
  const answerFirst = !!at('Bottom line');
  const bodyRule = answerFirst ? `Explain why that bottom line matters for them and how it usually works, using only the insight. Add no new facts and no numbers. No fear, no urgency, no worst-case stories.${keepQ}` : {
    teach: `Teach the insight clearly. You may split it across scenes and use simpler words, but keep its meaning.${keepQ} Every scene here states part of the fact itself; no teaser lines like "here's what most people miss". Add no numbers.`,
    myth: `Gently set the belief straight with the insight: say what's usually true instead, without making the viewer feel foolish.${keepQ} Add no numbers.`,
    mistake: `Using only the insight, explain honestly why the mistake matters, then what to do instead. No fear, no urgency, no worst-case stories.${keepQ}`,
    compare: `Present option A, then option B, one per scene, using only the facts given, in plain words. Be fair to both: don't call either one better for everyone.${keepQ}`,
    story: `Finish the story in first person using only its details (add nothing, change nothing), then the lesson: the insight.${keepQ}`,
    list: `One item per scene, in the order given, each stating one fact in plain words. "First…", "Second…" is fine if it reads naturally. The hook promised exactly ${facts.length} things.${keepQ}`,
  }[fmt.body || 'teach'];
  const sol = at('Solution'), bridge = at('Bridge'), bottom = at('Bottom line'), doubt = at('Common doubt'), recap = at('Remember this');
  const ctaHow = CTA_LINES[picks.ctaStyle] || CTA_LINES.tie;
  sections.push({ bus: 'story', title: 'SCENES', lines: [
    [`Hook (Scene 1), format "${fmt.label}": ${picks.hook ? 'already chosen above.' : `${fill(hookOf(picks), cfg, picks)} Make this audience stop scrolling: name their situation in everyday words (never a label like "seniors").`}${lean(guide?.hook)}`],
    bottom && [`Bottom line (${bottom.scenes}): Give the payoff of the opening right away: the insight's bottom line in one plain sentence, keeping its qualifier.`],
    [`${body.beat} (${body.scenes}): ${bodyRule}${lean(guide?.middle)}`],
    doubt && [`Common doubt (${doubt.scenes}): As a statement, name a doubt people in this situation often have (like "You might think this only matters later in life."), then settle it gently with only what the insight says. Never say or imply they will qualify, never blame or scare them, and add no new facts.`],
    recap && [`Remember this (${recap.scenes}): One short line worth remembering that restates the insight plainly, keeping its qualifier.`],
    sol ? [`Solution (${sol.scenes}): Name ${sols.length > 1 ? 'the solution(s)' : 'the solution'} in the plain words given. Add no features, facts or claims beyond the facts. No prices and nothing about eligibility.${musts.length ? ` Always mention "${musts.join('", "')}".` : ''}`]
      : [`Name the solution in the plain words given inside the last item if it fits naturally.${musts.length ? ` Always mention "${musts.join('", "')}" somewhere.` : ''}`],
    bridge && [`Bridge (${bridge.scenes}): ${BRIDGE_LINES[picks.bridgeStyle] || BRIDGE_LINES.depends}`],
    [`CTA (${at('CTA').scenes}): ${bridge ? '' : 'There is no bridge scene, so the CTA also says their own answer depends on their situation and raises their open question, as a statement (never a question). '}Use the action `, P(s.ctaAction.replace(/,.*$/, '')), ` (keep the words "${firstWords(s.ctaAction, 2)}") and ${ctaHow}${lean(guide?.cta)}`],
    [bridge ? `All scenes: speak to "you". Only the hook (Scene 1) and the bridge (${bridge.scenes}) may be questions; every other scene is a statement.` : 'All scenes: speak to "you". Only the hook (Scene 1) may be a question; every other scene, including the CTA, is a statement.'],
  ].filter(Boolean) });

  const rec = (picks.recent || []).filter(r => r.hook);
  if (rec.length) sections.push({ bus: 'story', title: 'KEEP IT FRESH', lines: [
    ['Recent videos already used these lines. Do not reuse their openings, sentence shapes or key phrases:'],
    ...rec.slice(0, 6).map(r => [`- Hook${r.rejected ? ` (the agent rejected this video: ${r.rejected})` : ''}: "${r.hook}"`]),
    ...rec.slice(0, 4).filter(r => r.bridge).map(r => [`- Bridge: "${r.bridge}"`]),
    ...rec.slice(0, 4).filter(r => r.cta).map(r => [`- CTA: "${r.cta}"`]),
  ] });
  const down = picks.turnedDown || [];
  if (down.length) sections.push({ bus: 'story', title: 'OPENINGS THE AGENT TURNED DOWN', lines: [
    ['The agent rejected videos for a weak opening with these. Don\'t write anything like them:'],
    ...down.map(h => [`- "${h}"`]),
  ] });

  const ex = (picks.examples || []).slice(0, 2);
  if (ex.length) sections.push({ bus: 'voice', title: `SCRIPTS ${agent.toUpperCase()} APPROVED`, lines: [
    [`${agent} approved these before. Match their quality, clarity and voice. Never reuse their lines:`],
    ...ex.map(e => [`- (${FORMATS[e.format]?.label || 'Video'}) ${e.lines.map(l => `"${l}"`).join(' / ')}`]),
  ] });

  const en = cfg.specs.energy[v.energy], tn = cfg.specs.tone[v.tone];
  const style = normStyle(picks.audience?.style);
  sections.push({ bus: 'voice', title: 'VOICE', lines: [
    [`Energy (${en.label}): ${en.rules} Rhythm example (don't reuse its words or topic): "${en.example}"`],
    [`Tone (${tn.label}): ${tn.rules} Tone example (don't reuse its words or topic): "${tn.example}"`],
    style && ['How this audience likes to be spoken to (', P(styleLabel(style)), `): ${styleRules(style)} This shapes word choice and pacing only.`],
    guide && [`Words that tend to land with them: ${guide.land.map(w => `"${w}"`).join(', ')}. Words that lose them: ${guide.lose.map(w => `"${w}"`).join(', ')}. Use the spirit of these, never a list of them.`],
    ...voiceLines(cfg),
  ].filter(Boolean) });

  // The agent's why (Mindset): it shapes the tone, never the words. A long-term advisor, not a sale.
  const why = cfg.mindset?.why || {};
  if (why.why) sections.push({ bus: 'voice', title: `${agent.toUpperCase()}'S WHY`, lines: [
    [`Why ${agent} does this work: "${why.why}"${why.how ? ` How: "${why.how}"` : ''}`],
    ['Let it shape the bridge and the call to action: someone who will still be serving this family in ten years, not chasing one sale. Never say it outright or quote it.'],
  ] });

  const G = [];
  if (g.mustUse.length)  G.push(['Include each of these phrases at least once: ' + g.mustUse.map(x => `"${x}"`).join(', ') + '.']);
  if (g.neverUse.length) G.push(['Never use these words or phrases: ' + g.neverUse.map(x => `"${x}"`).join(', ') + '.']);
  G.push(['Never use words that suggest a government connection: ' + GOV_TERMS.map(t => `"${t[1]}"`).join(', ') + '.']);
  G.push(['Never use overused ad phrases: ' + CLICHES.slice(0, 14).map(x => `"${x}"`).join(', ') + '. Say it plainly instead.']);
  g.mustDo.forEach(x => G.push(['Always: ' + x + '.']));
  g.neverDo.forEach(x => G.push(['Never: ' + x + '.']));
  sections.push({ bus: 'guardrails', title: 'GUARDRAILS', lines: G });

  const who = picks.audience?.visual ? ` matching "${picks.audience.visual}"` : '';
  const saved = picks.audience?.searches || [];
  const never = `Never abstract words like ${ABSTRACT_KEYWORDS.slice(0, 6).map(k => `"${k}"`).join(', ')}.`;
  const reuse = saved.length ? ` These searches found great footage for this audience before; reuse them for people shots where they fit: ${saved.map(q => `"${q}"`).join(', ')}.` : '';
  // With a shot plan (automatic videos), each scene's search matches its kind of shot, so footage varies.
  const shots = Array.isArray(picks.shots) && picks.shots.length === o.scenes ? picks.shots.map(k => SHOT_TYPES[k] ? k : 'people') : null;
  const keywordRule = shots
    ? `Each scene's "keyword" is a 2-5 word stock footage search for that scene's shot in the FOOTAGE PLAN. People shots name who is in the shot${who} and what they are doing or where. The other shots show a place, an object or light that fits the scene, and need no person. Include the shot's search word when it has one. Simple, common searches find better footage. ${never}${reuse}`
    : `Each scene's "keyword" is a 2-4 word stock footage search that names who is in the shot${who} and what they are doing or where, like "older woman kitchen table" or "parents with young kids". Simple, common searches find better footage. ${never}${saved.length ? ` These searches found great footage for this audience before; reuse them where they fit the scene: ${saved.map(q => `"${q}"`).join(', ')}.` : ''}`;
  if (shots) sections.push({ bus: 'output', title: 'FOOTAGE PLAN', lines: [
    ['Each scene gets a different kind of shot, so the video stays interesting to watch:'],
    ...shots.map((k, i) => { const t = SHOT_TYPES[k]; return [`- Scene ${i + 1}: ${t.label}${t.human ? ' (people)' : ''}: ${t.about}.${t.term ? ` Search word: "${t.term}".` : ''} Like "${t.example}".`]; }),
  ] });
  const accentRule = accentOn(cfg) ? `Each scene's "accent" is copied exactly from its "text" and gets highlighted: the one word or two-word phrase that carries the most feeling or benefit for the viewer, such as their family ("your kids"), the worry ("funeral"), the outcome ("smaller amounts") or the personal turn ("yours"). Never a qualifier (usually, many, may), never a product term (${nicheOf(cfg).productTermsExample}), never "licensed agent" or the call to action.` : null;
  sections.push({ bus: 'output', title: 'OUTPUT', lines: voice ? [
    [`Exactly ${o.scenes} scenes. This is a voiceover video: ${agent} speaks every scene.`],
    [`Each scene's "say" is what ${agent} says out loud: one or two natural spoken sentences, ${o.maxSpoken} words or fewer, at a ${o.readingLevel} level.`],
    [`Each scene's "text" is the on-screen caption: the key phrase from "say", ${o.maxWords} words or fewer.`],
    [keywordRule],
    accentRule && [accentRule],
    [`Return ONLY this JSON, no markdown: {"scenes":[{"say":"...","text":"...",${accentOn(cfg) ? '"accent":"...",' : ''}"keyword":"..."}]}`],
  ].filter(Boolean) : [
    [`Exactly ${o.scenes} scenes. This is a captions-only video: the captions carry the whole message.`],
    [`Each scene's "text" is the on-screen caption: ${o.maxWords} words or fewer, at a ${o.readingLevel} reading level.`],
    [keywordRule],
    accentRule && [accentRule],
    [`Return ONLY this JSON, no markdown: {"scenes":[{"text":"...",${accentOn(cfg) ? '"accent":"...",' : ''}"keyword":"..."}]}`],
  ].filter(Boolean) });

  const role = roleText(cfg);
  const system = `${role}

Follow these rules in priority order. When two rules conflict, the higher one wins:
1. Compliance: the GUARDRAILS.
2. Accuracy: every fact keeps its meaning and its qualifiers; stories keep their details.
3. Structure: each scene does its job in SCENES.
4. Persuasion: the hook stops the right viewer, the middle delivers on it, the bridge opens their personal question, the CTA promises the answer.
5. Style: the VOICE shapes wording only. It never overrides the rules above.`;

  const lineText = l => l.map(x => (typeof x === 'string' ? x : x.pick)).join('');
  const user = sections.map(sec => `[${sec.title}]\n` + sec.lines.map(lineText).join('\n')).join('\n\n');
  return { system, user, sections, lineText };
}

/* ---------------- Hooks: write many openings, keep the best ---------------- */
// The first line decides whether the right person keeps watching, so it gets its own step.
// Their interests first (Mindset): the real questions and objections the agent hears about this worry.
const theirWords = (cfg, picks) => [...(cfg.bank?.questions || []), ...(cfg.mindset?.objections || []).filter(o => o.topic)]
  .filter(q => q.text && (!q.links?.length || (picks.painPoint && q.links.includes(picks.painPoint.id)))).map(q => q.text).slice(0, 4);
export function buildHookPrompt(cfg, picks, count = 8) {
  const voice = isVoice(cfg), o = cfg.output, fmt = FORMATS[picks.format] || FORMATS.question, agent = firstName(cfg);
  const facts = factsOf(picks);
  const rec = (picks.recent || []).filter(r => r.hook).slice(0, 8);
  const system = `${roleText(cfg)}

You write the opening line (the hook) of short vertical videos. The hook decides whether the right person keeps watching. It must be honest: never promise what the facts can't deliver.`;
  const user = `[THIS VIDEO]
Audience: ${picks.audience?.text}
Their worry: ${picks.painPoint?.text}
${facts.map((f, i) => `${facts.length > 1 ? `Fact ${i + 1}` : 'Fact'}: ${f.text}`).join('\n')}
Format: ${fmt.label}. ${fill(hookOf(picks), cfg, picks)}${picks.story ? `\n${agent}'s true story: ${picks.story.text}` : ''}${picks.askQuestion ? `\nA real question ${agent} hears: ${picks.askQuestion.text}` : ''}

[WHAT MAKES A HOOK WORK]
- Speak to one person, in their situation and their own words. Name the situation, never a label like "seniors".
- Open a loop: make them need the next scene, and make sure the facts above close it.
- Be specific and concrete. Short: ${o.maxWords} words or fewer on screen.
- Vary the angle across the ${count}: a direct question, a sharp statement, the surprising part of the fact (keep its qualifier), the moment the worry shows up in real life.${cfg.mindset?.why?.why ? `\n- Make one of them open from why ${agent} does this work ("${cfg.mindset.why.why}"), in ${agent}'s own words, like "I do this because…". Never a promise.` : ''}${theirWords(cfg, picks).length ? `\n- Use their real words where they fit. Things clients actually say to ${agent}: ${theirWords(cfg, picks).map(q => `"${q}"`).join(', ')}.` : ''}

${(picks.winners || []).length ? `[OPENINGS THAT WORKED FOR ${agent.toUpperCase()}: THEY BROUGHT MESSAGES OR WON A TEST]
Learn what made these work (the situation, the wording, the angle). Never copy them.
${picks.winners.map(w => (w.tested ? `- "${w.hook}" (won a side-by-side test against "${w.beat}"${w.ratio ? `: ${w.ratio}× the views` : ''})` : `- "${w.hook}" (${w.messages} message${w.messages === 1 ? '' : 's'})`)).join('\n')}

` : ''}[AVOID]
${rec.length ? rec.map(r => `- Too close to a recent hook: "${r.hook}"${r.rejected ? ` (rejected: ${r.rejected})` : ''}`).join('\n') + '\n' : ''}${(picks.turnedDown || []).length ? picks.turnedDown.map(h => `- Like an opening the agent turned down as weak: "${h}"`).join('\n') + '\n' : ''}- Fear, urgency, promises, or saying they'll qualify.
- Numbers, prices or percentages that aren't in the facts.
- Government words (${GOV_TERMS.map(t => t[1]).slice(0, 6).join(', ')}…) and overused ad phrases (${CLICHES.slice(0, 8).join(', ')}…).
- Words from this list: ${guardrailsFor(cfg).neverUse.map(x => `"${x}"`).join(', ')}.

[VOICE]
${cfg.specs.energy[cfg.voice.energy].rules} ${cfg.specs.tone[cfg.voice.tone].rules}${normStyle(picks.audience?.style) ? `\nThis audience leans ${styleLabel(picks.audience.style)}: ${styleRules(picks.audience.style)}` : ''}
${voiceLines(cfg).map(l => l.join('')).join('\n')}

Write ${count} different hooks. Return ONLY JSON: {"hooks":[{"text":"on-screen words"${voice ? `,"say":"the spoken version, ${o.maxSpoken} words or fewer"` : ''}}]}`;
  return { system, user };
}

/* ---------------- Critics: rank hooks and drafts ---------------- */
export function buildHookCriticPrompt(cfg, picks, hooks) {
  const system = `You are a short-form video strategist for ${cfg.look?.name || nicheOf(cfg).agentNoun}. Judge hooks honestly and strictly.`;
  const user = `Audience: ${picks.audience?.text}${normStyle(picks.audience?.style) ? ` (they lean ${styleLabel(picks.audience.style)}: ${styleRules(picks.audience.style)})` : ''}
Their worry: ${picks.painPoint?.text}
What the video teaches: ${factsOf(picks).map(f => f.text).join(' / ')}

Score each hook from 1 to 10: would this exact person stop scrolling, AND does the video deliver on it honestly? Prefer specific, plain, human lines over clever ones.

${hooks.map((h, i) => `${i + 1}. ${h.text}`).join('\n')}

Return ONLY JSON: {"ranked":[{"n":1,"score":8,"why":"a few words"}]} with every hook, best first.`;
  return { system, user };
}

/* ---------------- Critic: pick the best of several valid drafts ---------------- */
export function buildCriticPrompt(cfg, picks, drafts) {
  const voice = isVoice(cfg), style = normStyle(picks.audience?.style);
  const recent = (picks.recent || []).filter(r => r.hook).slice(0, 5);
  const list = drafts.map((d, i) => `DRAFT ${i + 1}\n` + d.scenes.map((s, j) => `${j + 1}. ${voice ? s.say : s.text}`).join('\n')).join('\n\n');
  const system = `You review short-form videos for ${cfg.look?.name || nicheOf(cfg).agentNoun}${cfg.look?.location ? ` in ${cfg.look.location}` : ''}. Score honestly and strictly.`;
  const user = `These drafts were written for:
Audience: ${picks.audience?.text}
What they must teach accurately: ${factsOf(picks).map(f => f.text).join(' / ')}
Open question the bridge and CTA must point to: ${picks.question}
Format: ${FORMATS[picks.format]?.label || 'Question'}

Score each draft from 1 to 5 on:
- hook: would this exact audience stop scrolling at scene 1?
- insight: is it taught clearly and accurately, with its qualifiers, and does the middle deliver what the hook promised?
- bridge: does the viewer finish feeling their own answer is still open?
- cta: does the last scene make reaching out feel easy and worth it?
- flow: does it sound like one warm, honest person from start to finish, not like an ad?
- fresh: would someone who saw the agent's recent videos feel this one is new, not the same shape and phrases again?${style ? `
- styleFit: does it speak the way this audience listens (${styleLabel(style)}: ${styleRules(style)})?` : ''}
${recent.length ? `
Recent videos opened and closed like this:
${recent.map(r => `- "${r.hook}"${r.bridge ? ` … "${r.bridge}"` : ''}${r.cta ? ` … "${r.cta}"` : ''}`).join('\n')}
` : ''}
${list}

Return ONLY JSON: {"scores":[{"draft":1,"hook":0,"insight":0,"bridge":0,"cta":0,"flow":0,"fresh":0,${style ? '"styleFit":0,' : ''}"note":"one sentence"}],"best":1}`;
  return { system, user };
}

/* ---------------- Instagram post text ---------------- */
const hashCity = cfg => String(cfg.look?.location || '').replace(/[^A-Za-z]/g, '');

export function buildPostPrompt(cfg, picks, scenes) {
  const L = cfg.look || {}, g = guardrailsFor(cfg), states = cfg.profile?.states || [];
  const script = scenes.map((s, i) => `${i + 1}. ${s.say || s.text}`).join('\n');
  const role = roleText(cfg);
  const system = `${role}\n\nYou write the Instagram post text that goes under the Reel. Follow the same rules as the video.`;
  const tags = [hashCity(cfg) && `#${hashCity(cfg)}`].filter(Boolean);
  const user = `The Reel says:\n${script}\n\nWhat it teaches (keep the meaning and qualifiers): ${factsOf(picks).map(f => f.text).join(' / ')}\n\nWrite the post text:
- The first line is a hook of ${POST_FIRST_LINE} characters or fewer that works on its own (it's all people see before "more").
- Then 1 to 3 short sentences in first person, warm and plain, at a 6th grade level: restate the insight a fresh way and invite them to ${String(cfg.story.ctaAction || 'message me').toLowerCase()}${L.handle ? ` (${L.handle})` : ''}.${states.length && states.length <= 2 ? `\n- Mention that you serve ${states.join(' and ')}.` : ''}
- Never use: ${g.neverUse.map(x => `"${x}"`).join(', ')}, or words suggesting a government connection (${GOV_TERMS.map(t => t[1]).join(', ')}). ${g.neverDo.filter(x => !/hashtag|emoji/i.test(x)).join('. ')}.
- End with 3 to 5 relevant hashtags${tags.length ? `, including ${tags.join(' ')}` : ''}. No emojis.${L.disclaimer ? `\n- Last line, exactly: ${L.disclaimer}` : ''}
Return ONLY JSON: {"caption":"..."}`;
  return { system, user };
}

/* ---------------- Reply shapes (OpenAI structured outputs) ---------------- */
// With OPENAI_STRUCTURED on (the default), each call says exactly which JSON it must return, so a
// reply can't come back malformed or with fields missing. lib/openai.js falls back to plain JSON mode
// for a model that doesn't support it. Strict schemas: every field listed is required.
const obj = (props, req = Object.keys(props)) => ({ type: 'object', properties: props, required: req, additionalProperties: false });
const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' };
export function scriptSchema(cfg) {
  const scene = { ...(isVoice(cfg) ? { say: str } : {}), text: str, ...(accentOn(cfg) ? { accent: str } : {}), keyword: str };
  return { name: 'script', schema: obj({ scenes: { type: 'array', items: obj(scene) } }) };
}
export const hookSchema = cfg => ({ name: 'hooks', schema: obj({ hooks: { type: 'array', items: obj({ text: str, ...(isVoice(cfg) ? { say: str } : {}) }) } }) });
export const hookCriticSchema = () => ({ name: 'hook_ranking', schema: obj({ ranked: { type: 'array', items: obj({ n: int, score: num, why: str }) } }) });
export function criticSchema(picks) {
  const style = normStyle(picks?.audience?.style);
  const row = { draft: int, hook: num, insight: num, bridge: num, cta: num, flow: num, fresh: num, ...(style ? { styleFit: num } : {}), note: str };
  return { name: 'draft_scores', schema: obj({ scores: { type: 'array', items: obj(row) }, best: int }) };
}
export const postSchema = () => ({ name: 'post', schema: obj({ caption: str }) });
