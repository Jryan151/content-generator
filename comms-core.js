// comms-core.js — the communication playbook. The portal (Communicate tab) and the server
// (coach prompts, script prompts) both import this file, so what the agent learns is exactly
// what the AI is told.
//
// DISC is a simple model of four behavior styles (from William Marston's 1928 work). It describes
// how people tend to take in information and make decisions; it is not a personality test or a
// diagnosis. Everyone is a blend, and the same person shifts with the situation. For videos, an
// audience "leans" a style: a working guess the agent tests against real results.
// No browser-only or Node-only code in this file.

export const STYLE_KEYS = ['D', 'I', 'S', 'C'];

export const STYLES = {
  D: {
    key: 'D', name: 'Direct', disc: 'Dominance',
    short: 'Fast and decisive. Wants the bottom line.',
    wants: 'Results, control and a clear answer, fast.',
    fears: 'Wasting time, being talked down to, losing control of the decision.',
    decides: 'Quickly, once they see the point. They want options and the final say.',
    cues: 'Short, blunt messages. Asks “what’s the catch?” Skips small talk.',
    land: ['here’s the short version', 'the one thing to check', 'your call', 'straight answer'],
    lose: ['long wind-ups', 'heavy emotion', '“just checking in”', 'vague answers'],
    video: { hook: 'Lead with the point, or the one thing to check.', middle: 'Short and plain, outcome first. Cut every extra word.', cta: 'A quick, clear next step they control.' },
    talk: 'Get to the point, offer two options and let them choose. Respect their time.',
    prompt: 'direct and brief: lead with the point, plain outcome-first wording, no wind-up, a clear next step they control',
    settings: { energy: 'mid', tone: 'high' },
    tts: 'Brisk, clear and confident. Short pauses, no drawn-out words.',
    formats: ['didyouknow', 'mistake', 'list'],
    example: { worry: 'Just tell me what I actually need. Skip the sales pitch.', hook: 'Here’s the one thing to check on your work coverage.', cta: 'Message me. Quick answer, your call.' },
  },
  I: {
    key: 'I', name: 'Outgoing', disc: 'Influence',
    short: 'Warm and social. Moved by people and stories.',
    wants: 'Connection, fun and feeling seen and liked.',
    fears: 'Being ignored, rejection, dull detail.',
    decides: 'On feeling and on trust in the person. Moved by stories and by what people like them do.',
    cues: 'Chatty, exclamation points, emojis, shares their own story.',
    land: ['imagine', 'you’re not alone', 'let’s', 'here’s what happened'],
    lose: ['dense detail', 'a cold, formal tone', 'long lists of rules'],
    video: { hook: 'Open with a relatable moment or a lively question.', middle: 'Warm and personal, like telling a friend. Paint the picture.', cta: 'Friendly and social: invite them to say hi.' },
    talk: 'Be warm, let them talk and share a little of yourself. Follow up in writing so details don’t slip.',
    prompt: 'warm and lively: a relatable everyday moment, friendly personal wording, paint the picture, a friendly invitation to say hi',
    settings: { energy: 'high', tone: 'low' },
    tts: 'Warm and lively, like smiling while talking. Expressive but natural.',
    formats: ['story', 'ifyoure', 'local'],
    example: { worry: 'I’d hate for my family to scramble to pay for my funeral.', hook: 'Raise your hand if you’re the planner in your family.', cta: 'Message me and say hi. I’d love to hear your story.' },
  },
  S: {
    key: 'S', name: 'Steady', disc: 'Steadiness',
    short: 'Calm and loyal. Family first. Needs to feel safe.',
    wants: 'Security, stability, being cared for, no surprises.',
    fears: 'Sudden change, pressure, conflict, letting family down.',
    decides: 'Slowly, after trust. Often talks it over with family first.',
    cues: 'Polite and hesitant. “I’ve been meaning to…”, “I don’t want to bother you.” Mentions family.',
    land: ['step by step', 'no pressure', 'take your time', 'your family', 'together'],
    lose: ['urgency', 'big changes all at once', 'pushy follow-ups', '“limited time”'],
    video: { hook: 'Gently name the quiet worry, with reassurance.', middle: 'Calm and simple, one step at a time. Show it’s easier than they fear.', cta: 'Low pressure: whenever you’re ready.' },
    talk: 'Slow down, reassure, invite family into the conversation and give them time. Never push.',
    prompt: 'gentle and reassuring: name the quiet worry kindly, one calm step at a time, family first, a no-pressure invitation',
    settings: { energy: 'low', tone: 'low' },
    tts: 'Slow, gentle and reassuring, with soft pauses between ideas.',
    formats: ['question', 'story', 'asked'],
    example: { worry: 'I don’t want my kids stuck paying for my funeral.', hook: 'If this has been quietly on your mind, you’re not alone.', cta: 'Message me whenever you’re ready. No pressure.' },
  },
  C: {
    key: 'C', name: 'Careful', disc: 'Conscientiousness',
    short: 'Precise and analytical. Wants to get it right.',
    wants: 'Accuracy, clear facts, how it works, doing it right.',
    fears: 'Being wrong, hidden fine print, hype, being rushed.',
    decides: 'After research and comparing. The logic has to add up.',
    cues: 'Detailed questions: “what exactly…”, “what’s the difference between…”, asks about fine print.',
    land: ['here’s how it works', 'usually', 'the difference is', 'the details'],
    lose: ['hype', 'exaggeration', 'vague claims', 'emotional pressure'],
    video: { hook: 'A precise question or a common mix-up.', middle: 'Clear facts in order, with the qualifiers. Show how it works.', cta: 'Offer the specifics for their situation.' },
    talk: 'Bring details, answer exactly, put it in writing and give them time to compare.',
    prompt: 'precise and clear: a specific question or common mix-up, facts in a logical order with every qualifier, no hype, an offer of the details for their situation',
    settings: { energy: 'low', tone: 'high' },
    tts: 'Even, calm and precise. Clear articulation and a steady pace.',
    formats: ['myth', 'compare', 'list'],
    example: { worry: 'I don’t really understand what these policies cover.', hook: 'Most people mix up these two kinds of coverage.', cta: 'Message me and I’ll walk you through the details.' },
  },
};

// "S", "SC", "cs" → "SC" (at most two styles, primary first). Anything else → "".
export function normStyle(s) {
  const letters = [...new Set(String(s || '').toUpperCase().replace(/[^DISC]/g, '').split(''))];
  return letters.slice(0, 2).join('');
}
export const styleLabel = s => normStyle(s).split('').map(k => STYLES[k].name).join(' + ');
// One line for the script prompt: how this audience likes to be spoken to.
export function styleRules(s) {
  const k = normStyle(s);
  if (!k) return '';
  return k.split('').map(x => `${STYLES[x].name}: ${STYLES[x].prompt}`).join('. ') + '.';
}

// A blend, scene by scene: the main style shapes the opening and the call to action (the moments
// that decide whether someone stops and reaches out), the second style shapes the middle. One style:
// it shapes all three. Also the words that tend to land or lose them, and how the AI voice should sound.
export function styleGuide(s) {
  const k = normStyle(s);
  if (!k) return null;
  const a = STYLES[k[0]], b = STYLES[k[1]] || a;
  const words = key => [...new Set([...a[key], ...(b === a ? [] : b[key])].map(w => w.replace(/[“”"]/g, '')))];
  return { label: styleLabel(k), hook: a.video.hook, middle: b.video.middle, cta: a.video.cta, land: words('land'), lose: words('lose'), tts: a.tts };
}

// How people take in a message. Each principle has what it means for the agent's videos.
export const PRINCIPLES = [
  { title: 'Feeling first, then the fact', body: 'People decide with emotion and explain it with logic.', video: 'Name the feeling in the worry, then let the fact settle it.' },
  { title: 'One specific person beats a crowd', body: 'A single, clear situation moves people more than a category or a statistic.', video: '“Grandparents raising their grandkids” beats “seniors”.' },
  { title: 'Their words, not yours', body: 'People trust words that sound like their own thoughts. Industry words create distance.', video: 'Write worries the way a client would say them at the kitchen table.' },
  { title: 'Curiosity pulls; pressure pushes', body: 'An open question draws people in. Pressure makes them resist, even when the offer is good.', video: 'End with the question only you can answer, never with urgency.' },
  { title: 'Protecting beats gaining', body: 'People care more about keeping what they have than getting something new.', video: 'Frame it as keeping the family steady, without fear or worst-case stories.' },
  { title: 'Easy feels true', body: 'Plain words and one idea are easier to believe and remember.', video: 'One worry, one fact, one next step per video.' },
  { title: 'Small steps beat big asks', body: 'People put off big decisions. A tiny next step gets taken.', video: '“Message me” is easier than “book a consultation”.' },
  { title: 'Trust is warmth plus skill', body: 'People trust someone who clearly cares and clearly knows the subject.', video: 'Teach something useful in every video, in a warm voice.' },
];

// The core of selling, and where each part lives in a video's scene plan.
export const SALES = [
  { title: 'Know, like, trust', body: 'People buy from people they know, like and trust. Every video is a small deposit.', beat: 'Every scene' },
  { title: 'Lead with their problem', body: 'Start where they are, not with your product.', beat: 'Hook' },
  { title: 'Give value first', body: 'Teach something useful before you ask for anything.', beat: 'Insight' },
  { title: 'Benefits, not features', body: 'Say what a fact means for their family, without adding claims.', beat: 'Insight and solution' },
  { title: 'Ask, don’t tell', body: 'Good questions uncover the real need. The open question is your discovery question.', beat: 'Bridge' },
  { title: 'One small next step', body: 'One clear, easy action beats a menu of choices.', beat: 'Call to action' },
  { title: 'Objections are questions', body: '“It’s too expensive” usually means “I don’t see the value yet” or “I’m worried about my budget.” Answer the worry under it.', beat: 'Worries and replies' },
  { title: 'Consistency builds familiarity', body: 'Showing up every week makes you the agent they think of first.', beat: 'Your posting plan' },
];

// "Guess the style": real-sounding messages from viewers, for practice. No AI cost.
export const DRILL = [
  { text: 'How much? Just give me a number.', style: 'D', why: 'Short, wants the bottom line, no small talk.', reply: 'Give a straight path: it depends on age and health, so two quick questions and you’ll have real options.' },
  { text: 'omg this is so me 😂 my mom never talked about any of this!!', style: 'I', why: 'Chatty, emoji, exclamation points, shares her own story.', reply: 'Match the warmth: thank her, relate to the story, invite her to message you.' },
  { text: 'I’ve been meaning to look into this for a while. I don’t want to be a bother.', style: 'S', why: 'Polite, hesitant, worried about imposing.', reply: 'Reassure first: no bother at all, no pressure, happy to go at her pace.' },
  { text: 'What’s the difference between whole life and term for someone my age? Is the premium fixed?', style: 'C', why: 'Precise, comparing options, asks how it works.', reply: 'Answer the general difference clearly, then offer to go over the specifics for their situation.' },
  { text: 'My husband and I would want to talk it over first. Is that okay?', style: 'S', why: 'Wants family involved and time to decide.', reply: 'Absolutely: invite both of them, and let them set the pace.' },
  { text: 'Love this!! Sending it to my sister right now 💕', style: 'I', why: 'Enthusiastic and social; shares with people she loves.', reply: 'Thank her warmly and keep the door open for both of them.' },
  { text: 'Can you send me something in writing that explains the waiting period?', style: 'C', why: 'Wants details and documentation before deciding.', reply: 'Yes, and explain the general idea in plain words. Offer to walk through their own case.' },
  { text: 'I don’t need the whole speech. Can you help or not?', style: 'D', why: 'Impatient with long explanations; wants a clear yes.', reply: 'Lead with yes, then one sentence on the next step.' },
  { text: 'Thank you for explaining it so kindly. My kids worry about me.', style: 'S', why: 'Values kindness; family is the reason.', reply: 'Acknowledge the kids’ worry gently and offer a calm, simple next step.' },
  { text: 'Where did you get that? Is that true in every state?', style: 'C', why: 'Checks sources and accuracy.', reply: 'Say it’s a general rule that can vary, and offer to check what applies where they live.' },
  { text: 'Haha you’re funny. My grandpa would’ve loved you.', style: 'I', why: 'Playful, personal, connects through people.', reply: 'Enjoy the moment, share a little, and invite a real conversation.' },
  { text: 'What’s the fastest way to get this done?', style: 'D', why: 'Focused on speed and results.', reply: 'Give the shortest honest path, and let them decide.' },
  { text: 'I’m nervous about changing anything I already have.', style: 'S', why: 'Change feels risky; needs stability.', reply: 'Reassure that looking doesn’t mean changing, and nothing happens without their okay.' },
  { text: 'Does it pay out if something happens in the first two years?', style: 'C', why: 'Probing a specific condition: the fine print.', reply: 'Explain that it depends on the type of policy, and offer to go through the details together.' },
  { text: 'We should do a whole family night about this! Could you talk to my group?', style: 'I', why: 'Social, thinks in groups and events.', reply: 'Match the energy, and offer to talk with her first to plan it.' },
  { text: 'Is there a catch? Just be straight with me.', style: 'D', why: 'Direct, wants honesty without fluff.', reply: 'Be just as direct: there are trade-offs, and here’s how to see which fits.' },
];

// What the input workshop can practice, and the hint shown with each.
export const WORKSHOP_KINDS = {
  worry: { label: 'A worry', hint: 'In your client’s words, first person, under 14 words.', example: 'I don’t want my kids paying for my funeral.' },
  question: { label: 'An open question', hint: 'The personal question only you can answer for them.', example: 'how much coverage would cover your final expenses' },
  hook: { label: 'An opening line', hint: 'The first words on screen. Ten words or fewer.', example: 'Mom never talked about what she wants.' },
  fact: { label: 'A fact', hint: 'One general claim with “usually”, “often”, “many” or “may”.', example: 'Many final expense policies ask a few health questions instead of an exam.' },
  audience: { label: 'An audience', hint: 'Who they are, in a few plain words.', example: 'Grandparents helping raise their grandkids' },
  cta: { label: 'A call to action', hint: 'Short. Starts with the action.', example: 'Message me' },
};
export const RUBRIC = [['specific', 'Specific'], ['theirWords', 'Their words'], ['feeling', 'Feeling'], ['oneIdea', 'One idea'], ['styleFit', 'Fits the style']];

// The playbook as one block of text, for the AI.
export function playbookText() {
  const styles = STYLE_KEYS.map(k => {
    const s = STYLES[k];
    return `${k} · ${s.name} (${s.disc}): ${s.short} Wants: ${s.wants} Fears: ${s.fears} Decides: ${s.decides} Clues in messages: ${s.cues} Words that land: ${s.land.join(', ')}. Words that lose them: ${s.lose.join(', ')}. In a video: hook — ${s.video.hook} Middle — ${s.video.middle} CTA — ${s.video.cta} In conversation: ${s.talk}`;
  }).join('\n');
  return `COMMUNICATION STYLES (DISC: a simple model of behavior, not a personality test; everyone is a blend; read the person, never assume a style from age, culture, gender or background)
${styles}

HOW PEOPLE TAKE IN A MESSAGE
${PRINCIPLES.map(p => `- ${p.title}: ${p.body} In a video: ${p.video}`).join('\n')}

SALES FUNDAMENTALS (and where they live in a video)
${SALES.map(p => `- ${p.title} (${p.beat}): ${p.body}`).join('\n')}`;
}
