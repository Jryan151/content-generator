// lib/prompts/script.js — the script prompt: what the video is, how each scene works, how it should
// sound, the footage for each scene, and the JSON it must return.
import {
  FORMATS, GOV_TERMS, CLICHES, ABSTRACT_KEYWORDS, POST_FIRST_LINE, beatPlan, guardrailsFor, roleText, firstName, cityOf,
  factsOf, solutionsOf, isVoice, accentOn, qualifiersIn, firstWords, SHOT_TYPES,
} from '../../mixer-core.js';
import { nicheOf } from '../../niches/index.js';
import { normStyle, styleLabel, styleRules, styleGuide } from '../../comms-core.js';
import { fill, plainOf, voiceLines, SOUND_RULES, obj, str } from './shared.js';
import { exampleFor } from './examples.js';

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
    teach: `Explain the insight over these scenes, one complete thought each: say it plainly first, then what it means in their everyday life, using only what the insight says. Simpler words are fine; keep its meaning.${keepQ} No teaser lines like "here's what most people miss". Add no numbers.`,
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

  // How it should sound: the rules every script follows, and one short example (on another subject)
  // unless the agent has approved scripts of her own to learn from.
  const eg = ex.length ? null : exampleFor(picks);
  sections.push({ bus: 'voice', title: 'HOW IT SHOULD SOUND', lines: [
    ...SOUND_RULES.map(r => [`- ${fill(r, cfg, picks)}`]),
    eg && [`This is the feel to aim for (a ${FORMATS[eg.format]?.label || 'Question'} video on a different subject). Match how plain and connected it is; never reuse its words or its subject:`],
    ...(eg ? eg.scenes.map((l, i) => [`  ${i + 1}. ${l}`]) : []),
  ].filter(Boolean) });

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
  const seeRule = `Each scene's "see" says in plain words what's on screen while that line plays: who${who}, doing what, and where. Show the moment the line is about, as literally as you can (money worries: someone going over bills at the kitchen table; family: a grandmother with her grandkids; a plan: a couple talking it over at home). Never funerals, hospitals, churches, caskets or people crying.`;
  const backupRule = 'Each scene\'s "backup" is a second, simpler 2-3 word search for the same picture, in case the first finds nothing good.';
  const keywordRule = shots
    ? `Each scene's "see" follows its kind of shot in the FOOTAGE PLAN, still showing what that line is about. Its "keyword" is the search for that "see": 2-5 words. People shots name who is in the shot${who} and what they are doing or where. The other shots show a place, an object or light that fits the line, and need no person. Include the shot's search word when it has one. Simple, common searches find better footage. ${never}${reuse}`
    : `Each scene's "keyword" is the search for its "see": a 2-4 word stock footage search that names who is in the shot${who} and what they are doing or where, like "older woman kitchen table" or "parents with young kids". Simple, common searches find better footage. ${never}${saved.length ? ` These searches found great footage for this audience before; reuse them where they fit the scene: ${saved.map(q => `"${q}"`).join(', ')}.` : ''}`;
  if (shots) sections.push({ bus: 'output', title: 'FOOTAGE PLAN', lines: [
    ['Each scene gets a different kind of shot, so the video stays interesting to watch:'],
    ...shots.map((k, i) => { const t = SHOT_TYPES[k]; return [`- Scene ${i + 1}: ${t.label}${t.human ? ' (people)' : ''}: ${t.about}.${t.term ? ` Search word: "${t.term}".` : ''} Like "${t.example}".`]; }),
  ] });
  const accentRule = accentOn(cfg) ? `Each scene's "accent" is copied exactly from its "text" and gets highlighted: the one word or two-word phrase that carries the most feeling or benefit for the viewer, such as their family ("your kids"), the worry ("funeral"), the outcome ("smaller amounts") or the personal turn ("yours"). Never a qualifier (usually, many, may), never a product term (${nicheOf(cfg).productTermsExample}), never "licensed agent" or the call to action.` : null;
  sections.push({ bus: 'output', title: 'OUTPUT', lines: voice ? [
    [`First write "draft": the whole video as ${agent} would say it in about thirty seconds, as one short spoken paragraph. Then split it into exactly ${o.scenes} scenes that follow it.`],
    [`This is a voiceover video: ${agent} speaks every scene.`],
    [`Each scene's "say" is what ${agent} says out loud: one or two natural spoken sentences, ${o.maxSpoken} words or fewer, at a ${o.readingLevel} level.`],
    [`Each scene's "text" is the on-screen caption: the key phrase from "say", ${o.maxWords} words or fewer.`],
    [seeRule],
    [keywordRule],
    [backupRule],
    accentRule && [accentRule],
    [`Return ONLY this JSON, no markdown: {"draft":"...","scenes":[{"say":"...","text":"...",${accentOn(cfg) ? '"accent":"...",' : ''}"see":"...","keyword":"...","backup":"..."}]}`],
  ].filter(Boolean) : [
    [`First write "draft": the whole video as ${agent} would say it in about thirty seconds, as one short spoken paragraph. Then split it into exactly ${o.scenes} scenes whose captions follow it.`],
    ['This is a captions-only video: the captions carry the whole message.'],
    [`Each scene's "text" is the on-screen caption: ${o.maxWords} words or fewer, at a ${o.readingLevel} reading level.`],
    [seeRule],
    [keywordRule],
    [backupRule],
    accentRule && [accentRule],
    [`Return ONLY this JSON, no markdown: {"draft":"...","scenes":[{"text":"...",${accentOn(cfg) ? '"accent":"...",' : ''}"see":"...","keyword":"...","backup":"..."}]}`],
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


export function scriptSchema(cfg) {
  const scene = { ...(isVoice(cfg) ? { say: str } : {}), text: str, ...(accentOn(cfg) ? { accent: str } : {}), see: str, keyword: str, backup: str };
  return { name: 'script', schema: obj({ draft: str, scenes: { type: 'array', items: obj(scene) } }) };
}
