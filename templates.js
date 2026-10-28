// templates.js — the starter topics (final expense).
// Each topic is one video idea whose parts belong together: the worry in the client's own words, the
// one fact it teaches, the question only the agent can answer, and how the offer is named. Written to
// pass the platform rules: every fact is general, carries a qualifier ("usually", "often", "many"…),
// and has no numbers, prices, company names or government language. Nothing here is used in a video
// until the agent ticks that the fact is true for what they sell.

const topic = (id, worry, fact, question, offer, extra = {}) => ({ id, worry, fact, question, offer, mention: '', who: '', confirmed: false, confirmedAt: '', confirmedBy: '', ai: false, ...extra });

export const STARTER_TOPICS = [
  topic('t_funeral', 'I don’t want my kids paying for my funeral.',
    'Final expense insurance is usually a small whole life policy meant to cover funeral and end-of-life costs.',
    'how much coverage would actually cover your final expenses',
    'final expense coverage: a small whole life policy for funeral costs'),
  topic('t_budget', 'I’m on a fixed income. I can’t afford much.',
    'Final expense policies often come in smaller amounts, which keeps the premium smaller too.',
    'what kind of coverage fits your monthly budget',
    'a final expense policy sized to your budget'),
  topic('t_same', 'What if the price keeps going up as I get older?',
    'With whole life final expense, the premium usually stays the same for life.',
    'how a policy with a premium that stays the same could fit you',
    'final expense whole life coverage'),
  topic('t_health', 'I have health problems. Nobody will cover me.',
    'Many final expense policies ask a few health questions instead of requiring a medical exam.',
    'which policies you could apply for with your health history',
    'a final expense policy that may skip the medical exam'),
  topic('t_turned', 'I was turned down before, so why bother?',
    'Policies that accept almost anyone usually have a waiting period before the full benefit is paid.',
    'what a policy built for tougher health histories would look like for you',
    'a final expense policy built for tougher health histories, with a waiting period', { mention: 'waiting period' }),
  topic('t_work', 'I have coverage through work. Isn’t that enough?',
    'Life insurance through work often ends when you retire or leave that job.',
    'whether your work coverage follows you into retirement',
    'a policy you own yourself, separate from your job', { who: 'adults in their 50s and early 60s' }),
  topic('t_family', 'Mom never talked about what she wants. What if we’re not ready?',
    'A payout to a named beneficiary usually skips probate, so it often arrives faster.',
    'how to start that conversation and what a plan for her could look like',
    'final expense coverage for a parent', { who: 'an adult daughter or son with an elderly parent' }),
  topic('t_wait', 'I keep putting this off. I’ll deal with it later.',
    'Applying younger usually means lower premiums.',
    'what a simple plan could look like if you start now',
    'final expense coverage', { who: 'adults in their 50s and 60s' }),
];

export const starterTopics = () => JSON.parse(JSON.stringify(STARTER_TOPICS));

// The starter topics as the story the checks read (for tests and tools that build a config by hand).
export function starterStory() {
  const topics = starterTopics(), aud = { id: 'aud', text: 'Seniors on a fixed income', visual: 'older adults in their 60s and 70s', style: '', searches: [] };
  const audiences = [aud], painPoints = [], insights = [], solutions = [];
  for (const t of topics) {
    let a = 'aud';
    if (t.who) { a = `${t.id}_a`; audiences.push({ ...aud, id: a, visual: t.who }); }
    painPoints.push({ id: t.id, text: t.worry, question: t.question, links: [a] });
    insights.push({ id: `${t.id}_f`, text: t.fact, links: [t.id], confirmed: false, confirmedAt: '', source: '', ai: false });
    solutions.push({ id: `${t.id}_s`, text: t.offer, plain: t.offer, links: [`${t.id}_f`], mustMention: t.mention });
  }
  return { audiences, painPoints, insights, solutions };
}
