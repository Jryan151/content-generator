// test/helpers.js — a throwaway data folder and fake OpenAI / Pixabay servers, so tests
// never touch real data, never need API keys and never cost anything.
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawnSync } from 'child_process';

export function tempEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-test-'));
  const dirs = { DATA_DIR: 'data', VIDEOS_DIR: 'videos', BACKUP_DIR: 'backups', MUSIC_DIR: 'music', FONT_DIR: 'fonts' };
  for (const [k, v] of Object.entries(dirs)) { process.env[k] = path.join(root, v); fs.mkdirSync(process.env[k], { recursive: true }); }
  process.env.NODE_ENV = 'test';
  process.env.PUBLIC_URL = '';
  process.env.TWO_FACTOR = 'off';   // tests that cover two-factor login turn it back on themselves
  delete process.env.STRIPE_SECRET_KEY;
  // Gone when the test file finishes, so test runs (each update runs them all) don't fill /tmp.
  process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });
  return root;
}

export const hasFfmpeg = () => spawnSync('ffmpeg', ['-version']).status === 0;

// Copies a Poppins font into the test font folder. Returns the family name, or null if none is around.
export function testFont() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const places = [path.join(here, '..', 'fonts'), '/usr/share/fonts/truetype/google-fonts', '/usr/share/fonts/truetype/poppins'];
  for (const [family, file, italic] of [['Poppins SemiBold', 'Poppins-SemiBold.ttf', 'Poppins-SemiBoldItalic.ttf'], ['Poppins Medium', 'Poppins-Medium.ttf', 'Poppins-MediumItalic.ttf']]) {
    const dir = places.find(d => fs.existsSync(path.join(d, file)) && fs.existsSync(path.join(d, italic)));
    if (dir) { [file, italic].forEach(f => fs.copyFileSync(path.join(dir, f), path.join(process.env.FONT_DIR, f))); return family; }
  }
  return null;
}

/* ---------------- Fake OpenAI: writes scripts that follow the prompt's own rules ---------------- */
const HOOKS = ['Ever wonder what happens to the bills later?', 'Here is a question I hear a lot at kitchen tables.', 'Most families never talk about this part.', 'If this has been on your mind, you are not alone.', 'A lot of people think this is out of reach.', 'This one surprises almost every family I meet.'];
const BRIDGES = ['Your own answer depends on your situation.', 'What fits you depends on your own family.', 'That is the general rule, but yours may differ.', 'Every family is different, so yours may be too.'];
const ENDINGS = ['and we can talk it through.', 'and I will help you find yours.', 'to see what fits your family.', 'and we will look at your options.'];
let n = 0;
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ''; const j = s.indexOf(b, i + a.length); return s.slice(i + a.length, j < 0 ? undefined : j); };
const BANNED_ACCENT = new Set(['usually', 'often', 'generally', 'typically', 'many', 'some', 'may', 'might', 'can', 'could', 'policy', 'policies', 'insurance', 'whole', 'term', 'licensed', 'agent', 'message', 'me', 'call', 'the', 'your', 'this', 'that', 'with', 'about']);
const accentOf = text => (text.toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 3 && !BANNED_ACCENT.has(w)).sort((a, b) => b.length - a.length)[0] || 'family';

export function fakeScript(user) {
  const scenes = Number((/exactly (\d+) scenes/i.exec(user) || [])[1]) || 6;
  const maxWords = Number(between(user, 'caption: ', ' words or fewer')) || Number(between(user, 'the key phrase from "say", ', ' words or fewer')) || 10;
  const facts = user.split('\n').filter(l => / to teach: /.test(l)).map(l => l.slice(l.indexOf(' to teach: ') + 11).trim());
  const cta = between(user, 'Use the action ', ' (keep the words').trim() || 'Message me';
  const must = between(user, 'Always mention "', '"');
  const hook = between(user, 'Its "text" must be exactly: "', '"\n');
  const voice = user.includes('"say"');
  const k = Math.max(1, scenes - 4);
  let chunks;
  if (facts.length > 1) chunks = facts.slice(0, k).map(f => f.replace(/[.]$/, '').split(/\s+/).slice(0, maxWords).join(' '));
  else {
    const words = (facts[0] || 'That is worth knowing').replace(/[.]$/, '').split(/\s+/), size = Math.ceil(words.length / k);
    chunks = Array.from({ length: k }, (_, i) => words.slice(i * size, (i + 1) * size).join(' '));
  }
  while (chunks.length < k) chunks.push('That is worth knowing.');
  chunks = chunks.map(c => c || 'That is worth knowing.');
  // Like a careful writer, keep each caption to 3 lines on screen (about 55 characters), so the
  // render test's "every caption fits" check doesn't depend on which fact was picked.
  const QUAL = /^(usually|often|generally|typically|many|some|may|might|can|could|commonly|normally|sometimes|lots)$/i;
  chunks = chunks.map(c => { const w = c.split(' '); while (w.join(' ').length > 55 && w.length > 3) { const k = w.findLastIndex(x => !QUAL.test(x.replace(/\W/g, ''))); w.splice(k > 0 ? k : w.length - 1, 1); } return w.join(' '); });
  if (chunks.some(c => c.split(' ').length > maxWords)) throw new Error('fake script: fact too long for its scenes');
  const v = n++;
  const lines = [hook || HOOKS[v % HOOKS.length], ...chunks, must ? `Ask me about the ${must}.` : 'There is a simple way to plan for this.', BRIDGES[v % BRIDGES.length], `${cta} ${ENDINGS[v % ENDINGS.length]}`]
    .map((t, i) => (i === 0 && hook ? t : t.split(' ').slice(0, maxWords).join(' ')));
  const kws = ['older woman kitchen table', 'senior couple reading', 'grandmother with grandchild', 'older man on porch', 'family at dinner table', 'woman on phone', 'couple at home', 'parents with kids'];
  return { scenes: lines.map((t, i) => ({ ...(voice ? { say: t } : {}), text: t, accent: accentOf(t), keyword: kws[i % kws.length] })) };
}

let hookRound = 0;
function openaiReply(body) {
  const msgs = body.messages || [];
  const sys = String(msgs[0]?.content || '');
  const last = msgs[msgs.length - 1];
  const user = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content || '');
  if (Array.isArray(last?.content)) { const n = last.content.filter(c => c.type === 'image_url').length, never = /Search used: "funeral test/.test(String(last.content[0]?.text || '')); return { clips: Array.from({ length: n }, (_, i) => ({ n: i + 1, score: never && i === 1 ? 1 : i === 0 ? 4 : 3, reason: never && i === 1 ? 'a funeral' : 'looks right' })) }; }
  if (sys.includes('training video into a short lesson card')) return { title: 'When they need to think about it', point: 'Most of the time it is the price. Ask which part, then show the smaller option.', doThis: ['Ask “which part?” on your next 5 calls', 'Have a smaller option ready'], step: 'close' };
  if (sys.includes('You review short-form videos')) return { scores: [{ draft: 1, hook: 4, insight: 5, bridge: 4, cta: 4, flow: 4, note: 'solid' }, { draft: 2, hook: 3, insight: 4, bridge: 4, cta: 4, flow: 4, note: 'ok' }], best: 1 };
  if (user.includes('weekly check-in.')) {
    const ids = between(user, 'Use only these worry ids: ', ';').split(',').map(x => x.trim()).filter(Boolean);
    const fmts = between(user, 'only these formats: ', '. Mix').split(',').map(x => x.trim());
    return { summary: 'Myth videos brought the most messages. Two posted videos still need results.', focus: 'Post three times this week.', change: { type: 'set_voice', label: 'Calmer', why: 'fits older viewers', energy: 'high' },
      plan: [{ painId: ids[0], format: fmts[0], why: 'Your best topic' }, { painId: 'nope', format: fmts[0], why: 'bad id' }, { painId: ids[1] || ids[0], format: 'notaformat', why: 'bad format' }, { painId: ids[1] || ids[0], format: fmts[1] || fmts[0], why: 'Something new' }] };
  }
  // Mindset (lib/lens.js)
  // (v15: every flag quotes its words; one that quotes words the draft doesn't have is dropped; advice that
  // suggests a testimonial is replaced; a draft that names a burden gets the gentle fear note.)
  const draftText = String(user).split('"""')[1] || user;
  if (sys.includes('You read drafts written by licensed')) return /only 2 spots left/i.test(draftText)
    ? { principles: [{ id: 'reciprocity', how: 'gives a tip' }], flags: [{ kind: 'scarcity', words: 'Only 2 spots left' }, { kind: 'urgency', words: 'act before midnight' }, { kind: 'made-up', words: 'x' }], works: ['Short and clear.'], note: 'Invented scarcity.', advice: 'Share a success story from a client you helped.', rewrite: { principle: 'reciprocity', text: 'Here is one thing worth knowing before you choose.' } }
    : /burden/i.test(draftText)
      ? { principles: [{ id: 'liking', how: 'warm and plain' }], flags: [{ kind: 'fear', words: 'being a burden' }], works: ['Names a real worry.'], note: 'Honest; the worry is named gently.', advice: 'Offer a free checklist of questions to ask.', rewrite: { principle: 'reciprocity', text: 'Here is a free checklist to make it simpler.' } }
      : { principles: [{ id: 'reciprocity', how: 'Teaches something useful first.' }, { id: 'authority', how: 'Rests on a confirmed fact.' }, { id: 'nope', how: 'x' }, { id: 'reciprocity', how: 'dup' }], flags: [], note: 'Honest and helpful.', advice: 'Offer a free checklist.' };
  if (sys.includes('80/20 rule')) return { keep: 'Referral calls: most of your closed business.', cut: 'Cold door knocking.', automate: 'Birthday texts.', delegate: 'Paperwork.' };
  // Smart Content (lib/content.js)
  if (sys.includes('You check the content of')) {
    const pairs = user.split('\n').filter(l => /^\d+\. /.test(l)).map(l => {
      const n = Number(l.match(/^(\d+)/)[1]), lower = l.toLowerCase();
      const score = lower.includes('mortgage') && lower.includes('funeral') ? 1 : lower.includes('grandkids') ? 3 : 5;
      return { n, score, reason: score === 1 ? 'Mortgage payoff isn’t about funeral costs.' : score === 3 ? 'Only loosely about grandkids.' : 'Answers it directly.' };
    });
    return { pairs };
  }
  if (sys.includes('You organize the content') && user.includes('The new')) {
    const idsIn = head => { const part = user.split(head)[1] || ''; return [...part.split('\n\n')[0].matchAll(/^([\w-]+): /gm)].map(m => m[1]); };
    const up = idsIn('S it could belong under:'), down = idsIn('S that could belong under it:');
    return { product: 'final_expense', parents: [...(up[0] ? [{ id: up[0], score: 5, reason: 'Clearly answers it.' }] : []), ...(up[1] ? [{ id: up[1], score: 3, reason: 'loose' }] : []), { id: 'nope', score: 5, reason: 'x' }], children: down[0] ? [{ id: down[0], score: 4, reason: 'Follows from it.' }] : [] };
  }
  if (user.includes('Propose missing links')) {
    const facts = [...(user.split('FACTS (linked to worries):\n')[1] || '').split('\n\n')[0].matchAll(/^([\w-]+): (.*)$/gm)];
    const worries = [...(user.split('WORRIES (linked to audiences):\n')[1] || '').split('\n\n')[0].matchAll(/^([\w-]+): /gm)].map(m => m[1]);
    const lone = facts.find(m => !m[2].includes('[linked:'))?.[1];
    return { add: [...(lone ? [{ from: lone, to: worries[0], score: 5, reason: 'It answers this worry.' }, { from: lone, to: worries[0], score: 5, reason: 'duplicate' }] : []), { from: worries[0], to: lone || 'x', score: 5, reason: 'wrong direction' }, { from: lone || 'x', to: worries[1] || 'x', score: 3, reason: 'too weak' }] };
  }
  if (sys.includes('write the building blocks of their short videos')) {
    if (user.startsWith('3 facts')) return { options: [{ text: 'Many families usually compare a few plans before choosing one.', product: 'final_expense' }, { text: 'This covers everything for everyone.' }, { text: 'Many families usually compare a few plans before choosing one.' }] };
    if (user.startsWith('3 worries')) return { options: [{ text: 'I don’t know where to even start with this.', question: 'where to start for your family.' }, { text: 'You will qualify no matter what.', question: 'x' }] };
    if (user.startsWith('3 specific audiences')) return { options: [{ text: 'Widows managing money alone', visual: 'women in their 60s and 70s' }, { text: 'Medicare enrollees', visual: 'seniors' }] };
    if (user.startsWith('3 ways to name')) return { options: [{ text: 'Small whole life plan', plain: 'a small policy that stays with you', mustMention: '', product: 'final_expense' }, { text: 'Guaranteed plan', plain: 'a plan that guarantees everyone is approved' }] };
    if (user.startsWith('3 calls to action')) return { options: [{ text: 'Message me anytime.' }, { text: 'Act now before it’s too late' }, { text: 'Send me a quick note' }] };
  }
  if (user.includes('SCRIPT A (current settings)')) return { better: 'B', why: 'B opens with the moment the worry shows up.', lesson: 'Name the moment, not the category.' };
  if (/Write \d+ versions/.test(user)) {
    const quote = between(user, ': "', '".\n');
    return { options: [{ style: 'stronger', text: 'Your family deserves a plan for this', accent: 'family' }, { style: 'shorter', text: 'Plan this for your kids', accent: 'kids' }, { style: 'warmer', text: 'Everyone qualifies, guaranteed!', accent: 'Everyone' }, { style: 'clearer', text: 'Plans can start at age 50', accent: 'nowhere' }, { style: 'same', text: quote, accent: 'x' }] };
  }
  if (user.includes('"scenery"')) {
    // Studio ideas: the scene's own lines are echoed back, so the teaching scenes still say the fact.
    const now = between(user, ', now: "', '".') || 'Planning ahead helps your family';
    const kept = now.split(' ').slice(1).join(' ');
    return { lines: [{ style: 'stronger', text: kept, accent: kept.split(' ').sort((a, b) => b.length - a.length)[0] }, { style: 'shorter', text: 'Guaranteed approval for everyone', accent: 'approval' }, { style: 'warmer', text: 'Plans can start at age 50', accent: 'Plans' }],
      searches: [{ keyword: 'small town street at sunset', shot: 'wide' }, { keyword: 'coffee cup steam close up', shot: 'close-up' }, { keyword: 'medicare office building', shot: 'place' }],
      scenery: ['Your kitchen table in morning light, hands holding a mug.', 'Walking up your own front steps.'] };
  }
  if (user.includes('Pick the 1-3 worries')) { const first = between(user, 'Worries:\n', ':'); return { ids: [first, 'nope'] }; }
  // v15 Phase 8: notes to one client in the agent's voice (one with a price, which must be left out).
  if (sys.includes('You write short personal notes')) { const who = (/ to ([A-Z][a-z]+)\./.exec(user) || [])[1] || 'friend'; return { notes: [{ label: 'Warm', text: `Hi ${who}, thank you so much for booking a time with me. I’m looking forward to it!` }, { label: 'Short', text: `Thanks, ${who}! Talk soon.` }, { label: 'Personal', text: 'Plans start at $9 a month, see you then.' }] }; }
  if (user.includes('Write 3 different replies')) return { style: 'sc', read: 'Polite and asks how it works.', replies: [{ label: 'Warm', text: 'Thanks so much for reaching out! Every family is different, so I would love to go over your options on a quick call.' }, { label: 'Helpful', text: 'Great question. Rates start at $9 a month for most people.' }, { label: 'Short', text: 'Happy to help. Want to set up a quick call this week?' }], tip: 'Move specifics to a call.' };
  if (sys.includes('You coach a licensed life insurance agent on writing the inputs')) {
    const kind = between(user, 'INPUT TYPE: ', ' (');
    const v = { 'A worry': ['I don’t want my kids stuck with the bill.', 'Just tell me what I need, guaranteed.', 'What if my family has to scramble for money?'],
      'An opening line': ['Mom never talked about it either.', 'Everyone qualifies, act now!', 'Here’s the one thing to check.'],
      'A fact': ['Many final expense policies ask a few health questions instead of an exam.', 'Final expense covers everything.', 'Many policies may skip the medical exam.'] }[kind] || ['Message me anytime', 'Act now, limited time', 'Message me when you’re ready'];
    return { scores: { specific: 4, theirWords: 9, feeling: 2, oneIdea: 'x' }, read: { style: 'c', why: 'Precise wording.' }, works: 'Clear.', improve: 'Name the feeling.', lesson: 'Feeling first, then the fact.',
      versions: [{ style: 'S', text: v[0], why: 'Gentle' }, { style: 'D', text: v[1], why: 'Direct' }, { style: 'I', text: v[2], why: 'Warm' }, { style: 'C', text: v[0], why: 'duplicate' }] };
  }
  if (sys.includes('You are the communication coach inside')) {
    const ctx = JSON.parse(String(msgs[1]?.content || '').replace(/^CONTEXT[^\n]*\n/, '') || '{}');
    const a = ctx.audiences?.[0]?.id;
    return { reply: 'This group leans **Steady**: calm, family first, no pressure.', suggestions: [
      { type: 'set_style', label: 'Set to Steady + Careful', why: 'Calm and precise', audienceId: a, style: 'sc' },
      { type: 'set_style', label: 'Bad', audienceId: 'nope', style: 'D' },
      { type: 'set_style', label: 'Bad style', audienceId: a, style: 'xyz' },
      { type: 'edit_worry', label: 'Gentler worry', why: 'Steady', id: ctx.worries?.[0]?.id, text: 'I don’t want my kids stuck with the bill.' },
    ], followups: ['How do I talk to a Careful client?'] };
  }
  if (sys.includes('You are the coach inside')) {
    const ctx = JSON.parse(String(msgs[1]?.content || '').replace(/^CONTEXT[^\n]*\n/, '') || '{}');
    if (ctx.focusStudio) {
      const st = ctx.focusStudio, sc = st.scenes;
      // v15: lines that would all stop a render (a price), then (told why) clean ones; or bad every time.
      const asked = msgs.filter(m => m.role === 'user').map(m => String(m.content)).join(' ');
      if (asked.includes('lines for scenes 2 and 3') || asked.includes('only bad lines')) {
        const retry = user.includes('None of those lines can be used') && !asked.includes('only bad lines');
        return retry
          ? { reply: 'Here they are again, without the price.', suggestions: [{ type: 'studio_scene', label: 'Scene 2', i: 1, text: sc[1]?.text || 'Planning ahead can help', accent: '' }, { type: 'studio_scene', label: 'Scene 3', i: 2, text: sc[2]?.text || 'It can fit your budget', accent: '' }] }
          : { reply: 'Here are some revised lines.', suggestions: [{ type: 'studio_scene', label: 'Scene 2', i: 1, text: 'Plans can cost $30 a month' }, { type: 'studio_scene', label: 'Scene 3', i: 2, text: 'Lock in your low rate today' }] };
      }
      if (user.includes('opening')) return { reply: 'Try these.', suggestions: [
        { type: 'studio_hook', label: 'With an age', text: 'At 65 your kids could pay for this' },
        { type: 'studio_hook', label: 'Plain', text: 'Who pays for your funeral someday?' },
      ] };
      if (user.includes('truth')) return { reply: 'Here are two.', suggestions: [
        { type: 'use_fact', label: 'Bad id', id: 'nope' },
        { type: 'use_fact', label: 'Teach this', id: st.confirmedFactsForThisWorry.find(f => !st.factsTaught.some(t => t.id === f.id))?.id || 'nope' },
        { type: 'add_fact', label: 'A new truth', text: 'Many families usually compare a few plans before choosing one.' },
      ] };
      return { reply: 'Scene 2 can carry the fact more plainly.', suggestions: [
        { type: 'studio_scene', label: 'Plainer scene 2', why: 'clearer', i: 1, text: sc[1]?.text || 'x', accent: 'nope-not-in-it' },
        { type: 'studio_scene', label: 'Breaks a rule', i: 1, text: 'Everyone qualifies, guaranteed!' },
        { type: 'studio_footage', label: 'Wider shot', i: 2, keyword: 'small town street at sunset' },
        { type: 'studio_scenery', label: 'Film it', i: 0, text: 'Sit at your kitchen table and look into the camera.' },
        { type: 'use_fact', label: 'Teach this', id: st.confirmedFactsForThisWorry.find(f => !st.factsTaught.some(t => t.id === f.id))?.id || 'nope' },
        { type: 'add_fact', label: 'A new truth', text: 'Many families usually compare a few plans before choosing one.' },
        { type: 'fix_scene', label: 'Wrong kind here', videoId: 'x', i: 0, text: 'x' },
      ], followups: ['Make it warmer'] };
    }
    return { reply: 'Open with the exact moment the worry shows up.\n\n- Name their situation\n- Keep it **short**', suggestions: [
      { type: 'add_worry', label: 'Add this worry', why: 'More specific', text: 'I keep putting this off because I think it costs too much.', question: 'what fits your budget', audienceIds: [ctx.audiences?.[0]?.id, 'nope'] },
      { type: 'add_fact', label: 'Add a fact', why: 'bad one', text: 'Everyone qualifies, guaranteed.' },
      { type: 'set_voice', label: 'More conversational', why: 'fits older viewers', energy: 'mid', tone: 'loud' },
      { type: 'edit_worry', label: 'Bad id', id: 'missing', text: 'x' },
      { type: 'add_note', label: 'Remember', why: 'they said so', text: 'Prefers calm, slower videos.' },
    ], followups: ['How do I write a stronger hook?', 'Which format should I try next?', 'third one is dropped'] };
  }
  if (user.includes('Write 8 different hooks')) { const r = hookRound++; const tag = i => `${'abcdefghijklmnopqrstuvwxyz'[r % 26]}${'abcdefgh'[i]}`; return { hooks: Array.from({ length: 8 }, (_, i) => ({ text: `Hook idea ${tag(i)}: here is what families wonder`, say: `Hook idea ${tag(i)}: here is what families wonder about.` })).concat([{ text: 'Everyone qualifies, guaranteed!' }]) }; }
  if (user.includes('Score each hook from 1 to 10')) return { ranked: [{ n: 2, score: 9, why: 'specific' }, { n: 1, score: 7, why: 'clear' }] };
  if (user.includes('{"caption"')) return { caption: 'Planning ahead can feel like a lot.\nHere is one thing worth knowing, and I am happy to walk you through it. Message me anytime.\n#LifeInsurance #FamilyPlanning #PlanAhead' };
  if (user.includes('Starter content:')) {
    const input = JSON.parse(between(user, 'Starter content:\n', '\n\nRewrite'));
    return { audiences: input.audiences.map(a => ({ ...a, text: a.text + ' near me' })), painPoints: input.painPoints, suggestions: [{ text: 'Many people find it helps to talk with family before choosing coverage.', links: [input.painPoints[0].id] }] };
  }
  // A fix request gets a fresh variant of the same script.
  return fakeScript(msgs.find(m => m.role === 'user')?.content || '');
}

export async function startStubs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reels-stub-'));
  const mp3 = path.join(dir, 'voice.mp3');
  const clips = ['#6b8fb5', '#b58f6b', '#7aa874', '#a8749b'].map((c, i) => {
    const f = path.join(dir, `clip${i}.mp4`);
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${c}:s=720x1280:d=4,format=yuv420p`, '-f', 'lavfi', '-i', 'testsrc2=s=200x200:d=4', '-filter_complex', '[0][1]overlay=260:540', '-t', '4', '-r', '30', f]);
    return f;
  });
  const thumb = path.join(dir, 'thumb.jpg');
  spawnSync('ffmpeg', ['-y', '-i', clips[0], '-frames:v', '1', thumb]);
  spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.6', '-ac', '1', '-b:a', '64k', mp3]);
  const calls = { chat: 0, speech: 0, search: 0, clip: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    let raw = ''; for await (const c of req) raw += c;
    if (url.pathname === '/v1/chat/completions') {
      calls.chat++;
      try {
        const body = JSON.parse(raw);
        return json(200, { choices: [{ message: { content: JSON.stringify(openaiReply(body)) } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } });
      } catch (e) { return json(200, { choices: [{ message: { content: '{"scenes":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 10 }, note: e.message }); }
    }
    // Speech to text: a lesson video's words (lib/lessons.js).
    if (url.pathname === '/v1/audio/transcriptions') { calls.stt = (calls.stt || 0) + 1; const next = sttQueue.shift(); return json(200, next || { text: 'When they say they need to think about it, ask what part. Usually it is the price. Then show the smaller option.', duration: 6, words: [{ word: 'When', start: 0, end: 0.3 }] }); }
    if (url.pathname === '/v1/audio/speech') { calls.speech++; res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(fs.readFileSync(mp3)); }
    if (url.pathname === '/pixabay/') {
      calls.search++;
      const id = Number(url.searchParams.get('id'));
      const mk = i => ({ id: i, tags: 'people, home, family', videos: { medium: { url: `${base}/clip/${i}.mp4`, width: 720, height: 1280, thumbnail: `${base}/thumb.jpg` }, large: { url: `${base}/clip/${i}.mp4`, width: 720, height: 1280, thumbnail: `${base}/thumb.jpg` } } });
      if (id) return json(200, { hits: [mk(id)] });
      const q = url.searchParams.get('q') || '';
      const seed = [...q].reduce((a, ch) => a + ch.charCodeAt(0), 0);
      return json(200, { hits: Array.from({ length: 12 }, (_, i) => mk(1000 + ((seed * 31 + i * 7) % 5000))) });
    }
    if (url.pathname.startsWith('/clip/')) { calls.clip++; const i = Number(url.pathname.match(/\d+/)[0]) % clips.length; res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(fs.readFileSync(clips[i])); }
    if (url.pathname === '/thumb.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(fs.readFileSync(thumb)); }
    json(404, { error: 'no stub for ' + url.pathname });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.OPENAI_BASE_URL = base + '/v1';
  process.env.PIXABAY_API_KEY = 'test-key';
  process.env.PIXABAY_BASE_URL = base + '/pixabay/';
  return { base, calls, close: () => server.close() };
}

// A logged-in fetch for the app's own API.
// The next transcriptions the stub hands back, in order (then the default one). For tests that need
// real word timings, such as the automatic lesson edit.
const sttQueue = [];
export const queueTranscript = (...t) => { sttQueue.push(...t); };

export function client(port) {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return { get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b) => call('PUT', p, b), del: p => call('DELETE', p), get cookie() { return cookie; }, set cookie(c) { cookie = c; } };
}

// The portal's source as one text (public/app.js and every screen in public/screens/), and the server's
// (server.js and every routes/ file), for checks that look for wording or wiring in the code.
export function portalSource() {
  const here = path.dirname(new URL(import.meta.url).pathname), pub = path.join(here, '..', 'public');
  const dir = path.join(pub, 'screens');
  return [path.join(pub, 'app.js'), ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => path.join(dir, f)) : [])].map(f => fs.readFileSync(f, 'utf8')).join('\n');
}
export function serverSource() {
  const here = path.dirname(new URL(import.meta.url).pathname), root = path.join(here, '..');
  const dir = path.join(root, 'routes');
  return [path.join(root, 'server.js'), ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => path.join(dir, f)) : [])].map(f => fs.readFileSync(f, 'utf8')).join('\n');
}
